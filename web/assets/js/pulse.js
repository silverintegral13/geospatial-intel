// Pulse: monthly re-check of financed assets (night lights, Sentinel-2 NDVI, river forecast) with alerts.
import { pulseSnapshot } from '../../engine/index.js';
import { pool } from '../../engine/util.js';
import { S, bus, store } from './state.js';
import { engineEnv, log, consoleStat } from './engine-env.js';
import { setWatch, map, toast } from './map.js';
import { line } from './charts.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SEED = [
  { id: 'w1', label: 'Factory · Sanand GIDC', asset: { lat: 22.9883, lon: 72.2626, asset_type: 'industrial' } },
  { id: 'w2', label: 'Farm · Kundal, Sanand', asset: { lat: 22.889, lon: 72.223, asset_type: 'agri_land' } },
  { id: 'w3', label: 'Farm · Nashik vineyards', asset: { lat: 20.0657, lon: 73.8301, asset_type: 'agri_land' } },
  { id: 'w4', label: 'Warehouse · Bhiwandi', asset: { lat: 19.2813, lon: 73.0483, asset_type: 'industrial' } },
];
let busy = false;
export function initPulse() { S.watch = store.get('watch', SEED); setWatch(S.watch); }
const save = () => { store.set('watch', S.watch); setWatch(S.watch); };

bus.on('watch:add', ({ asset, label, from }) => {
  const id = 'w' + Date.now().toString(36);
  const w = { id, label, asset };
  if (from) { w.last = { taken_at: from.created_at, activity_index: null, light_index_local: from.signals.light_index_local, ndvi_latest: from.signals.ndvi_latest, flood_alert: from.signals.forecast_alert, alerts: [] }; }
  S.watch.unshift(w); save(); toast('Added to Pulse watchlist'); bus.emit('mode', 'pulse');
});
bus.on('watch:click', (i) => { const w = S.watch[i]; if (w) { map.flyTo({ center: [w.asset.lon, w.asset.lat], zoom: 15, pitch: 45 }); if (S.mode !== 'pulse') bus.emit('mode', 'pulse'); } });

async function recheck(list) {
  if (busy) return; busy = true; render();
  log(`<span class="hl">PULSE</span> re-checking ${list.length} assets${S.offline ? ' · SIMULATED' : ''}`); consoleStat('pulse running…');
  await pool(list, 3, async (w) => {
    try {
      const snap = await pulseSnapshot({ ...w.asset, asset_id: w.id }, engineEnv(), w.last && w.last.activity_index != null ? w.last : null);
      w.history = [...(w.history || []), { t: snap.taken_at, a: snap.activity_index, ndvi: snap.ndvi_latest, light: snap.light_index_local }].slice(-24);
      w.last = snap; w.series = snap; // eslint-disable-line
      log(`  ${esc(w.label)} → activity ${snap.activity_index ?? '—'} · NDVI ${snap.ndvi_latest ?? '—'} · flood ${snap.flood_alert ?? '—'} ${snap.alerts.map((a) => `<span class="err">${a.code}</span>`).join(' ')}`);
    } catch (e) { log(`  <span class="err">${esc(w.label)}: ${esc(e.message)}</span>`); }
    save(); if (S.mode === 'pulse') render();
  });
  busy = false; consoleStat('pulse done'); render();
}

