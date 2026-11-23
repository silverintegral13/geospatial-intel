// Agents: property agents join the platform, link their listing accounts and submit the prices they
// actually see. Every price point is checked before a lender sees it:
//   1. against the government floor for that spot (circle rate / ready reckoner, engine/sources/circle.js)
//   2. against other agents' points nearby (median price per sq ft within 1.5 km, same asset type)
// Accepted points earn credits and build the agent's track record; outliers are held for review.
//
// Honest limits of this prototype: RERA numbers are format-checked only (state RERA portals have no
// public API), and listing portals (99acres, Housing.com, MagicBricks, NoBroker, Square Yards) have no
// public agent API, so the working route today is the CSV export from the agent's portal dashboard.
import { circleCheck } from '../../engine/sources/circle.js';
import { haversine } from '../../engine/util.js';
import { S, bus, store } from './state.js';
import { map, toast } from './map.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const inr = (v) => (v >= 1e7 ? `₹${(v / 1e7).toFixed(2)} Cr` : `₹${(v / 1e5).toFixed(1)} L`);

export const PORTALS = [
  { id: '99acres', name: '99acres', note: 'Export "My responses / listings" as CSV from the agent dashboard' },
  { id: 'housing', name: 'Housing.com', note: 'Export listings from Housing.com Pro (Excel / CSV)' },
  { id: 'magicbricks', name: 'MagicBricks', note: 'Export listings from the MagicBricks agent dashboard' },
  { id: 'nobroker', name: 'NoBroker', note: 'Export from NoBroker for Business' },
  { id: 'squareyards', name: 'Square Yards', note: 'Export from the Square Yards partner app' },
];

// Sample data so the demo works out of the box. Clearly labelled "sample" in the UI.
const SAMPLE = [
  { id: 's1', agent: 'sample', locality: 'Hinjewadi Phase 1, Pune', state: 'Maharashtra', lat: 18.5905, lon: 73.7385, type: 'residential', area_sqft: 1050, price: 7800000, kind: 'closed', date: '2026-10-18', portal: '99acres' },
  { id: 's2', agent: 'sample', locality: 'Hinjewadi Phase 1, Pune', state: 'Maharashtra', lat: 18.5921, lon: 73.7401, type: 'residential', area_sqft: 980, price: 7150000, kind: 'closed', date: '2026-09-30', portal: 'housing' },
  { id: 's3', agent: 'sample', locality: 'Hinjewadi Phase 2, Pune', state: 'Maharashtra', lat: 18.5889, lon: 73.7352, type: 'residential', area_sqft: 1000, price: 21000000, kind: 'asking', date: '2026-11-02', portal: 'magicbricks' },
  { id: 's4', agent: 'sample', locality: 'Baner, Pune', state: 'Maharashtra', lat: 18.5596, lon: 73.7871, type: 'residential', area_sqft: 1450, price: 14500000, kind: 'closed', date: '2026-10-05', portal: 'housing' },
  { id: 's5', agent: 'sample', locality: 'Hadapsar, Pune', state: 'Maharashtra', lat: 18.5085, lon: 73.9262, type: 'residential', area_sqft: 1100, price: 4500000, kind: 'closed', date: '2026-10-22', portal: '99acres' },
  { id: 's6', agent: 'sample', locality: 'Kundal, Sanand', state: 'Gujarat', lat: 22.889, lon: 72.223, type: 'agri_land', area_sqft: 43560, price: 6500000, kind: 'closed', date: '2026-08-14', portal: 'csv' },
];

let profile = store.get('agentProfile', null);
let points = store.get('agentPoints', null) || SAMPLE.slice();
let openPortal = null;

const RERA_RE = /^[A-Z]{1,6}[A-Z0-9/-]{6,24}$/; // e.g. A51800012345 (MahaRERA), AG/GJ/AHMEDABAD/AUDA/AA01234/...
const isUnit = (t) => t === 'residential' || t === 'commercial';

