// Assess mode: asset form, live pipeline, collateral report.
import { assess, SOURCES, ASSET_TYPES } from '../../engine/index.js';
import { renderReport } from '../../engine/report.js';
import { inr } from '../../engine/util.js';
import { S, bus, store } from './state.js';
import { engineEnv, log, consoleStat, TENANTS } from './engine-env.js';
import { map, setAsset, setParcel, showScene, setLayer, toast, setTool } from './map.js';
import { line, bars, radar, dial, animateDials } from './charts.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const ICON = {
  residential: '<path d="M4 11 12 4l8 7v9H4z"/><path d="M10 20v-5h4v5"/>',
  commercial: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M8 7h2M14 7h2M8 11h2M14 11h2M8 15h2M14 15h2"/>',
  industrial: '<path d="M3 20V10l5 3V10l5 3V6l8 4v10z"/><path d="M7 17h2M12 17h2M17 17h2"/>',
  agri_land: '<path d="M12 21V9"/><path d="M12 13c-4 0-6-3-6-6 4 0 6 3 6 6Z"/><path d="M12 10c4 0 6-3 6-6-4 0-6 3-6 6Z"/><path d="M3 21h18"/>',
  plot: '<path d="M4 18 8 6l10 2 2 10z" stroke-dasharray="3 2"/><circle cx="12" cy="12" r="1.5"/>',
};
const SHORT = { residential: 'Home', commercial: 'Shop/office', industrial: 'Factory', agri_land: 'Farm land', plot: 'Plot' };
export const DEMOS = [
  { name: 'Sanand GIDC factory', lat: 22.9883, lon: 72.2626, type: 'industrial', area_sqm: 8000, loan: 30000000 },
  { name: 'Kundal farm, Sanand', lat: 22.889, lon: 72.223, type: 'agri_land', area_sqm: 12000, loan: 700000 },
  { name: 'Hinjewadi apartment, Pune', lat: 18.5913, lon: 73.7389, type: 'residential', built: 1050, loan: 6500000, declared: 11500000 },
  { name: 'Whitefield office, Bengaluru', lat: 12.9698, lon: 77.7499, type: 'commercial', built: 2400, loan: 21000000 },
  { name: 'Riverside plot, Patna', lat: 25.6203, lon: 85.1764, type: 'plot', area_sqm: 220, loan: 1800000 },
];

let form = store.get('form', { built_up_sqft: 1100, area_sqm: 2000, loan_amount: 3500000, declared_value: '', reference_id: '' });
let running = false;

