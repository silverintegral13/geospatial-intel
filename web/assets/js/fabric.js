// Data fabric: live health of every upstream, enterprise connectors, benchmarks, and the flow diagram.
import { SOURCES, ENTERPRISE_CONNECTORS, BENCHMARK_SOURCES } from '../../engine/index.js';
import { OVERPASS } from '../../engine/sources/osm.js';
import { S, bus } from './state.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const today = new Date(Date.now() - 3 * 864e5).toISOString().slice(0, 10);
const PROBES = {
  geocode: { url: 'https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=23.0225&lon=72.5714&zoom=10' },
  osm: { url: OVERPASS[0], mirrors: OVERPASS, init: { method: 'POST', body: 'data=' + encodeURIComponent('[out:json][timeout:5];node(1);out ids;'), headers: { 'Content-Type': 'application/x-www-form-urlencoded' } } },
  terrain: { url: 'https://api.open-meteo.com/v1/elevation?latitude=23.02&longitude=72.57' },
  flood: { url: 'https://flood-api.open-meteo.com/v1/flood?latitude=23.02&longitude=72.57&daily=river_discharge&forecast_days=1' },
  climate: { url: `https://archive-api.open-meteo.com/v1/archive?latitude=23.02&longitude=72.57&start_date=${today}&end_date=${today}&daily=precipitation_sum` },
  nightlights: { url: 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/VIIRS_Black_Marble/default/2016-01-01/GoogleMapsCompatible_Level8/4/6/11.png' },
  sentinel2: { url: 'https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-2-l2a' },
  landcover: { url: 'https://planetarycomputer.microsoft.com/api/stac/v1/collections/io-lulc-annual-v02' },
  water: { url: 'https://planetarycomputer.microsoft.com/api/stac/v1/collections/jrc-gsw' },
  indiapost: { url: 'https://api.postalpincode.in/pincode/380001' },
  search: { url: 'https://photon.komoot.io/api/?q=Sanand&limit=1', name: 'Place search', provider: 'Photon (komoot) · OSM' },
  basemap: { url: 'https://tiles.openfreemap.org/planet', name: 'Vector basemap', provider: 'OpenFreeMap · OSM' },
};
export const health = {};
export async function probeAll() {
  if (S.offline) { Object.keys(PROBES).forEach((k) => (health[k] = { status: 'sim', ms: 0 })); bus.emit('health', health); return health; }
  await Promise.all(Object.entries(PROBES).map(async ([k, p]) => {
    // Sources with mirrors (Overpass) count as live if any mirror answers; the primary's failure is kept as a note.
    const urls = p.mirrors || [p.url]; let primaryFail = null;
    for (const url of urls) {
      const t0 = performance.now(); const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 9000);
      try {
        const r = await fetch(url, { ...(p.init || {}), signal: ctl.signal });
        health[k] = { status: r.ok ? 'ok' : 'error', code: r.status, ms: Math.round(performance.now() - t0) };
      } catch (e) { health[k] = { status: 'error', ms: Math.round(performance.now() - t0), error: e.name === 'AbortError' ? 'timeout' : 'blocked / CORS' }; }
      finally { clearTimeout(timer); }
      if (health[k].status === 'ok') { if (url !== urls[0]) { health[k].via = new URL(url).host; health[k].primary = primaryFail; } break; }
      if (!primaryFail) primaryFail = health[k].code ? 'HTTP ' + health[k].code : health[k].error;
    }
    if (health[k].status === 'error' && health[k].code >= 500) health[k].error = `${health[k].code}: upstream server busy or down`;
    bus.emit('health', health);
  }));
  return health;
}