// ---------- checks ----------
function check(p, all) {
  const out = { status: 'accepted', reasons: [], weight: p.kind === 'closed' ? 1 : 0.3, floor: null, ratio: null, psf: Math.round(p.price / p.area_sqft) };
  const c = circleCheck({ lat: p.lat, lon: p.lon, state: p.state, assetType: p.type, builtSqft: isUnit(p.type) ? p.area_sqft : null, areaSqm: isUnit(p.type) ? null : p.area_sqft / 10.7639, p50: p.price });
  if (c.tier && c.tier !== 'estimated' && c.circle_value) {
    out.floor = c.circle_value; out.ratio = p.price / c.circle_value; out.floorLabel = `${c.tier_label}: ${c.regime}, ${c.locality || ''}`.trim();
    if (p.kind === 'closed' && out.ratio < 0.9) { out.status = 'review'; out.reasons.push(`Below the government floor (${out.ratio.toFixed(2)}×): a deed would be registered at least at ${inr(c.circle_value)}`); }
    else if (out.ratio > 3.5) { out.status = 'review'; out.reasons.push(`${out.ratio.toFixed(1)}× the government floor: far above what the floor implies here`); }
    else out.reasons.push(`${out.ratio.toFixed(2)}× the government floor: plausible`);
  } else {
    out.reasons.push('No published floor on file here: checked against other agents only');
    out.weight *= 0.6;
  }
  // Peer benchmark: closed deals only (asking prices are a weaker signal), true median.
  const near = all.filter((q) => q.id !== p.id && q.type === p.type && q.kind === 'closed' && haversine(p.lat, p.lon, q.lat, q.lon) <= 1500);
  if (near.length >= 1) {
    const ps = near.map((q) => q.price / q.area_sqft).sort((a, b) => a - b);
    const m = ps.length >> 1;
    const med = ps.length % 2 ? ps[m] : (ps[m - 1] + ps[m]) / 2;
    const dev = out.psf / med - 1;
    out.peer = { n: near.length, median_psf: Math.round(med), dev };
    if (Math.abs(dev) > 0.4) { out.status = 'review'; out.reasons.push(`${dev > 0 ? '+' : ''}${Math.round(dev * 100)}% vs ${near.length} nearby closed deal${near.length === 1 ? '' : 's'} (median ₹${Math.round(med).toLocaleString('en-IN')}/sq ft)`); }
    else out.reasons.push(`Within ${Math.round(Math.abs(dev) * 100)}% of ${near.length} nearby closed deal${near.length === 1 ? '' : 's'}`);
  } else out.reasons.push('No nearby closed deals to compare yet');
  if (p.kind === 'asking') out.reasons.push('Asking price: counted at 30% weight until a closing price arrives');
  out.credits = out.status === 'accepted' ? (p.kind === 'closed' ? 1 : 0.25) : 0;
  return out;
}

function scored() { return points.map((p) => ({ ...p, chk: check(p, points) })); }

// ---------- map layer ----------
function paint(list) {
  if (!map || !map.isStyleLoaded?.()) return;
  const data = { type: 'FeatureCollection', features: list.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { ok: p.chk.status === 'accepted' ? 1 : 0 } })) };
  if (!map.getSource('agents')) {
    map.addSource('agents', { type: 'geojson', data });
    map.addLayer({ id: 'agents-pt', type: 'circle', source: 'agents', paint: { 'circle-radius': 6, 'circle-color': ['case', ['==', ['get', 'ok'], 1], '#a98bff', '#ff5470'], 'circle-stroke-color': '#02040a', 'circle-stroke-width': 2 } });
  } else map.getSource('agents').setData(data);
}

// ---------- CSV ----------
export const CSV_HEADER = 'locality,state,lat,lon,type,area_sqft,price_inr,kind,date,portal';
function parseCsv(text, portal) {
  const rows = text.trim().split(/\r?\n/).map((l) => l.split(',').map((x) => x.trim()));
  const head = rows.shift().map((h) => h.toLowerCase());
  const ix = (k) => head.indexOf(k);
  const need = ['lat', 'lon', 'area_sqft', 'price_inr'];
  const miss = need.filter((k) => ix(k) < 0);
  if (miss.length) throw new Error(`Missing column(s): ${miss.join(', ')}. Expected: ${CSV_HEADER}`);
  const out = [];
  rows.forEach((r, n) => {
    const lat = +r[ix('lat')], lon = +r[ix('lon')], area = +r[ix('area_sqft')], price = +r[ix('price_inr')];
    if (!(lat && lon && area > 0 && price > 0)) return;
    out.push({ id: 'p' + Date.now().toString(36) + n, agent: 'me', locality: r[ix('locality')] || '', state: r[ix('state')] || '', lat, lon,
      type: ['residential', 'commercial', 'plot', 'industrial', 'agri_land'].includes(r[ix('type')]) ? r[ix('type')] : 'residential',
      area_sqft: area, price, kind: r[ix('kind')] === 'asking' ? 'asking' : 'closed', date: r[ix('date')] || '', portal: r[ix('portal')] || portal || 'csv' });
  });
  return out;
}
function sampleCsv() {
  return [CSV_HEADER, 'Wakad Pune,Maharashtra,18.5985,73.7636,residential,1120,8400000,closed,2026-11-04,99acres', 'Hinjewadi Phase 1 Pune,Maharashtra,18.5899,73.7372,residential,890,6300000,closed,2026-10-28,99acres', 'Kothrud Pune,Maharashtra,18.5079,73.8072,residential,1300,16900000,asking,2026-11-10,99acres'].join('\n');
}

