// Command Center bootstrap: boot sequence, modes, layers, keyboard, palette, telemetry.
import { S, bus, store } from './state.js';
import { initMap, map, setLayer, setEpoch, setTool, finishDraw, nightFlight, toggleGlobe, toast, tip } from './map.js';
import { initSearch, searchLocal } from './search.js';
import { renderAssess, renderResult, DEMOS, loadDemo, run } from './assess.js';
import { renderPortfolio } from './portfolio.js';
import { initPulse, render as renderPulse } from './pulse.js';
import { renderApi } from './apiconsole.js';
import { renderFabric, probeAll, health } from './fabric.js';
import { renderInBuild } from './inbuild.js';
import { renderAgents } from './agents.js';
import { log } from './engine-env.js';

const $ = (s) => document.querySelector(s);
const params = new URLSearchParams(location.search);
S.offline = params.get('offline') === '1' || store.get('offline', false);
S.tenant = store.get('tenant', 'default');
const EMBED = params.get('embed') === '1', TOUR = params.get('tour') === '1';
if (EMBED) document.body.classList.add('embed');

// ---------- boot ----------
const bootLines = $('#bootLines'), bootBar = $('#bootBar');
const step = (txt, pct) => { const d = document.createElement('div'); d.innerHTML = `› ${txt} <span>ok</span>`; bootLines.appendChild(d); bootBar.style.width = pct + '%'; };
async function boot() {
  step('collateral engine v2.0 · model cqs-2026.11', 10);
  await initMap({ offline: S.offline });
  step(`globe online · 735 district boundaries · ${S.cities.length.toLocaleString('en-IN')} settlements for the light model`, 45);
  initSearch(); initPulse();
  step('search: Photon · Nominatim · PIN · coordinates', 60);
  const probing = probeAll().then((h) => {
    const bad = Object.values(h).filter((x) => x.status === 'error').length;
    if (!S.offline && bad >= Object.keys(h).length - 1) { setOffline(true, true); }
  });
  step('probing 12 public data pipes in parallel', 78);
  await Promise.race([probing, new Promise((r) => setTimeout(r, EMBED ? 900 : 2200))]);
  step('NASA VIIRS night lights · Sentinel-2 · GloFAS · ERA5 · OSM · India Post', 100);
  await new Promise((r) => setTimeout(r, 450));
  $('#boot').classList.add('done');
  map.flyTo({ center: [79.5, 22.3], zoom: window.innerWidth < 900 ? 3.4 : 4.15, speed: 0.55, curve: 1.3, essential: true });
  log('BhoomiPulse Command Center ready · press / to search · Ctrl+K for commands', 'hl');
  const last = store.get('lastResult', null);
  if (last && !params.get('fresh')) { S.lastResult = last; }
  setMode(params.get('mode') || 'assess');
  if (params.get('demo') != null) { const d = DEMOS[+params.get('demo') || 0]; if (d) setTimeout(() => loadDemo(d, true), 2500); }
  if (EMBED) { $('#drawer').classList.add('closed'); $('[data-drawer=layers]').classList.remove('on'); }
  if (TOUR) setTimeout(tour, 2600);
}

// ---------- guided tour (used by the presentation's live-demo slide: ?embed=1&tour=1) ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function typeInto(el, text) { el.focus(); el.value = ''; for (const ch of text) { el.value += ch; el.dispatchEvent(new Event('input')); await sleep(85); } }
async function tour() {
  const cap = (t) => tip(t);
  cap('1 · Search any address, village, PIN code or coordinates');
  await typeInto($('#searchInput'), 'Hinjewadi, Pune');
  await sleep(1600); $('#searchInput').blur(); $('#searchResults').classList.remove('open');
  cap('2 · Fly in and pin the exact asset');
  setMode('assess');
  const done = new Promise((r) => bus.on('assessed', r));
  loadDemo(DEMOS[2], true);
  await sleep(3500);
  cap('3 · Ten live public sources fused in parallel');
  await Promise.race([done, sleep(30000)]);
  cap('4 · Grade, value range, realisable value, LTV band and red flags');
  const panel = $('#panelInner');
  for (let y = 0; y <= 1500; y += 30) { panel.scrollTop = y; await sleep(55); }
  await sleep(1200); panel.scrollTop = 0;
  cap('5 · Re-value a whole loan book against today\'s market and the government floor');
  setMode('portfolio'); await sleep(4200);
  cap('6 · Plug it into any lending stack with one API call');
  setMode('api'); await sleep(4500);
  cap('Night flight over India · press F any time');
  setMode('assess');
  await nightFlight();
}

