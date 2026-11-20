// Portfolio screening (lenders) and Investor lens (co-lending partners, pool buyers, equity investors).
import { assessMany, portfolioAudit, ASSET_TYPES } from '../../engine/index.js';
import { inr, round, quantile, mean } from '../../engine/util.js';
import { S, bus } from './state.js';
import { engineEnv, log, consoleStat } from './engine-env.js';
import { setPortfolio, fitTo, map, toast, setAsset } from './map.js';
import { bars, mount } from './charts.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
let running = false, progress = [0, 0];

// Sample book: synthetic loans placed around real western-India towns (labelled SAMPLE everywhere it appears).
export function sampleBook(n = 90) {
  let s = 7; const r = () => ((s = Math.imul(s ^ (s >>> 13), 1103515245) + 12345 >>> 0) / 4294967296);
  const towns = S.cities.filter(([lon, lat, pop]) => pop > 40000 && lon > 70 && lon < 78.5 && lat > 15.5 && lat < 24.5);
  const types = [['residential', 0.42], ['commercial', 0.14], ['industrial', 0.16], ['agri_land', 0.18], ['plot', 0.1]];
  const pick = () => { let x = r(), a = 0; for (const [t, w] of types) { a += w; if (x <= a) return t; } return 'residential'; };
  return Array.from({ length: n }, (_, i) => {
    const [lon, lat, , name] = towns[Math.floor(r() * r() * towns.length)];
    const t = pick(); const far = t === 'agri_land' ? 6 + r() * 14 : t === 'industrial' ? 2 + r() * 8 : r() * 5;
    const ang = r() * 6.283;
    const loan = Math.round({ residential: 2.2e6, commercial: 4.5e6, industrial: 1.2e7, agri_land: 9e5, plot: 1.4e6 }[t] * Math.exp((r() - 0.5) * 1.2) / 5e4) * 5e4;
    return { reference_id: `SMPL-${String(i + 1).padStart(4, '0')}`, borrower_town: name, asset_type: t, lat: +(lat + far / 111 * Math.sin(ang)).toFixed(5), lon: +(lon + far / 111 * Math.cos(ang) / Math.cos(lat * Math.PI / 180)).toFixed(5), loan_amount: loan, area_sqm: t === 'agri_land' ? Math.round(4000 + r() * 30000) : t === 'industrial' ? Math.round(1500 + r() * 9000) : t === 'plot' ? Math.round(120 + r() * 400) : null, built_up_sqft: ['residential', 'commercial'].includes(t) ? Math.round(650 + r() * 1600) : null, declared_value: r() < 0.25 ? Math.round(loan / (0.45 + r() * 0.35) / 1e4) * 1e4 : null };
  });
}

export function parseCSV(text) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (cur !== '' || row.length) { row.push(cur); rows.push(row); row = []; cur = ''; } if (c === '\r' && text[i + 1] === '\n') i++; } else cur += c;
  }
  if (cur !== '' || row.length) { row.push(cur); rows.push(row); }
  const head = rows.shift().map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  const alias = { latitude: 'lat', longitude: 'lon', lng: 'lon', type: 'asset_type', loan: 'loan_amount', amount: 'loan_amount', ref: 'reference_id', id: 'reference_id', loan_id: 'reference_id' };
  return rows.filter((x) => x.length > 1).map((x) => { const o = {}; head.forEach((h, i) => { const k = alias[h] || h; const v = (x[i] ?? '').trim(); o[k] = v === '' ? null : isNaN(+v) || k === 'reference_id' ? v : +v; }); if (!ASSET_TYPES[o.asset_type]) o.asset_type = 'residential'; return o; }).filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lon));
}
const toCSV = (rows) => { const cols = ['reference_id', 'asset_type', 'lat', 'lon', 'district', 'state', 'loan_amount', 'grade', 'cqs', 'p10', 'p50', 'p90', 'realisable', 'recommended_ltv', 'actual_ltv', 'flood', 'flags']; return [cols.join(','), ...rows.map((r) => cols.map((c) => JSON.stringify(r[c] ?? '')).join(','))].join('\n'); };
const flat = (inp, r) => r && !r.error ? { ...inp, district: r.location.district, state: r.location.state, grade: r.score.grade, cqs: r.score.cqs, p10: r.valuation.p10, p50: r.valuation.p50, p90: r.valuation.p90, realisable: r.liquidity.realisable_value, recommended_ltv: r.lending.recommended_ltv, actual_ltv: r.lending.actual_ltv, flood: r.hazards.flood, flags: r.flags.map((f) => f.code).join(' '), _r: r } : { ...inp, grade: null, error: r?.error };