// ---------- render ----------
export function renderAgents() {
  const el = $('#panelInner');
  const list = scored();
  const mine = list.filter((p) => p.agent === 'me');
  const acc = mine.filter((p) => p.chk.status === 'accepted').length;
  const credits = mine.reduce((s, p) => s + p.chk.credits, 0);
  const tier = acc >= 50 ? 'Gold' : acc >= 15 ? 'Silver' : acc >= 1 ? 'Bronze' : 'New';
  el.innerHTML = `
  <div class="ph"><div><div class="kicker">PROPERTY AGENTS <span class="soon">PROTOTYPE</span></div><h2>Prices from the people who close the deals</h2>
    <p>Valuers already phone local brokers for the real price. Here agents submit those prices directly, every point is checked against the government floor and nearby points, and accurate agents earn credits and a track record lenders can see.</p></div></div>

  <div class="sec"><h3>1 · Your agent profile ${profile ? '<small>' + (profile.verified ? '<span class="st-ok">● RERA format valid</span>' : '') + '</small>' : ''}</h3>
    ${profile ? `<div class="conn"><b>${esc(profile.name)} · ${esc(profile.firm || 'independent')}</b><span class="s">${esc(profile.rera)}</span><small>${esc(profile.state)} · tier ${tier} · ${acc} accepted price point${acc === 1 ? '' : 's'} · ${credits.toFixed(2)} credits</small></div>
      <div class="btns"><button class="btn" id="agOut">Switch agent</button></div>`
    : `<div class="fields">
      <label class="field">Name<input id="agName" placeholder="Priya Kulkarni"></label>
      <label class="field">Firm<input id="agFirm" placeholder="independent"></label>
      <label class="field">RERA registration no.<input id="agRera" placeholder="A51800012345"></label>
      <label class="field">State<select id="agState"><option>Maharashtra</option><option>Gujarat</option><option>Karnataka</option><option>Delhi</option><option>Rajasthan</option><option>Other</option></select></label>
    </div><div class="btns" style="margin-top:8px"><button class="btn pri" id="agJoin">Join as an agent</button></div>
    <p class="hint">We check the number's format here. Full verification looks the number up on the state RERA portal, which has no public API yet, so it is a manual step in this prototype.</p>`}
  </div>

  <div class="sec"><h3>2 · Link your listing accounts <small>CSV import works today</small></h3>
    ${PORTALS.map((p) => `<div class="conn"><b>${p.name}</b><span class="s"><button class="btn" data-portal="${p.id}" style="padding:3px 9px">${openPortal === p.id ? 'Close' : 'Connect'}</button></span>
      ${openPortal === p.id ? `<small style="line-height:1.5">${esc(p.note)}, then import it below. <b>Partner API:</b> not available yet; ${p.name} offers no public agent API, so a live sync needs a partnership. <b>Link a listing:</b> planned, reading the public listing page with your consent.</small>` : `<small>${esc(p.note)}</small>`}</div>`).join('')}
  </div>

  <div class="sec"><h3>3 · Submit prices <small>${profile ? 'closed deals count fully, asking prices at 30%' : 'join first'}</small></h3>
    <textarea id="agCsv" rows="4" style="width:100%;border-radius:9px;border:1px solid var(--line2);background:#060b18;color:var(--ink);font:12px var(--f-mono);padding:8px" placeholder="${CSV_HEADER}"></textarea>
    <div class="btns" style="margin-top:6px"><button class="btn pri" id="agImport" ${profile ? '' : 'disabled'}>Import CSV</button><label class="btn" style="cursor:pointer">Choose file<input type="file" id="agFile" accept=".csv,text/csv" hidden></label><button class="btn" id="agSample">Paste a sample</button>${S.asset ? '<button class="btn" id="agPin">Add price at pinned spot</button>' : ''}</div>
    <p class="hint">Columns: ${CSV_HEADER}. Type is residential, commercial, plot, industrial or agri_land.</p>
  </div>

  <div class="sec"><h3>4 · Every point is checked <small>${list.filter((p) => p.chk.status === 'accepted').length} accepted · ${list.filter((p) => p.chk.status !== 'accepted').length} held for review</small></h3>
    ${list.slice().reverse().map((p) => `<div class="conn" style="border-color:${p.chk.status === 'accepted' ? 'var(--line)' : '#ff547066'}">
      <b>${esc(p.locality || `${p.lat.toFixed(4)}, ${p.lon.toFixed(4)}`)} · ${inr(p.price)} <span style="color:var(--muted);font-weight:400">${p.kind} · ${p.area_sqft.toLocaleString('en-IN')} sq ft · ₹${p.chk.psf.toLocaleString('en-IN')}/sq ft</span></b>
      <span class="s ${p.chk.status === 'accepted' ? 'st-ok' : 'st-error'}">${p.chk.status === 'accepted' ? '● accepted' : '● review'}</span>
      <small>${p.chk.reasons.map(esc).join(' · ')}${p.agent === 'sample' ? ' · <i>sample point</i>' : ''} · via ${esc(p.portal)} · <a href="#" data-fly="${p.id}">show on map</a>${p.agent === 'me' ? ` · <a href="#" data-del="${p.id}">remove</a>` : ''}</small></div>`).join('')}
  </div>

  <div class="sec"><h3>5 · What agents get <small>proposed incentive design</small></h3>
    <div class="conn"><b>Credits for accepted prices</b><span class="s">1 per closed deal</span><small>Redeem as free loan pre-checks for your buyers, so their loans sanction faster and your deals close. Cash (₹25 a point, proposed) only in thin rural markets where few prices exist.</small></div>
    <div class="conn"><b>A track record lenders can see</b><span class="s">Bronze → Gold</span><small>Accuracy against later registered deeds builds your tier. Lenders can route borrower leads to verified agents.</small></div>
    <div class="conn"><b>Rules against gaming</b><span class="s lock">enforced</span><small>A price you submit is never used to value a deal you are part of. Points that miss later deeds lower your tier; repeat outliers are removed.</small></div>
  </div>
  <div class="btns" style="margin-top:10px"><button class="btn" id="agReset">Reset demo data</button></div>`;

  const save = () => { store.set('agentPoints', points); renderAgents(); };
  $('#agJoin')?.addEventListener('click', () => {
    const rera = ($('#agRera').value || '').trim().toUpperCase(), name = ($('#agName').value || '').trim();
    if (!name) return toast('Add your name');
    if (!RERA_RE.test(rera)) return toast('That does not look like a RERA registration number');
    profile = { name, firm: ($('#agFirm').value || '').trim(), rera, state: $('#agState').value, verified: true };
    store.set('agentProfile', profile); toast('Joined. Submit your first prices below'); renderAgents();
  });
  $('#agOut')?.addEventListener('click', () => { profile = null; store.set('agentProfile', null); renderAgents(); });
  el.querySelectorAll('[data-portal]').forEach((b) => (b.onclick = () => { openPortal = openPortal === b.dataset.portal ? null : b.dataset.portal; renderAgents(); }));
  $('#agSample').onclick = () => { $('#agCsv').value = sampleCsv(); };
  $('#agFile').onchange = async (e) => { const f = e.target.files[0]; if (f) $('#agCsv').value = await f.text(); };
  $('#agImport').onclick = () => {
    try {
      const add = parseCsv($('#agCsv').value, openPortal);
      if (!add.length) return toast('No valid rows found');
      points.push(...add); toast(`${add.length} price point${add.length === 1 ? '' : 's'} imported and checked`); save();
    } catch (err) { toast(err.message, 5000); }
  };
  $('#agPin')?.addEventListener('click', () => {
    const area = +prompt('Built-up area (sq ft) or land area (sq ft)?', '1000'); const price = +prompt('Closing price (₹)?', '7500000');
    if (!(area > 0 && price > 0)) return;
    points.push({ id: 'p' + Date.now().toString(36), agent: 'me', locality: 'Pinned spot', state: profile?.state || '', lat: S.asset.lat, lon: S.asset.lon, type: S.assetType === 'agri_land' ? 'agri_land' : isUnit(S.assetType) ? S.assetType : 'plot', area_sqft: area, price, kind: 'closed', date: new Date().toISOString().slice(0, 10), portal: 'manual' });
    save();
  });
  el.querySelectorAll('[data-fly]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); const p = points.find((x) => x.id === a.dataset.fly); if (p) map.flyTo({ center: [p.lon, p.lat], zoom: 14, pitch: 40 }); }));
  el.querySelectorAll('[data-del]').forEach((a) => (a.onclick = (e) => { e.preventDefault(); points = points.filter((x) => x.id !== a.dataset.del); save(); }));
  $('#agReset').onclick = () => { points = SAMPLE.slice(); store.set('agentPoints', null); save(); };
  paint(list);
}

bus.on('mode', (m) => { if (m !== 'agents' && map?.getLayer?.('agents-pt')) map.setLayoutProperty('agents-pt', 'visibility', 'none'); else if (m === 'agents' && map?.getLayer?.('agents-pt')) map.setLayoutProperty('agents-pt', 'visibility', 'visible'); });