export function renderAssess() {
  const el = $('#panelInner');
  if (S.lastResult && !S.editing) return renderResult(S.lastResult);
  const a = S.asset, t = S.assetType;
  const land = ['agri_land', 'industrial', 'plot'].includes(t);
  el.innerHTML = `
  <div class="ph"><div><div class="kicker">COLLATERAL ASSESSMENT</div><h2>Value, grade and monitor one asset</h2><p>10 live public sources · one scored report · about 5 to 12 seconds.</p></div></div>
  <div class="sec"><h3>Asset location</h3>
    ${a ? `<div class="loc-card"><div class="ic"><svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 21s-7-6.2-7-11a7 7 0 1 1 14 0c0 4.8-7 11-7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg></div><div><b>${esc(a.label || (a.polygon ? 'Drawn parcel' : 'Pinned asset'))}</b><small>${a.lat.toFixed(5)}, ${a.lon.toFixed(5)}${a.area_sqm ? ` · ${a.area_sqm.toLocaleString('en-IN')} m² (${(a.area_sqm / 4046.86).toFixed(2)} ac)` : ''}</small></div></div>`
      : `<div class="loc-card"><div class="ic">?</div><div><b>No asset selected</b><small>Search above, then press Pin (P) or Parcel (B)</small></div></div>`}
    <div class="btns"><button class="btn" data-t="pick">⌖ Pin on map</button><button class="btn" data-t="draw">⬠ Draw parcel</button><button class="btn" data-t="sat">◐ Satellite</button></div>
  </div>
  <div class="sec"><h3>Asset type</h3><div class="seg">${Object.keys(ASSET_TYPES).map((k) => `<button data-type="${k}" class="${k === t ? 'on' : ''}"><svg viewBox="0 0 24 24">${ICON[k]}</svg>${SHORT[k]}</button>`).join('')}</div></div>
  <div class="sec"><h3>Loan details <small>optional · drive LTV and red flags</small></h3><div class="fields">
    ${land ? `<label class="field">Land area (m²)<input id="f_area" type="number" min="1" value="${a?.area_sqm || form.area_sqm || ''}"></label>` : `<label class="field">Built-up area (sq ft)<input id="f_built" type="number" min="1" value="${form.built_up_sqft || ''}"></label>`}
    <label class="field">Loan amount (₹)<input id="f_loan" type="number" min="0" step="50000" value="${form.loan_amount || ''}"></label>
    <label class="field">Declared value (₹)<input id="f_decl" type="number" min="0" step="50000" value="${form.declared_value || ''}" placeholder="from valuer / borrower"></label>
    <label class="field">Loan reference<input id="f_ref" value="${esc(form.reference_id || '')}" placeholder="LAP-2026-00418"></label>
  </div>
  <label class="field" style="margin-top:8px">Credit policy (tenant)<select id="f_tenant">${Object.entries(TENANTS).map(([k, v]) => `<option value="${k}" ${k === S.tenant ? 'selected' : ''}>${v.name}</option>`).join('')}</select></label></div>
  <button class="go" id="goBtn" ${a && !running ? '' : 'disabled'}>${running ? 'Running…' : a ? 'Run collateral assessment' : 'Select an asset to begin'}</button>
  <div class="sec"><h3>Or try a sample asset</h3><div class="btns">${DEMOS.map((d, i) => `<button class="btn" data-demo="${i}">${esc(d.name)}</button>`).join('')}</div></div>
  <p class="hint">Public data only; nothing about the borrower leaves your browser. Scores describe the land and its surroundings, never who lives there.</p>`;
  el.querySelectorAll('[data-type]').forEach((b) => b.onclick = () => { S.assetType = b.dataset.type; saveForm(); renderAssess(); });
  el.querySelectorAll('[data-t]').forEach((b) => b.onclick = () => { const t2 = b.dataset.t; if (t2 === 'sat') { const on = !S.layers.satellite; setLayer('satellite', on); document.querySelector('[data-layer=satellite]').checked = on; } else setTool(t2); });
  el.querySelectorAll('[data-demo]').forEach((b) => b.onclick = () => loadDemo(DEMOS[+b.dataset.demo], true));
  $('#f_tenant').onchange = (e) => { S.tenant = e.target.value; store.set('tenant', S.tenant); };
  el.querySelectorAll('input').forEach((i) => i.addEventListener('change', saveForm));
  $('#goBtn').onclick = run;
}

function saveForm() {
  const v = (id) => { const e = document.getElementById(id); return e ? (e.type === 'number' ? (e.value === '' ? '' : +e.value) : e.value) : undefined; };
  form = { ...form, built_up_sqft: v('f_built') ?? form.built_up_sqft, area_sqm: v('f_area') ?? form.area_sqm, loan_amount: v('f_loan') ?? form.loan_amount, declared_value: v('f_decl') ?? form.declared_value, reference_id: v('f_ref') ?? form.reference_id };
  if (S.asset && v('f_area') !== undefined && !S.asset.polygon) S.asset.area_sqm = +v('f_area') || null;
  store.set('form', form);
}

export function loadDemo(d, go) {
  S.lastResult = null; S.editing = true; S.assetType = d.type;
  form = { ...form, loan_amount: d.loan, built_up_sqft: d.built || form.built_up_sqft, area_sqm: d.area_sqm || form.area_sqm, declared_value: d.declared || '', reference_id: 'DEMO-' + d.name.split(' ')[0].toUpperCase() };
  setParcel(null);
  setAsset(d.lat, d.lon, { fly: true, label: d.name });
  if (d.area_sqm) S.asset.area_sqm = d.area_sqm;
  renderAssess();
  if (go) map.once('moveend', () => run());
}