export function renderPortfolio() {
  const el = $('#panelInner'); const rows = S.portfolio; const res = S.portfolioResults;
  const audit = res.length ? portfolioAudit(res.map((x) => x._r).filter(Boolean)) : null;
  el.innerHTML = `
  <div class="ph"><div><div class="kicker">PORTFOLIO SCREENING</div><h2>Score a whole loan book</h2><p>Upload loans with coordinates; every asset is screened on terrain, river flood history, climate and night-time activity.</p></div></div>
  <div class="sec"><div class="drop" id="drop">Drop a CSV here or <u>choose a file</u><br><small>columns: reference_id, lat, lon, asset_type, loan_amount, area_sqm, built_up_sqft, declared_value</small><input type="file" id="file" accept=".csv,text/csv" hidden></div>
  <div class="btns"><button class="btn pri" id="sampleBtn">Load sample NBFC book (90 loans)</button>${rows.length ? `<button class="btn" id="runBtn" ${running ? 'disabled' : ''}>${running ? 'Screening…' : `▶ Screen ${rows.length} loans`}</button>` : ''}${res.length ? '<button class="btn" id="csvBtn">⤓ Results CSV</button>' : ''}</div>
  ${rows.length && rows[0].reference_id?.startsWith('SMPL') ? '<p class="hint">SAMPLE book: synthetic loans placed around real towns in Gujarat, Maharashtra and Karnataka. The screening calls are live.</p>' : ''}
  ${running ? `<div class="sec"><div class="prog"><i id="pfProg" style="width:${(progress[0] / Math.max(1, progress[1])) * 100}%"></i></div><p class="hint" id="pfProgT">${progress[0]} / ${progress[1]} screened</p></div>` : ''}</div>
  ${audit ? `
  <div class="sec"><div class="kpis">
    <div class="kpi"><span>Book grade</span><b class="amber">${audit.book_grade}</b></div>
    <div class="kpi"><span>Weighted CQS</span><b>${audit.exposure_weighted_cqs}</b></div>
    <div class="kpi"><span>Exposure</span><b>${inr(audit.exposure)}</b></div>
    <div class="kpi"><span>12-m expected loss</span><b>${inr(audit.expected_loss_12m)}</b></div>
    <div class="kpi"><span>LTV breaches</span><b style="color:#ff8fa1">${audit.ltv_breaches.count}</b></div>
    <div class="kpi"><span>High flood exposure</span><b class="cyan">${audit.high_flood_exposure.count}</b></div></div></div>
  <div class="sec"><h3>Grade mix <small>by count</small></h3><div class="fig" id="gradeFig" style="height:84px"></div></div>
  <div class="sec"><h3>Concentration <small>HHI ${audit.concentration.hhi}</small></h3><table class="t">${audit.concentration.districts.slice(0, 6).map((d) => `<tr><td>${esc(d.district)}</td><td class="n">${d.loans}</td><td class="n">${Math.round((d.share || 0) * 100)}%</td><td class="n">${d.mean_cqs}</td></tr>`).join('')}</table></div>
  <div class="sec"><h3>Loans <small>click to fly · ⚡ = deep assessment</small></h3><div class="scroll" style="max-height:300px;overflow-y:auto"><table class="t" id="pfTable"><tr><th>Ref</th><th>Type</th><th>Gr</th><th class="n">P50</th><th class="n">LTV</th><th>Flags</th><th></th></tr>
  ${res.map((x, i) => `<tr data-i="${i}" style="cursor:pointer"><td>${esc(x.reference_id)}<br><small style="color:#71809f">${esc(x.district || x.borrower_town || '')}</small></td><td>${esc(x.asset_type.replace('_land', ''))}</td><td>${x.grade ? `<span class="grade-pill g${x.grade}">${x.grade}</span>` : '✕'}</td><td class="n">${inr(x.p50)}</td><td class="n" style="${x.actual_ltv > x.recommended_ltv ? 'color:#ff8fa1' : ''}">${x.actual_ltv != null ? Math.round(x.actual_ltv * 100) + '%' : '—'}</td><td style="font-size:10.5px;color:#ffb985">${esc((x.flags || '').replace(/_/g, ' ').toLowerCase())}</td><td><button class="btn" data-deep="${i}" style="padding:3px 7px">⚡</button></td></tr>`).join('')}</table></div></div>` : ''}`;
  const file = $('#file'), drop = $('#drop');
  drop.onclick = () => file.click();
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); }; drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) f.text().then(load); };
  file.onchange = () => file.files[0]?.text().then(load);
  $('#sampleBtn').onclick = () => { S.portfolio = sampleBook(); S.portfolioResults = []; setPortfolio(S.portfolio); fitTo(S.portfolio); renderPortfolio(); toast('Sample book loaded · press Screen'); };
  if ($('#runBtn')) $('#runBtn').onclick = screen;
  if ($('#csvBtn')) $('#csvBtn').onclick = () => { const b = new Blob([toCSV(S.portfolioResults)], { type: 'text/csv' }); const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(b), download: 'bhoomipulse_screen.csv' }); a.click(); };
  if (audit) {
    bars($('#gradeFig'), Object.entries(audit.grade_mix).map(([g, n]) => [g, n, g === 'E' || g === 'D']), { color: '#ffb547' });
    el.querySelectorAll('#pfTable tr[data-i]').forEach((tr) => tr.onclick = (e) => { if (e.target.closest('[data-deep]')) return; const x = S.portfolioResults[+tr.dataset.i]; map.flyTo({ center: [x.lon, x.lat], zoom: 15, pitch: 40 }); });
    el.querySelectorAll('[data-deep]').forEach((b) => b.onclick = () => deep(S.portfolioResults[+b.dataset.deep]));
  }
}
function load(text) {
  try { S.portfolio = parseCSV(text); S.portfolioResults = []; setPortfolio(S.portfolio); fitTo(S.portfolio); toast(`${S.portfolio.length} loans loaded`); renderPortfolio(); }
  catch (e) { toast('Could not read CSV: ' + e.message); }
}
export async function screen() {
  if (running || !S.portfolio.length) return;
  running = true; progress = [0, S.portfolio.length]; renderPortfolio();
  const n = S.portfolio.length;
  log(`<span class="hl">BOOK SCREEN</span> ${n} loans · fast mode${S.offline ? ' · SIMULATED' : ''}`); consoleStat('screening book…');
  const env = engineEnv({ disabled: n > 60 ? ['climate'] : [] });
  const t0 = Date.now();
  const res = await assessMany(S.portfolio, env, { mode: 'fast', concurrency: 8, onProgress: (d, t, r) => {
    progress = [d, t]; const p = document.getElementById('pfProg'); if (p) p.style.width = (d / t) * 100 + '%'; const pt = document.getElementById('pfProgT'); if (pt) pt.textContent = `${d} / ${t} screened`;
    if (r && !r.error) log(`  ${r.input && S.portfolio.find((x) => x.lat === r.input.lat)?.reference_id || ''} → ${r.score.grade} (${r.score.cqs}) ${r.flags.map((f) => f.code).join(' ')}`);
  } });
  S.portfolioResults = S.portfolio.map((inp, i) => flat(inp, res[i]));
  setPortfolio(S.portfolioResults);
  running = false; consoleStat(`book screened in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  log(`<span class="hl">BOOK</span> grade ${portfolioAudit(res).book_grade} · ${res.filter((r) => !r.error).length}/${n} scored`);
  bus.emit('portfolio:done');
  if (S.mode === 'portfolio') renderPortfolio(); else if (S.mode === 'investor') renderInvestor();
}
function deep(x) { S.assetType = x.asset_type; setAsset(x.lat, x.lon, { fly: true, label: x.reference_id }); if (x.area_sqm) S.asset.area_sqm = x.area_sqm; S.lastResult = null; S.editing = true; bus.emit('mode', 'assess'); }
bus.on('portfolio:click', (i) => { const x = (S.portfolioResults.length ? S.portfolioResults : S.portfolio)[i]; if (!x) return; new window.maplibregl.Popup({ closeButton: false }).setLngLat([x.lon, x.lat]).setHTML(`<b>${esc(x.reference_id)}</b> · ${esc(x.asset_type)}<br>Loan ${inr(x.loan_amount)}${x.grade ? `<br>Grade <b>${x.grade}</b> (${x.cqs}) · P50 ${inr(x.p50)}<br><span style="color:#ffb985">${esc(x.flags || '')}</span>` : ''}`).addTo(map); });

// ---------------- Investor lens ----------------
let stress = { shock: 0, haircut: 0, flood: false, pd: 1 };
function stressed() {
  const rows = S.portfolioResults.filter((x) => x._r);
  return rows.map((x) => {
    const r = x._r, V = r.valuation.p50, loan = x.loan_amount || 0;
    const floodHit = stress.flood && (r.hazards.flood ?? 0) >= 50 ? 0.85 : 1;
    const V2 = V * (1 + stress.shock) * floodHit;
    const h = Math.min(0.8, r.liquidity.forced_sale_haircut + stress.haircut);
    const real = r.liquidity.realisable_value * (V2 / V) * ((1 - h) / (1 - r.liquidity.forced_sale_haircut));
    const lgd = loan ? Math.min(1, Math.max(0.05, 1 - real / loan + 0.02)) : 0;
    const pd = Math.min(0.9, r.lending.pd_12m * stress.pd * (stress.flood && floodHit < 1 ? 1.5 : 1));
    return { x, loan, real, cover: loan ? real / loan : null, el: pd * lgd * loan, decl: x.declared_value ? x.declared_value / V : null };
  });
}
export function renderInvestor() {
  const el = $('#panelInner');
  if (!S.portfolioResults.length && running) { el.innerHTML = `<div class="ph"><div><div class="kicker">INVESTOR LENS</div><h2>Screening the book…</h2><p>${progress[0]} of ${progress[1]} loans scored. The certificate appears when the screen finishes.</p></div></div><div class="empty"><div class="radar-anim"></div></div>`; return; }
  if (!S.portfolioResults.length) {
    el.innerHTML = `<div class="ph"><div><div class="kicker">INVESTOR LENS</div><h2>Diligence a lender's collateral in minutes</h2><p>For co-lending banks, PTC / direct-assignment pool buyers, rating analysts and equity investors evaluating an NBFC: grade the collateral behind every loan, then stress it.</p></div></div>
    <div class="empty"><div class="radar-anim"></div><div class="big">No book screened yet</div><p>Load the sample NBFC book or upload a data tape in Portfolio, screen it, then come back here.</p><button class="btn pri" id="goPf">Load and screen the sample book</button></div>`;
    $('#goPf').onclick = async () => { S.portfolio = sampleBook(); setPortfolio(S.portfolio); fitTo(S.portfolio); renderInvestor(); await screen(); };
    return;
  }
  const rows = stressed(); const exp = rows.reduce((s, r) => s + r.loan, 0); const el12 = rows.reduce((s, r) => s + r.el, 0);
  const wcover = rows.reduce((s, r) => s + r.real, 0) / (exp || 1);
  const under = rows.filter((r) => r.cover != null && r.cover < 1); const underExp = under.reduce((s, r) => s + r.loan, 0);
  const decl = rows.map((r) => r.decl).filter(Number.isFinite); const inflation = decl.length ? quantile(decl, 0.5) : null;
  const audit = portfolioAudit(rows.map((r) => r.x._r));
  const verdictScore = Math.round(Math.max(0, Math.min(100, 100 * (0.45 * Math.min(1, wcover / 1.6) + 0.35 * (1 - underExp / (exp || 1)) + 0.2 * audit.exposure_weighted_cqs / 100))));
  const vg = verdictScore >= 80 ? 'A' : verdictScore >= 68 ? 'B' : verdictScore >= 55 ? 'C' : verdictScore >= 42 ? 'D' : 'E';
  el.innerHTML = `
  <div class="ph"><div><div class="kicker">INVESTOR LENS · ${rows.length} LOANS · ${inr(exp)}</div><h2>Collateral quality certificate</h2><p>What a co-lender, pool buyer or equity investor would see before committing capital.</p></div></div>
  <div class="hero" style="grid-template-columns:132px 1fr">${dialHTML(verdictScore, vg)}<div><div class="route ${vg <= 'B' ? 'fast_track' : vg === 'C' ? 'verify' : 'refer'}">${vg <= 'B' ? 'Collateral supports the book at this stress' : vg === 'C' ? 'Acceptable with tighter LTV or credit enhancement' : 'Collateral does not support the book at this stress'}</div>
  <div class="kpis" style="grid-template-columns:1fr 1fr;margin-top:8px"><div class="kpi"><span>Realisable cover</span><b class="amber">${wcover.toFixed(2)}×</b></div><div class="kpi"><span>Under-covered exposure</span><b style="color:#ff8fa1">${Math.round((underExp / (exp || 1)) * 100)}%</b></div></div></div></div>
  <div class="sec"><h3>Stress test</h3>
    <div class="slider" style="padding-left:0"><span style="width:150px">Price shock <b id="v1">${Math.round(stress.shock * 100)}%</b></span><input type="range" id="s1" min="-0.4" max="0" step="0.05" value="${stress.shock}"></div>
    <div class="slider" style="padding-left:0"><span style="width:150px">Extra haircut <b id="v2">+${Math.round(stress.haircut * 100)} pp</b></span><input type="range" id="s2" min="0" max="0.25" step="0.01" value="${stress.haircut}"></div>
    <div class="slider" style="padding-left:0"><span style="width:150px">PD multiplier <b id="v3">${stress.pd.toFixed(1)}×</b></span><input type="range" id="s3" min="1" max="4" step="0.1" value="${stress.pd}"></div>
    <label class="tgl"><input type="checkbox" id="s4" ${stress.flood ? 'checked' : ''}><span></span>Monsoon flood event (assets with flood score ≥ 50 lose 15% value, PD ×1.5)</label></div>
  <div class="sec"><div class="kpis">
    <div class="kpi"><span>Stressed 12-m EL</span><b>${inr(el12)}</b></div><div class="kpi"><span>EL rate</span><b class="amber">${((el12 / (exp || 1)) * 100).toFixed(2)}%</b></div><div class="kpi"><span>Book CQS</span><b>${audit.exposure_weighted_cqs}</b></div>
    <div class="kpi"><span>Declared ÷ model</span><b style="${inflation > 1.15 ? 'color:#ff8fa1' : ''}">${inflation ? inflation.toFixed(2) + '×' : '—'}</b></div><div class="kpi"><span>Top district</span><b style="font-size:12px">${esc(audit.concentration.top_district?.district?.split(',')[0] || '—')} ${Math.round((audit.concentration.top_district?.share || 0) * 100)}%</b></div><div class="kpi"><span>Flood-exposed</span><b class="cyan">${Math.round((audit.high_flood_exposure.exposure / (exp || 1)) * 100)}%</b></div></div></div>
  <div class="sec"><h3>Realisable cover per loan <small>realisable value ÷ loan</small></h3><div class="fig" id="coverFig" style="height:110px"></div></div>
  <div class="sec"><h3>Weakest 8 loans under this stress</h3><table class="t">${[...rows].sort((a, b) => (a.cover ?? 9) - (b.cover ?? 9)).slice(0, 8).map((r) => `<tr><td>${esc(r.x.reference_id)}<br><small style="color:#71809f">${esc(r.x.asset_type)} · ${esc(r.x.district || '')}</small></td><td class="n">${inr(r.loan)}</td><td class="n" style="color:${r.cover < 1 ? '#ff8fa1' : '#8ff5bf'}">${r.cover?.toFixed(2)}×</td><td class="n">${inr(r.el)}</td></tr>`).join('')}</table></div>
  <div class="btns"><button class="btn pri" id="certBtn">⎙ Export certificate</button><button class="btn" id="pfBack">Open book</button></div>
  <p class="hint">Use: co-lending partner checks under the 2025 co-lending directions, PTC/DA pool selection, rating surveillance, and equity diligence on lenders. Values are model estimates from public data, not a substitute for the originator's valuations.</p>`;
  const bind = (id, k, f) => { $(id).oninput = (e) => { stress[k] = f(e.target.value); renderInvestor(); }; };
  bind('#s1', 'shock', Number); bind('#s2', 'haircut', Number); bind('#s3', 'pd', Number);
  $('#s4').onchange = (e) => { stress.flood = e.target.checked; renderInvestor(); };
  animateDial(el);
  const bins = [0, 0.5, 0.8, 1, 1.2, 1.5, 2, 3, 99]; const cnt = bins.slice(0, -1).map((b, i) => [`${b}–${bins[i + 1] > 9 ? '+' : bins[i + 1]}`, rows.filter((r) => r.cover >= b && r.cover < bins[i + 1]).length, bins[i + 1] <= 1]);
  mount($('#coverFig'), (W, H) => { const hi = Math.max(...cnt.map((c) => c[1])) || 1, bw = W / cnt.length; return cnt.map(([k, v, bad], i) => { const h = (H - 26) * v / hi; return `<rect x="${i * bw + 3}" y="${H - 16 - h}" width="${bw - 6}" height="${h}" rx="3" fill="${bad ? '#ff5470' : '#ffb547'}" opacity=".85"/><text x="${i * bw + bw / 2}" y="${H - 3}" fill="#71809f" font-size="9.5" text-anchor="middle" font-family="JetBrains Mono">${k}</text><text x="${i * bw + bw / 2}" y="${H - 20 - h}" fill="#a9b6d3" font-size="10" text-anchor="middle">${v || ''}</text>`; }).join(''); });
  $('#pfBack').onclick = () => bus.emit('mode', 'portfolio');
  $('#certBtn').onclick = () => { const w = window.open('', '_blank'); if (!w) return toast('Allow pop-ups'); w.document.write(`<!doctype html><title>Collateral quality certificate</title><body style="font:14px Inter,system-ui;max-width:760px;margin:30px auto;color:#111"><h1>Collateral quality certificate</h1><p>${rows.length} loans · exposure ${inr(exp)} · generated ${new Date().toISOString().slice(0, 16)} UTC by BhoomiPulse${S.offline ? ' (SIMULATED DATA)' : ''}</p><h2>Verdict: ${vg} (${verdictScore}/100)</h2><ul><li>Exposure-weighted collateral quality score: ${audit.exposure_weighted_cqs}</li><li>Realisable cover: ${wcover.toFixed(2)}×</li><li>Under-covered exposure: ${Math.round((underExp / (exp || 1)) * 100)}%</li><li>Stressed 12-month expected loss: ${inr(el12)} (${((el12 / (exp || 1)) * 100).toFixed(2)}%)</li><li>Stress: price ${Math.round(stress.shock * 100)}%, haircut +${Math.round(stress.haircut * 100)} pp, PD ×${stress.pd}, flood event ${stress.flood ? 'on' : 'off'}</li><li>Grade mix: ${Object.entries(audit.grade_mix).map(([g, n]) => g + ' ' + n).join(', ')}</li><li>Top district concentration: ${audit.concentration.top_district?.district} (${Math.round((audit.concentration.top_district?.share || 0) * 100)}%)</li></ul><p style="color:#666;font-size:12px">Model estimates from public data (OpenStreetMap, Copernicus DEM, GloFAS, ERA5, VIIRS, Sentinel-2). Not a registered valuation.</p></body>`); w.document.close(); };
}
function dialHTML(score, grade) { const r = 56, c = 2 * Math.PI * r; const col = { A: '#3ee08f', B: '#a6e36b', C: '#ffd166', D: '#ff9a3d', E: '#ff5470' }[grade]; return `<div class="dial"><svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="${r}" stroke="#ffffff12" stroke-width="9"/><circle cx="66" cy="66" r="${r}" stroke="${col}" stroke-width="9" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - score / 100)}" style="filter:drop-shadow(0 0 6px ${col})"/></svg><div class="g"><div><b style="color:${col}">${grade}</b><small>${score}/100</small></div></div></div>`; }
function animateDial() {}