export function renderFabric() {
  const el = $('#panelInner');
  const live = SOURCES.map((s) => ({ ...s, h: health[s.id] }));
  const extras = ['search', 'basemap'].map((k) => ({ id: k, name: PROBES[k].name, provider: PROBES[k].provider, feeds: 'Command Center', h: health[k] }));
  const okN = [...live, ...extras].filter((s) => s.h?.status === 'ok').length;
  el.innerHTML = `
  <div class="ph"><div><div class="kicker">DATA FABRIC</div><h2>${live.length + extras.length} public pipes, one feature vector</h2><p>Every assessment fuses satellites, terrain, hydrology, climate, maps and postal data, and records where each number came from.</p></div><button class="btn" id="reprobe">↻ Probe</button></div>
  <div class="sec fabric" id="fab"></div>
  <div class="sec"><h3>Live public sources <small>${S.offline ? 'simulated' : okN + ' reachable now'}</small></h3>${[...live, ...extras].map((s) => `<div class="conn"><b>${esc(s.name)}</b><span class="s ${s.h?.status === 'ok' ? 'st-ok' : s.h?.status === 'error' ? 'st-error' : 'st-skipped'}">${s.h ? (s.h.status === 'ok' ? `● ${s.h.ms} ms${s.h.via ? ` · mirror (main: ${esc(s.h.primary)})` : ''}` : s.h.status === 'sim' ? '◌ simulated' : `✕ ${esc(s.h.error || s.h.code)}`) : '…'}</span><small>${esc(s.provider)}${s.licence ? ' · ' + esc(s.licence) : ''} → ${esc(s.feeds)}</small></div>`).join('')}</div>
  <div class="sec"><h3>Enterprise & government connectors <small>switched on per lender</small></h3>${ENTERPRISE_CONNECTORS.map((c) => `<div class="conn"><b>${esc(c.name)}</b><span class="s lock">⚿ credentials</span><small>${esc(c.provider)} · adds ${esc(c.adds)} · ${esc(c.access)}</small></div>`).join('')}</div>
  <div class="sec"><h3>Benchmarks & policy</h3>${BENCHMARK_SOURCES.map((b) => `<div class="conn"><b>${esc(b.name)}</b><span class="s" style="color:#ffd98a">embedded</span><small>${esc(b.provider)} · ${esc(b.use)}</small></div>`).join('')}</div>
  <div class="sec"><h3>The compounding moat</h3><p class="hint" style="margin-top:0">Public data gets every competitor to the same starting line. The edge compounds from what lenders send back: realised auction prices, days to sale, Pulse alerts that preceded defaults. Each tenant's outcomes calibrate its own models; anonymised, consented aggregates build the recovery dataset nobody else has.</p></div>`;
  $('#reprobe').onclick = async () => { await probeAll(); renderFabric(); };
  drawFabric(live, extras);
}
function drawFabric(live, extras) {
  const box = $('#fab'); if (!box) return;
  const all = [...live, ...extras.slice(0, 1)];
  const W = box.clientWidth || 400, H = 250, n = all.length;
  const col = (h) => (!h ? '#71809f' : h.status === 'ok' ? '#3ee08f' : h.status === 'sim' ? '#ffb547' : '#ff5470');
  let s = `<defs><linearGradient id="fl" x1="0" x2="1"><stop offset="0" stop-color="#5ce1ff" stop-opacity=".1"/><stop offset="1" stop-color="#ffb547" stop-opacity=".8"/></linearGradient><style>.flow{stroke-dasharray:4 7;animation:dash 1.6s linear infinite}@keyframes dash{to{stroke-dashoffset:-22}}</style></defs>`;
  const hubX = W * 0.64, hubY = H / 2;
  all.forEach((x, i) => {
    const y = 12 + (i * (H - 24)) / (n - 1);
    s += `<path class="flow" d="M${W * 0.43},${y} C${W * 0.52},${y} ${W * 0.54},${hubY} ${hubX - 30},${hubY}" stroke="${col(x.h)}" stroke-opacity=".55" stroke-width="1.2" fill="none"/>`;
    s += `<circle cx="${W * 0.43}" cy="${y}" r="3.5" fill="${col(x.h)}"/><text x="${W * 0.43 - 8}" y="${y + 3.5}" fill="#a9b6d3" font-size="10" text-anchor="end">${esc(x.name.split(/[(+,·]/)[0].trim().slice(0, 24))}</text>`;
  });
  s += `<rect x="${hubX - 30}" y="${hubY - 30}" width="60" height="60" rx="14" fill="#0b1426" stroke="#ffb547"/><text x="${hubX}" y="${hubY - 4}" fill="#ffd98a" font-size="10" text-anchor="middle" font-family="JetBrains Mono">feature</text><text x="${hubX}" y="${hubY + 9}" fill="#ffd98a" font-size="10" text-anchor="middle" font-family="JetBrains Mono">vector</text>`;
  const outs = ['Value range', 'Liquidity', 'Hazards', 'LTV band', 'Red flags', 'Pulse'];
  outs.forEach((o, i) => { const y = 30 + (i * (H - 60)) / (outs.length - 1); s += `<path class="flow" d="M${hubX + 30},${hubY} C${W * 0.78},${hubY} ${W * 0.76},${y} ${W * 0.84},${y}" stroke="url(#fl)" stroke-width="1.4" fill="none"/><text x="${W * 0.85}" y="${y + 3.5}" fill="#e8eefb" font-size="10.5">${o}</text>`; });
  box.innerHTML = `<svg viewBox="0 0 ${W} ${H}">${s}</svg>`;
}