export async function run() {
  if (!S.asset || running) return;
  saveForm(); running = true; S.editing = false;
  const a = S.asset, t = S.assetType;
  const input = { lat: a.lat, lon: a.lon, polygon: a.polygon || undefined, asset_type: t, reference_id: form.reference_id || undefined,
    area_sqm: ['agri_land', 'industrial', 'plot'].includes(t) ? (a.area_sqm || form.area_sqm || undefined) : (a.area_sqm || undefined),
    built_up_sqft: ['residential', 'commercial'].includes(t) ? form.built_up_sqft || undefined : undefined,
    loan_amount: form.loan_amount || undefined, declared_value: form.declared_value || undefined };
  const el = $('#panelInner');
  const srcs = SOURCES.filter((s) => s.modes.includes('full'));
  el.innerHTML = `<div class="ph"><div><div class="kicker">PIPELINE RUNNING</div><h2>Fusing ${srcs.length} live sources</h2><p>${esc(a.label || '')} ${a.lat.toFixed(4)}, ${a.lon.toFixed(4)} · ${esc(ASSET_TYPES[t].label)}</p></div><div class="radar-anim" style="width:64px;height:64px"></div></div>
  <div class="sec pipe" id="pipe">${srcs.map((s) => `<div class="pr" id="pr-${s.id}"><span class="spin"></span><div>${esc(s.name)}<small>${esc(s.provider)}</small></div><span class="st">queued</span></div>`).join('')}
  <div class="pr" id="pr-model"><span class="spin" style="opacity:.3"></span><div>Scoring models<small>value · liquidity · hazards · LTV · flags</small></div><span class="st">waiting</span></div></div>`;
  log(`<span class="hl">ASSESS</span> ${t} @ ${a.lat.toFixed(5)},${a.lon.toFixed(5)}${input.loan_amount ? ' · loan ' + inr(input.loan_amount) : ''} · tenant=${S.tenant}${S.offline ? ' · SIMULATED' : ''}`);
  consoleStat('running…');
  const onEvent = (e) => {
    const row = document.getElementById('pr-' + e.id);
    if (e.type === 'source:start') { if (row) row.querySelector('.st').textContent = 'fetching'; log(`→ ${e.provider} · ${e.name}`); }
    if (e.type === 'source:end') {
      if (row) { row.className = 'pr ' + e.status; row.querySelector('span').outerHTML = e.status === 'ok' ? '<span class="tick">✓</span>' : '<span class="cross">✕</span>'; row.querySelector('.st').textContent = e.status === 'ok' ? `${e.ms} ms · ${e.fields} fields` : 'unavailable'; }
      log(e.status === 'ok' ? `<span class="ok">✓ ${e.id}</span> ${e.ms} ms · ${e.fields} fields` : `<span class="err">✕ ${e.id}</span> ${esc(e.error)}`, '');
    }
  };
  try {
    const r = await assess(input, engineEnv({ onEvent }));
    const pm = document.getElementById('pr-model'); if (pm) { pm.className = 'pr ok'; pm.querySelector('.st').textContent = 'done'; }
    log(`<span class="hl">RESULT</span> grade ${r.score.grade} · CQS ${r.score.cqs} · P50 ${inr(r.valuation.p50)} · LTV ≤ ${Math.round(r.lending.recommended_ltv * 100)}% · ${r.flags.length} flags · ${r.timing_ms} ms`);
    consoleStat(`${r.provenance.live_sources_ok}/${r.provenance.live_sources_called} sources · ${r.timing_ms} ms`);
    r._simulated = S.offline;
    S.lastResult = r; store.set('lastResult', r);
    const hist = store.get('history', []); hist.unshift({ id: r.id, t: r.created_at, label: a.label, grade: r.score.grade, cqs: r.score.cqs, lat: a.lat, lon: a.lon }); store.set('history', hist.slice(0, 30));
    await new Promise((res) => setTimeout(res, 350));
    running = false; renderResult(r);
    if (r.signals?.imagery?.tilejson && !S.offline) showScene(r.signals.imagery.tilejson);
    bus.emit('assessed', r);
  } catch (e) {
    running = false; log(`<span class="err">FAILED</span> ${esc(e.message)}`); toast('Assessment failed: ' + e.message); S.editing = true; renderAssess();
  }
}

function imgTag(urls, alt) {
  if (!urls || S.offline) return `<div class="na">${S.offline ? 'Imagery not available offline' : 'No clear scene'}</div>`;
  const [first, ...rest] = urls;
  return `<img alt="${esc(alt)}" src="${esc(first)}" data-alt='${esc(JSON.stringify(rest))}' onerror="const a=JSON.parse(this.dataset.alt||'[]');if(a.length){this.dataset.alt=JSON.stringify(a.slice(1));this.src=a[0]}else{this.replaceWith(Object.assign(document.createElement('div'),{className:'na',textContent:'Scene preview unavailable'}))}">`;
}