// ---------- modes ----------
function setMode(m) {
  S.mode = m;
  const IB = ['inbuild', 'investor', 'branch'];
  document.querySelectorAll('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m || (b.dataset.mode === 'inbuild' && IB.includes(m))));
  ({ assess: renderAssess, portfolio: renderPortfolio, api: renderApi, sources: renderFabric, inbuild: () => renderInBuild(), pulse: renderPulse, agents: renderAgents, investor: () => renderInBuild('investor'), branch: () => renderInBuild('branch') })[m]?.();
}
bus.on('mode', setMode);
document.getElementById('modes').onclick = (e) => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); };
bus.on('asset', () => { S.lastResult = null; S.editing = true; if (S.mode !== 'assess') setMode('assess'); else renderAssess(); });

// ---------- offline ----------
function setOffline(on, auto) {
  S.offline = on; store.set('offline', on);
  $('#simBanner').hidden = !on;
  document.body.style.setProperty('--banner', on ? '26px' : '0px');
  bus.emit('offline', on);
  if (auto) toast('No internet detected · switched to offline demo mode (simulated data)', 4500);
  probeAll().then(() => { if (S.mode === 'sources') renderFabric(); });
}
$('#simOff').onclick = () => setOffline(false);
if (S.offline) $('#simBanner').hidden = false;

// ---------- rail & drawer ----------
$('#rail').onclick = (e) => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.drawer) { const d = $('#drawer'); d.classList.toggle('closed'); b.classList.toggle('on', !d.classList.contains('closed')); }
  if (b.dataset.tool) setTool(S.tool === b.dataset.tool ? null : b.dataset.tool);
  if (b.dataset.action === 'flight') nightFlight();
  if (b.dataset.action === 'globe') toggleGlobe();
  if (b.dataset.action === 'sat') { const on = !S.layers.satellite; setLayer('satellite', on); $('[data-layer=satellite]').checked = on; }
  if (b.dataset.action === 'offline') setOffline(!S.offline);
};
bus.on('tool', (t) => document.querySelectorAll('#rail [data-tool]').forEach((b) => b.classList.toggle('on', b.dataset.tool === t)));
$('#drawerClose').onclick = () => { $('#drawer').classList.add('closed'); $('[data-drawer=layers]').classList.remove('on'); };
$('#drawer').addEventListener('change', (e) => { const k = e.target.dataset.layer; if (k) setLayer(k, e.target.checked); });
$('#sparkleIntensity').oninput = (e) => (S.sparkleIntensity = +e.target.value);
$('#epochBox').onclick = (e) => { const b = e.target.closest('button'); if (!b) return; document.querySelectorAll('#epochBox button').forEach((x) => x.classList.toggle('on', x === b)); setEpoch(b.dataset.epoch); toast(b.dataset.epoch === 'nightly' ? 'Last night’s VIIRS pass (clouds and moonlight included)' : `VIIRS Black Marble ${b.dataset.epoch.slice(0, 4)}`); };
$('#consoleToggle').onclick = () => { $('#console').classList.toggle('min'); };
if (window.innerWidth < 1280) { $('#drawer').classList.add('closed'); $('[data-drawer=layers]').classList.remove('on'); }

// ---------- telemetry ----------
setInterval(() => { $('#clock').textContent = new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Kolkata' }); }, 1000);
bus.on('health', (h) => {
  const v = Object.values(h); const ok = v.filter((x) => x.status === 'ok').length;
  const dot = $('#srcChip .dot');
  if (S.offline) { dot.className = 'dot warn'; $('#srcChipText').textContent = 'Simulated sources'; return; }
  dot.className = 'dot ' + (ok >= v.length - 1 ? 'ok' : ok >= v.length / 2 ? 'warn' : 'bad');
  $('#srcChipText').textContent = `${ok}/${v.length} sources live`;
});
$('#srcChip').onclick = () => setMode('sources');

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openPalette(); return; }
  if (e.key === 'Escape') { closePalette(); if (S.tool) setTool(null); return; }
  if (S.tool === 'draw' && e.key === 'Enter') { finishDraw(); return; }
  if (typing) return;
  const k = e.key.toLowerCase();
  if (k === '/') { e.preventDefault(); $('#searchInput').focus(); }
  else if (k === 'p') setTool(S.tool === 'pick' ? null : 'pick');
  else if (k === 'b') setTool(S.tool === 'draw' ? null : 'draw');
  else if (k === 'f') nightFlight();
  else if (k === 'g') toggleGlobe();
  else if (k === 's') { const on = !S.layers.satellite; setLayer('satellite', on); $('[data-layer=satellite]').checked = on; }
  else if (k === 'l') $('[data-drawer=layers]').click();
  else if (k === 'r' && S.mode === 'assess' && S.asset) run();
  else if (/^[1-7]$/.test(k)) setMode(['assess', 'portfolio', 'pulse', 'agents', 'api', 'sources', 'inbuild'][+k - 1]);
});

