// Printable collateral report (HTML). Shared by the API (/v1/assessments/{id}/report) and the Command Center export.
import { inr } from './util.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = (x) => (x == null ? '—' : Math.round(x * 100) + '%');

export function renderReport(r, { brand = 'BhoomiPulse', simulated = false } = {}) {
  const s = r.signals || {};
  const sub = r.score.sub;
  const bars = Object.entries(sub).map(([k, v]) => `<tr><td>${esc(k[0].toUpperCase() + k.slice(1))}</td><td><div class="bar"><i style="width:${v ?? 0}%"></i></div></td><td class="n">${v ?? '—'}</td></tr>`).join('');
  const flags = r.flags.length ? r.flags.map((f) => `<li class="${f.severity}"><b>${esc(f.code.replace(/_/g, ' '))}</b> ${esc(f.text)}</li>`).join('') : '<li class="low">No red flags raised.</li>';
  const src = r.sources.map((x) => `<tr><td>${esc(x.name)}</td><td>${esc(x.provider)}</td><td class="${x.status}">${x.status === 'ok' ? 'live' : esc(x.status)}</td><td class="n">${x.ms ?? ''}</td></tr>`).join('');
  const ndvi = (s.ndvi_series || []).map((p) => `${p.date}: ${p.ndvi}${p.valid ? '' : ' (cloud)'}`).join(' · ');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Collateral report ${esc(r.id)}</title>
<style>
body{font:14px/1.5 Inter,system-ui,sans-serif;color:#111;margin:0;background:#f4f5f7}
.page{max-width:860px;margin:24px auto;background:#fff;padding:36px 44px;border-radius:6px;box-shadow:0 1px 3px #0002}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:26px 0 8px;border-bottom:1px solid #ddd;padding-bottom:4px}
.meta{color:#555;font-size:12.5px}.grade{float:right;text-align:center;border:2px solid #111;border-radius:8px;padding:6px 14px}
.grade b{display:block;font-size:34px;line-height:1}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}
.k{border:1px solid #e3e3e3;border-radius:6px;padding:10px}.k span{display:block;color:#666;font-size:12px}.k b{font-size:17px}
table{border-collapse:collapse;width:100%}td,th{padding:5px 6px;border-bottom:1px solid #eee;text-align:left;font-size:13px}.n{text-align:right;font-variant-numeric:tabular-nums}
.bar{background:#eee;height:8px;border-radius:4px;width:100%}.bar i{display:block;height:8px;border-radius:4px;background:#1b6ef3}
ul.flags{padding:0;list-style:none}ul.flags li{padding:6px 10px;border-left:4px solid #999;margin:4px 0;background:#fafafa}
li.high{border-color:#d92d20!important}li.medium{border-color:#f79009!important}li.low{border-color:#12b76a!important}
td.ok{color:#067647}td.error{color:#b42318}.sim{background:#fff4d6;border:1px solid #c98500;padding:6px 10px;border-radius:6px;margin-bottom:12px}
.foot{color:#666;font-size:11.5px;margin-top:22px}@media print{body{background:#fff}.page{box-shadow:none;margin:0}}
</style></head><body><div class="page">
${simulated ? '<div class="sim"><b>SIMULATED DATA.</b> Produced in offline demo mode; no live source was called.</div>' : ''}
<div class="grade"><b>${esc(r.score.grade)}</b>${r.score.cqs}/100</div>
<h1>${esc(brand)} collateral report</h1>
<div class="meta">${esc(r.asset_label)} · ${esc([r.location.locality, r.location.district, r.location.state].filter(Boolean).join(', '))} · ${r.input.lat.toFixed(5)}, ${r.input.lon.toFixed(5)}<br>
Report ${esc(r.id)} · ${esc(r.created_at.slice(0, 16).replace('T', ' '))} UTC · engine ${esc(r.engine_version)} · model ${esc(r.model_version)}${r.reference_id ? ' · ref ' + esc(r.reference_id) : ''}</div>
<h2>Summary</h2><p>${esc(r.summary)}</p>
<h2>Value and recovery</h2><div class="grid">
<div class="k"><span>Market value (P50)</span><b>${inr(r.valuation.p50)}</b></div>
<div class="k"><span>80% range</span><b>${inr(r.valuation.p10)} – ${inr(r.valuation.p90)}</b></div>
<div class="k"><span>Rate</span><b>₹${r.valuation.rate.toLocaleString('en-IN')}</b> ${esc(r.valuation.rate_unit)}</div>
<div class="k"><span>Days to sell (forced)</span><b>${r.liquidity.days_to_sell}</b></div>
<div class="k"><span>Forced-sale haircut</span><b>${pct(r.liquidity.forced_sale_haircut)}</b></div>
<div class="k"><span>Realisable value</span><b>${inr(r.liquidity.realisable_value)}</b></div>
<div class="k"><span>Recommended LTV</span><b>${pct(r.lending.recommended_ltv)}</b></div>
<div class="k"><span>Max loan</span><b>${inr(r.lending.max_loan)}</b></div>
<div class="k"><span>12-month PD (policy × score)</span><b>${pct(r.lending.pd_12m)}</b></div></div>
<p class="meta">Valuation basis: ${esc(r.valuation.basis)}. ${r.lending.actual_ltv != null ? `Requested loan ${inr(r.lending.loan_amount)} = LTV ${pct(r.lending.actual_ltv)} (stress at P10: ${pct(r.lending.stress_ltv_p10)}); expected loss ${inr(r.lending.expected_loss)}.` : ''}</p>
<h2>Decision route</h2><p><b>${esc(r.decision.label)}</b></p>
<h2>Red flags</h2><ul class="flags">${flags}</ul>
<h2>Score breakdown</h2><table>${bars}</table>
<h2>Evidence</h2><table>
<tr><td>Observed land use</td><td>${esc(r.land_use.observed || '—')}</td></tr>
<tr><td>Night-light index (local / 2012→2016)</td><td>${s.light_index_local ?? '—'} / ${s.light_growth_2012_2016 != null ? (s.light_growth_2012_2016 > 0 ? '+' : '') + Math.round(s.light_growth_2012_2016 * 100) + '%' : '—'}</td></tr>
<tr><td>Nearest arterial road</td><td>${s.nearest_major_road_m != null ? (s.nearest_major_road_m / 1000).toFixed(2) + ' km (' + esc(s.nearest_major_road_class) + ')' : '—'}</td></tr>
<tr><td>Buildings within 500 m / 1.5 km</td><td>${s.buildings_500m ?? '—'} / ${s.buildings_1500m ?? '—'}</td></tr>
<tr><td>Elevation vs surroundings (1.5 km)</td><td>${s.elevation_m ?? '—'} m (${s.rel_elev_1500m ?? '—'} m)</td></tr>
<tr><td>River (GloFAS)</td><td>${esc(s.river_size || '—')}; median annual peak ${s.annual_peak_median_m3s ?? '—'} m³/s; 30-day forecast ${esc(s.forecast_alert || '—')}</td></tr>
<tr><td>Surface water within 250 m</td><td>${s.water_occurrence_250m_max ?? '—'}% of observations</td></tr>
<tr><td>Rain / heat (since 2016)</td><td>${s.annual_rain_mm ?? '—'} mm/yr, ${s.very_heavy_rain_days_yr ?? '—'} very heavy days/yr, ${s.heat_days_40_yr ?? '—'} days ≥40 °C</td></tr>
<tr><td>Sentinel-2 NDVI</td><td>${esc(ndvi || '—')}</td></tr>
</table>
<h2>Data sources</h2><table><tr><th>Source</th><th>Provider</th><th>Status</th><th class="n">ms</th></tr>${src}</table>
<p class="foot">${esc(r.disclaimer)} Hazard and activity scores describe the land and its surroundings, never the people who live there; no demographic variable is used.</p>
</div></body></html>`;
}