function circleSec(c, v) {
  if (!c || !c.circle_value) return '';
  const max = Math.max(c.circle_value, v.p90, v.declared_value || 0) * 1.08;
  const bar = (label, val, cls) => `<div class="b"><span>${label}</span><div class="t"><i class="${cls}" style="width:${Math.round((val / max) * 100)}%"></i></div><span class="n">${inr(val)}</span></div>`;
  const g = c.growth;
  return `<div class="sec"><h3>Government floor value <small><span class="tier ${c.tier}">${esc(c.tier_label)}</span> ${esc(c.regime)}</small></h3>
    <div class="bars circ">${bar('Circle', c.circle_value, 'cf')}${bar('Market P50', v.p50, 'mk')}${v.declared_value ? bar('Declared', v.declared_value, c.declared_below_circle ? 'bad' : 'dc') : ''}</div>
    <div class="kpis" style="margin-top:8px"><div class="kpi"><span>Rate</span><b>₹${(c.rate_sqm || 0).toLocaleString('en-IN')}/m²</b></div><div class="kpi"><span>Market ÷ floor</span><b class="${c.circle_above_market ? '' : 'cyan'}" style="${c.circle_above_market ? 'color:#ff8fa1' : ''}">${c.market_to_circle}×</b></div><div class="kpi"><span>Floor growth</span><b>${g ? (g.signal === 'stale' ? 'stale' : (g.cagr_2y * 100).toFixed(1) + '%/yr') : '—'}</b></div></div>
    <p class="hint">${esc(c.locality || '')} · ${esc(c.fy || '')} · ${esc(c.method)}. ${g?.reading ? esc(g.reading) + '. ' : ''}${c.ratio_rationale ? 'Ratio basis: ' + esc(c.ratio_rationale) + '. ' : ''}${(c.notes || []).map(esc).join(' · ')}${c.source?.url ? ` · <a href="${esc(c.source.url)}" target="_blank" rel="noopener">${esc(c.source.label)}</a>` : ''}</p></div>`;
}