// ---------- command palette ----------
const COMMANDS = [
  ['Assess mode', '1', () => setMode('assess')], ['Portfolio: book re-valuation', '2', () => setMode('portfolio')], ['Pulse: monthly re-check of the book', '3', () => setMode('pulse')], ['Property agents: join, link listings, submit prices', '4', () => setMode('agents')], ['API console', '5', () => setMode('api')], ['Data fabric', '6', () => setMode('sources')],
  ['In build: Investor Lens, Branch Intelligence', '7', () => setMode('inbuild')],
  ['Night flight over India', 'F', nightFlight], ['Toggle globe', 'G', toggleGlobe], ['Toggle satellite', 'S', () => { const on = !S.layers.satellite; setLayer('satellite', on); $('[data-layer=satellite]').checked = on; }],
  ['Drop a pin on the asset', 'P', () => setTool('pick')], ['Draw parcel boundary', 'B', () => setTool('draw')],
  ['Night lights: 2012', '', () => setEpoch('2012-01-01')], ['Night lights: 2016', '', () => setEpoch('2016-01-01')], ['Night lights: last night', '', () => setEpoch('nightly')],
  ['Toggle MODIS flood layer', '', () => { const on = !S.layers.flood; setLayer('flood', on); $('[data-layer=flood]').checked = on; }],
  ['Toggle MODIS NDVI layer', '', () => { const on = !S.layers.ndvi; setLayer('ndvi', on); $('[data-layer=ndvi]').checked = on; }],
  ['Offline demo mode on/off', '', () => setOffline(!S.offline)],
  ...DEMOS.map((d) => [`Sample: ${d.name}`, 'demo', () => { setMode('assess'); loadDemo(d, true); }]),
];
let pItems = [], pSel = 0;
function openPalette() { $('#palette').hidden = false; const i = $('#paletteInput'); i.value = ''; i.focus(); renderPalette(''); }
function closePalette() { $('#palette').hidden = true; }
function renderPalette(q) {
  const n = q.toLowerCase();
  pItems = COMMANDS.filter(([t]) => t.toLowerCase().includes(n)).map(([t, k, f]) => ({ t, k, f }));
  if (n.length >= 2) pItems.push(...searchLocal(q).slice(0, 5).map((c) => ({ t: `Fly to ${c.name}`, k: c.kind, f: () => map.flyTo({ center: [c.lon, c.lat], zoom: c.zoom || 11, pitch: 40 }) })));
  pSel = 0; $('#paletteList').innerHTML = pItems.map((p, i) => `<div class="pi${i === pSel ? ' on' : ''}" data-i="${i}"><span>${p.t}</span><small>${p.k}</small></div>`).join('');
}
$('#paletteInput').oninput = (e) => renderPalette(e.target.value);
$('#paletteInput').onkeydown = (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { pSel = Math.max(0, Math.min(pItems.length - 1, pSel + (e.key === 'ArrowDown' ? 1 : -1))); document.querySelectorAll('.pi').forEach((x, i) => x.classList.toggle('on', i === pSel)); e.preventDefault(); }
  if (e.key === 'Enter' && pItems[pSel]) { closePalette(); pItems[pSel].f(); }
};
$('#paletteList').onclick = (e) => { const r = e.target.closest('.pi'); if (r) { closePalette(); pItems[+r.dataset.i].f(); } };
$('#palette').onclick = (e) => { if (e.target.id === 'palette') closePalette(); };
$('#paletteBtn').onclick = openPalette;
bus.on('basemap:error', () => { if (!S._basemapWarned) { S._basemapWarned = true; log('Vector basemap unreachable · night-light and boundary layers still active', 'err'); } });
bus.on('assessed', () => tip(''));

boot().catch((e) => { console.error(e); $('#bootLines').insertAdjacentHTML('beforeend', `<div style="color:#ff5470">boot error: ${e.message}</div>`); setTimeout(() => $('#boot').classList.add('done'), 1500); });
