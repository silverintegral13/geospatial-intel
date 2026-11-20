// Open-Meteo: Copernicus DEM elevation, GloFAS river discharge (flood), ERA5 climate history.
import { getJSON, offset, mean, std, quantile, round, isoDate, daysAgo } from '../util.js';

export const OM = {
  elevation: 'https://api.open-meteo.com/v1/elevation',
  flood: 'https://flood-api.open-meteo.com/v1/flood',
  archive: 'https://archive-api.open-meteo.com/v1/archive',
};

// Terrain: elevation at the asset and on two rings (300 m and 1.5 km). Negative relative
// elevation means the asset sits lower than its surroundings, which concentrates run-off.
export async function terrain(ctx) {
  const { lat, lon } = ctx;
  const pts = [[lat, lon]];
  for (const r of [300, 1500]) for (let k = 0; k < 8; k++) {
    const a = (k / 8) * 2 * Math.PI;
    pts.push(offset(lat, lon, r * Math.cos(a), r * Math.sin(a)));
  }
  const url = `${OM.elevation}?latitude=${pts.map((p) => p[0].toFixed(5)).join(',')}&longitude=${pts.map((p) => p[1].toFixed(5)).join(',')}`;
  const j = await getJSON(ctx.fetch, url, { timeout: 10000 });
  const e = j.elevation || [];
  const z0 = e[0], ring300 = e.slice(1, 9), ring1500 = e.slice(9, 17);
  const slope = Math.max(...ring300.map((z) => Math.abs(z - z0))) / 300 * 100; // % grade, steepest direction
  return {
    elevation_m: round(z0, 1),
    rel_elev_300m: round(z0 - mean(ring300), 2),
    rel_elev_1500m: round(z0 - mean(ring1500), 2),
    relief_1500m: round(Math.max(...ring1500) - Math.min(...ring1500), 1),
    slope_pct: round(slope, 2),
  };
}

// Elevation for many points in one call (portfolio fast mode), max 100 per request.
export async function elevationBatch(fetchFn, coords) {
  const out = [];
  for (let i = 0; i < coords.length; i += 100) {
    const c = coords.slice(i, i + 100);
    const url = `${OM.elevation}?latitude=${c.map((p) => p[0].toFixed(5)).join(',')}&longitude=${c.map((p) => p[1].toFixed(5)).join(',')}`;
    const j = await getJSON(fetchFn, url, { timeout: 15000 });
    out.push(...(j.elevation || []));
  }
  return out;
}

export async function flood(ctx) {
  const { lat, lon } = ctx;
  const end = isoDate(daysAgo(2));
  const hist = await getJSON(ctx.fetch, `${OM.flood}?latitude=${lat}&longitude=${lon}&daily=river_discharge&start_date=2003-01-01&end_date=${end}`, { timeout: 20000 });
  let fc = null;
  try { fc = await getJSON(ctx.fetch, `${OM.flood}?latitude=${lat}&longitude=${lon}&daily=river_discharge&forecast_days=30`, { timeout: 15000 }); } catch { /* forecast optional */ }
  return parseFlood(hist, fc);
}

export function parseFlood(hist, fc) {
  const t = hist?.daily?.time || [], q = hist?.daily?.river_discharge || [];
  const byYear = {};
  t.forEach((d, i) => { const y = d.slice(0, 4); if (q[i] != null) byYear[y] = Math.max(byYear[y] ?? -1, q[i]); });
  const annualMax = Object.entries(byYear).filter(([y]) => +y < new Date().getUTCFullYear()).map(([, v]) => v);
  const qMean = mean(q);
  const q2 = quantile(annualMax, 0.5), q10 = quantile(annualMax, 0.9);
  const fq = fc?.daily?.river_discharge?.filter((x) => x != null) || [];
  const fMax = fq.length ? Math.max(...fq) : null;
  const last30 = q.slice(-30).filter((x) => x != null);
  const recentMax = last30.length ? Math.max(...last30) : null;
  const size = qMean == null ? 'none' : qMean < 1 ? 'none' : qMean < 30 ? 'small' : qMean < 300 ? 'medium' : 'large';
  const level = (v) => (v == null || q2 == null ? null : v >= q10 ? 'severe' : v >= q2 ? 'elevated' : 'normal');
  return {
    river_size: size,
    discharge_mean_m3s: round(qMean, 1),
    annual_peak_median_m3s: round(q2, 1),
    annual_peak_p90_m3s: round(q10, 1),
    peak_to_mean_ratio: qMean ? round(q2 / qMean, 1) : null,
    years_of_record: annualMax.length,
    forecast_30d_max_m3s: round(fMax, 1),
    forecast_alert: level(fMax),
    recent_30d_max_m3s: round(recentMax, 1),
    recent_alert: level(recentMax),
    series: compressSeries(t, q),
  };
}

// Monthly maxima for the sparkline (keeps payloads small).
function compressSeries(t, q) {
  const m = {};
  t.forEach((d, i) => { const k = d.slice(0, 7); if (q[i] != null) m[k] = Math.max(m[k] ?? 0, q[i]); });
  return Object.entries(m).slice(-120).map(([k, v]) => [k, round(v, 1)]);
}

export async function climate(ctx) {
  const { lat, lon } = ctx;
  const end = isoDate(daysAgo(8));
  const url = `${OM.archive}?latitude=${lat}&longitude=${lon}&start_date=2016-01-01&end_date=${end}&daily=precipitation_sum,temperature_2m_max&timezone=Asia%2FKolkata`;
  const j = await getJSON(ctx.fetch, url, { timeout: 25000 });
  return parseClimate(j);
}

export function parseClimate(j) {
  const t = j?.daily?.time || [], p = j?.daily?.precipitation_sum || [], tx = j?.daily?.temperature_2m_max || [];
  const yrs = {};
  t.forEach((d, i) => {
    const y = d.slice(0, 4), mo = +d.slice(5, 7);
    const Y = (yrs[y] ||= { rain: 0, heavy: 0, vheavy: 0, heat40: 0, heat45: 0, days: 0, dry: 0, maxDry: 0, monsoon: 0 });
    Y.days++;
    const r = p[i] ?? 0, T = tx[i];
    Y.rain += r;
    if (r >= 64.5) Y.heavy++;
    if (r >= 115.6) Y.vheavy++;
    if (T >= 40) Y.heat40++;
    if (T >= 45) Y.heat45++;
    if (mo >= 6 && mo <= 9) { Y.monsoon += r; if (r < 2.5) { Y.dry++; Y.maxDry = Math.max(Y.maxDry, Y.dry); } else Y.dry = 0; }
  });
  const full = Object.entries(yrs).filter(([, v]) => v.days >= 360);
  const pick = (k) => full.map(([, v]) => v[k]);
  const annual = pick('rain');
  return {
    years: full.length,
    annual_rain_mm: round(mean(annual)),
    rain_cv: annual.length > 2 ? round(std(annual) / mean(annual), 2) : null,
    monsoon_share: round(mean(pick('monsoon')) / (mean(annual) || 1), 2),
    heavy_rain_days_yr: round(mean(pick('heavy')), 1),
    very_heavy_rain_days_yr: round(mean(pick('vheavy')), 1),
    heat_days_40_yr: round(mean(pick('heat40')), 1),
    heat_days_45_yr: round(mean(pick('heat45')), 1),
    max_monsoon_dry_spell_d: round(quantile(pick('maxDry'), 0.5)),
    annual_series: full.map(([y, v]) => [y, round(v.rain), v.heat40]),
  };
}