export function renderResult(r) {
  const el = $('#panelInner'); const s = r.signals || {}; const v = r.valuation; const L = r.lending;
  const span = v.p90 * 1.12 - v.p10 * 0.85, pos = (x) => Math.max(0, Math.min(100, ((x - v.p10 * 0.85) / span) * 100));
  const decl = v.declared_value ? pos(v.declared_value) : null;
  const sev = { high: 0, medium: 1, low: 2 };
  const flags = [...r.flags].sort((a, b) => sev[a.severity] - sev[b.severity]);
  const hz = r.hazards; const hzBar = (k, val, col) => `<div class="b"><span>${k}</span><div class="t"><i style="width:${val ?? 0}%;background:${col}"></i></div><span class="n">${val ?? '–'}</span></div>`;
  const lulc = (s.lulc_by_year || []).map((y) => `<span class="${y.cls === 7 ? 'hl' : ''}">${y.year} ${esc(y.label)}</span>`).join('');
  el.innerHTML = `
  ${r._simulated ? '<div class="flag medium"><b>SIMULATED</b>Offline demo mode: these numbers come from stand-in upstreams.</div>' : ''}
  <div class="ph"><div><div class="kicker">COLLATERAL REPORT · ${esc(r.id)}</div><h2>${esc(r.asset_label)}</h2><p>${esc([r.location.locality, r.location.district, r.location.state].filter(Boolean).join(', ') || `${r.input.lat.toFixed(4)}, ${r.input.lon.toFixed(4)}`)}</p></div><button class="btn" id="newBtn">New</button></div>
  <div class="hero">${dial(r.score.cqs, r.score.grade)}<div><div class="route ${r.decision.route}">${esc(r.decision.label)}</div><div class="kpis" style="margin-top:8px;grid-template-columns:1fr 1fr"><div class="kpi"><span>Recommended LTV</span><b class="amber">${Math.round(L.recommended_ltv * 100)}%</b></div><div class="kpi"><span>Max loan</span><b>${inr(L.max_loan)}</b></div></div></div></div>
  <div class="sec"><h3>Market value · 80% range <small>${esc(v.rate_unit)}: ₹${v.rate.toLocaleString('en-IN')}</small></h3>
    <div class="band"><div class="track"></div><div class="rng" style="left:${pos(v.p10)}%;width:${pos(v.p90) - pos(v.p10)}%"></div><div class="p50" style="left:${pos(v.p50)}%"></div>
    <span class="lab" style="left:${pos(v.p10)}%">${inr(v.p10)}</span><span class="lab" style="left:${pos(v.p50)}%;color:#ffd98a">${inr(v.p50)}</span><span class="lab" style="left:${pos(v.p90)}%">${inr(v.p90)}</span>
    ${decl != null ? `<div class="dec" style="left:${decl}%"></div><span class="declab" style="left:${decl}%">declared ${inr(v.declared_value)}</span>` : ''}</div>
    <p class="hint" style="margin-top:14px">${esc(v.basis)}.</p></div>
  <div class="sec"><div class="kpis">
    <div class="kpi"><span>Realisable (forced)</span><b class="amber">${inr(r.liquidity.realisable_value)}</b></div>
    <div class="kpi"><span>Days to sell</span><b>${r.liquidity.days_to_sell}</b></div>
    <div class="kpi"><span>Haircut</span><b>${Math.round(r.liquidity.forced_sale_haircut * 100)}%</b></div>
    <div class="kpi"><span>12-m PD</span><b>${(L.pd_12m * 100).toFixed(1)}%</b></div>
    <div class="kpi"><span>${L.actual_ltv != null ? 'Requested LTV' : 'EL-max LTV'}</span><b class="${L.actual_ltv > L.recommended_ltv ? '' : 'cyan'}" style="${L.actual_ltv > L.recommended_ltv ? 'color:#ff8fa1' : ''}">${Math.round((L.actual_ltv ?? L.el_constrained_ltv) * 100)}%</b></div>
    <div class="kpi"><span>Expected loss</span><b>${L.expected_loss != null ? inr(L.expected_loss) : '—'}</b></div></div></div>
  ${circleSec(r.circle_rate, v)}
  <div class="sec"><h3>Red flags <small>${flags.length}</small></h3><div class="flags">${flags.length ? flags.map((f) => `<div class="flag ${f.severity}"><b>${esc(f.code.replace(/_/g, ' '))}</b>${esc(f.text)}</div>`).join('') : '<div class="flag low"><b>CLEAR</b>No red flags raised.</div>'}</div></div>
  <div class="sec"><h3>Score anatomy</h3><div class="fig" id="radarFig" style="height:210px"></div></div>
  <div class="sec"><h3>Hazards <small>0 = none · 100 = severe</small></h3><div class="bars">${hzBar('Flood', hz.flood, 'linear-gradient(90deg,#5ce1ff,#4c8dff)')}${hzBar('Heat', hz.heat, 'linear-gradient(90deg,#ffb547,#ff5470)')}${hzBar('Drought', hz.drought, 'linear-gradient(90deg,#ffd166,#ff9a3d)')}</div>
    <p class="hint">River: ${esc(s.river_size || '—')} (median annual peak ${s.annual_peak_median_m3s ?? '—'} m³/s · 30-day forecast <b>${esc(s.forecast_alert || '—')}</b>) · elevation ${s.elevation_m ?? '—'} m, ${s.rel_elev_1500m ?? '—'} m vs surroundings · surface water within 250 m: ${s.water_occurrence_250m_max ?? '—'}%</p></div>
  <div class="sec"><h3>Satellite evidence <small>${s.clearest_scene ? 'Sentinel-2 · ' + esc(s.clearest_scene.date) + ' · ' + s.clearest_scene.cloud + '% cloud' : ''}</small></h3>
    <div class="imgs"><figure>${imgTag(s.imagery?.rgb, 'Sentinel-2 true colour')}<figcaption>True colour</figcaption></figure><figure>${imgTag(s.imagery?.ndvi, 'NDVI')}<figcaption>NDVI</figcaption></figure></div>
    <h3 style="margin-top:12px">NDVI · last 13 months <small>${s.ndvi_valid_obs ?? 0} clear passes · hollow = cloud</small></h3><div class="fig" id="ndviFig"></div></div>
  <div class="sec"><h3>River discharge · monthly peaks <small>GloFAS m³/s</small></h3><div class="fig" id="riverFig"></div></div>
  <div class="sec"><h3>Rainfall by year <small>${s.annual_rain_mm ?? '—'} mm avg · ${s.heat_days_40_yr ?? '—'} days ≥ 40 °C/yr</small></h3><div class="fig" id="rainFig" style="height:80px"></div></div>
  <div class="sec"><h3>Location & activity</h3><div class="kpis">
    <div class="kpi"><span>Night-light index</span><b class="amber">${s.light_index_local ?? '—'}</b></div>
    <div class="kpi"><span>Light growth 12→16</span><b>${s.light_growth_2012_2016 != null ? (s.light_growth_2012_2016 > 0 ? '+' : '') + Math.round(s.light_growth_2012_2016 * 100) + '%' : '—'}</b></div>
    <div class="kpi"><span>Buildings ≤1.5 km</span><b>${s.buildings_1500m?.toLocaleString('en-IN') ?? '—'}</b></div>
    <div class="kpi"><span>Arterial road</span><b>${s.nearest_major_road_m != null ? (s.nearest_major_road_m / 1000).toFixed(1) + ' km' : '—'}</b></div>
    <div class="kpi"><span>Rail station</span><b>${s.nearest_rail_station_m != null ? (s.nearest_rail_station_m / 1000).toFixed(1) + ' km' : '—'}</b></div>
    <div class="kpi"><span>Amenities ≤1.5 km</span><b>${s.amenities_1500m ?? '—'}</b></div></div>
    <h3 style="margin-top:12px">Land use <small>declared-use consistency ${r.land_use.consistency ?? '—'}/100</small></h3><div class="chips">${lulc || '<span>—</span>'}${s.worldcover_label ? `<span>WorldCover ${esc(s.worldcover_year)}: ${esc(s.worldcover_label)}</span>` : ''}${s.landuse_at_point ? `<span>OSM: ${esc(s.landuse_at_point)}</span>` : ''}</div></div>
  <div class="sec"><h3>Summary for the credit file</h3><div class="summary">${esc(r.summary)}</div></div>
  <div class="sec"><h3>Data lineage <small>${r.provenance.live_sources_ok}/${r.provenance.live_sources_called} live · ${r.timing_ms} ms · model ${esc(r.model_version)}</small></h3>
    <table class="t">${r.sources.map((x) => `<tr><td>${esc(x.name)}<br><small style="color:#71809f">${esc(x.provider)} · ${esc(x.licence)}</small></td><td class="st-${x.status}">${x.status === 'ok' ? 'live' : esc(x.status)}</td><td class="n">${x.ms ?? ''}</td></tr>`).join('')}</table></div>
  <div class="btns"><button class="btn pri" id="repBtn">⎙ Report</button><button class="btn" id="jsonBtn">{ } JSON</button><button class="btn" id="apiBtn">⌘ API call</button><button class="btn" id="editBtn">✎ Edit inputs</button></div>
  <p class="hint">${esc(r.disclaimer)}</p>`;
  animateDials(el);
  const sub = r.score.sub;
  radar($('#radarFig'), [['Location', sub.location], ['Access', sub.access], ['Hazard', sub.hazard], ['Activity', sub.activity], ['Use match', sub.consistency], ['Data', sub.confidence]]);
  line($('#ndviFig'), (s.ndvi_series || []).map((p) => [p.date, p.ndvi, p.valid]), { color: '#3ee08f', yMin: -0.1, yMax: 0.9, hollow: (p) => !p[2] });
  line($('#riverFig'), (s.series || []).slice(-60).map(([k, val]) => [k, val]), { color: '#5ce1ff', ref: s.annual_peak_median_m3s, unit: '' });
  bars($('#rainFig'), (s.annual_series || []).map(([y, mm]) => [y, mm]), { unit: ' mm' });
  $('#newBtn').onclick = () => { S.lastResult = null; S.editing = true; renderAssess(); };
  $('#editBtn').onclick = () => { S.editing = true; S.lastResult = null; renderAssess(); };
  $('#repBtn').onclick = () => { const w = window.open('', '_blank'); if (w) { w.document.write(renderReport(r, { simulated: r._simulated })); w.document.close(); } else toast('Allow pop-ups to open the report'); };
  $('#jsonBtn').onclick = () => { const b = new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }); const u = URL.createObjectURL(b); const aEl = Object.assign(document.createElement('a'), { href: u, download: `${r.id}.json` }); aEl.click(); setTimeout(() => URL.revokeObjectURL(u), 2000); };
  $('#apiBtn').onclick = () => bus.emit('mode', 'api');
}