export function render() {
  const el = $('#panelInner'); if (S.mode !== 'pulse') return;
  const alerts = S.watch.flatMap((w) => (w.last?.alerts || []).map((a) => ({ ...a, w })));
  el.innerHTML = `
  <div class="ph"><div><div class="kicker">PULSE · POST-DISBURSAL MONITORING <span class="soon">IN BUILD · EARLY PROTOTYPE</span></div><h2>Is the asset behind each loan still alive?</h2><p>Factory lights, crop vigour and river forecasts re-checked from orbit, with alerts before EMIs bounce.</p><p class="hint">Early prototype of an in-build feature, planned for H2 2028. It launches only if back-tests on 3 customer books show alerts 60+ days before 30+ DPD and 3 NBFCs commit to pay. See In build for details.</p></div></div>
  <div class="btns"><button class="btn pri" id="recheckAll" ${busy ? 'disabled' : ''}>${busy ? 'Re-checking…' : `↻ Re-check all ${S.watch.length} now`}</button><button class="btn" id="resetW">Reset demo list</button></div>
  <div class="sec"><h3>Alerts <small>${alerts.length}</small></h3>${alerts.length ? alerts.map((a) => `<div class="alert ${a.severity}"><b>${esc(a.w.label)}</b> · ${esc(a.text)}</div>`).join('') : '<p class="hint">No alerts. Re-check to pull the latest scenes and forecasts.</p>'}</div>
  <div class="sec"><h3>Watchlist</h3>${S.watch.map((w, i) => `<div class="wl" data-i="${i}"><div class="wl-h"><div><b>${esc(w.label)}</b><small>${esc(w.asset.asset_type.replace('_', ' '))} · ${w.asset.lat.toFixed(4)}, ${w.asset.lon.toFixed(4)}${w.last ? ' · checked ' + esc(String(w.last.taken_at).slice(0, 10)) : ' · never checked'}</small></div><div style="text-align:right"><b style="font:600 20px 'Space Grotesk';color:#ffd98a">${w.last?.activity_index ?? '—'}</b><small style="display:block;color:#71809f;font-size:10px">activity</small></div></div>
    ${w.last ? `<div class="chips" style="margin-top:6px"><span>lights ${w.last.light_index_local ?? '—'}</span><span>NDVI ${w.last.ndvi_latest ?? '—'}${w.last.ndvi_latest_date ? ' @' + esc(w.last.ndvi_latest_date) : ''}</span><span class="${w.last.flood_alert && w.last.flood_alert !== 'normal' ? 'hl' : ''}">river ${esc(w.last.flood_alert || '—')}</span>${w.last.ndvi_anomaly != null ? `<span>ΔNDVI ${w.last.ndvi_anomaly > 0 ? '+' : ''}${w.last.ndvi_anomaly}</span>` : ''}</div>` : ''}
    ${(w.history || []).length > 1 ? `<div class="fig" style="height:54px;margin-top:6px" id="wh${i}"></div>` : ''}
    <div class="btns" style="margin-top:6px"><button class="btn" data-one="${i}">↻ Re-check</button><button class="btn" data-fly="${i}">⌖ Fly</button><button class="btn" data-del="${i}">✕</button></div></div>`).join('')}</div>
  <div class="sec"><h3>Alert rules</h3><table class="t"><tr><td>Activity drop</td><td class="n">≥ 15 points vs last check</td></tr><tr><td>Crop stress</td><td class="n">NDVI ≥ 0.15 below 12-month mean</td></tr><tr><td>Flood watch / alert</td><td class="n">forecast ≥ median / 90th pct annual peak</td></tr></table>
  <p class="hint">In production the API runs this monthly on a schedule and posts signed <code>pulse.alert</code> webhooks to the lender's collections queue, so field teams visit the right accounts first.</p></div>`;
  $('#recheckAll').onclick = () => recheck(S.watch);
  $('#resetW').onclick = () => { S.watch = structuredClone(SEED); save(); render(); };
  el.querySelectorAll('[data-one]').forEach((b) => b.onclick = () => recheck([S.watch[+b.dataset.one]]));
  el.querySelectorAll('[data-fly]').forEach((b) => b.onclick = () => { const w = S.watch[+b.dataset.fly]; map.flyTo({ center: [w.asset.lon, w.asset.lat], zoom: 15.5, pitch: 50 }); });
  el.querySelectorAll('[data-del]').forEach((b) => b.onclick = () => { S.watch.splice(+b.dataset.del, 1); save(); render(); });
  S.watch.forEach((w, i) => { const f = document.getElementById('wh' + i); if (f) line(f, w.history.map((h) => [h.t.slice(5, 10), h.a ?? 0]), { color: '#ffb547', yMin: 0, yMax: 100, labels: false }); });
}
