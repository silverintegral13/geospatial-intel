// BhoomiPulse engine entry point. The same module powers the browser Command Center,
// the Cloudflare Worker API and the Node/Docker on-prem server.
import { VERSION, MODEL_VERSION, uid, ringArea, centroid, round, pool, mean, quantile } from './util.js';
import { reverseGeocode, overpassContext } from './sources/osm.js';
import { terrain, flood, climate } from './sources/openmeteo.js';
import { nightLights } from './sources/gibs.js';
import { sentinel2, landcover, surfaceWater, ndviAnomaly } from './sources/pc.js';
import { indiaPost, ENTERPRISE_CONNECTORS } from './sources/india.js';
import { CIRCLE_TABLE, STATE_RATIO } from './sources/circle.js';
import { score, DEFAULT_POLICY, ASSET_TYPES, activityIndex } from './models/score.js';
import { decodeImage as pureDecode } from './vendor/imgdecode.js';

export { ASSET_TYPES, DEFAULT_POLICY, ENTERPRISE_CONNECTORS, VERSION, MODEL_VERSION, CIRCLE_TABLE, STATE_RATIO };

export const SOURCES = [
  { id: 'geocode', name: 'Reverse geocoding', provider: 'OpenStreetMap Nominatim', licence: 'ODbL', url: 'https://nominatim.openstreetmap.org', run: reverseGeocode, modes: ['full'], feeds: 'Address, district, state, PIN' },
  { id: 'osm', name: 'Roads, amenities, buildings, rail, land use', provider: 'OpenStreetMap Overpass', licence: 'ODbL', url: 'https://overpass-api.de', run: overpassContext, modes: ['full'], feeds: 'Access, market depth, repossession feasibility' },
  { id: 'terrain', name: 'Elevation and relative relief (17-point stencil)', provider: 'Copernicus DEM via Open-Meteo', licence: 'CC BY 4.0', url: 'https://open-meteo.com/en/docs/elevation-api', run: terrain, modes: ['full', 'fast'], feeds: 'Low-lying index, slope' },
  { id: 'flood', name: 'River discharge since 2003 + 30-day forecast', provider: 'GloFAS v4 via Open-Meteo', licence: 'CC BY 4.0', url: 'https://open-meteo.com/en/docs/flood-api', run: flood, modes: ['full', 'fast', 'pulse'], feeds: 'River size, flood peaks, live alerts' },
  { id: 'climate', name: 'Daily rain and heat since 2016', provider: 'ERA5 via Open-Meteo', licence: 'CC BY 4.0', url: 'https://open-meteo.com/en/docs/historical-weather-api', run: climate, modes: ['full', 'fast'], feeds: 'Extreme rain, heat days, dry spells' },
  { id: 'nightlights', name: 'Night-time lights 2012 → 2016', provider: 'NASA GIBS · VIIRS Black Marble', licence: 'Public domain', url: 'https://gibs.earthdata.nasa.gov', run: nightLights, modes: ['full', 'fast', 'pulse'], feeds: 'Economic activity, growth' },
  { id: 'sentinel2', name: 'Sentinel-2 NDVI history + latest scene', provider: 'ESA Copernicus via Microsoft Planetary Computer', licence: 'Copernicus open licence', url: 'https://planetarycomputer.microsoft.com/dataset/sentinel-2-l2a', run: sentinel2, modes: ['full', 'pulse'], feeds: 'Crop vigour, sowing, construction' },
  { id: 'landcover', name: 'Land cover 2021 + land use 2017-2023', provider: 'ESA WorldCover · Impact Observatory (Planetary Computer)', licence: 'CC BY 4.0', url: 'https://planetarycomputer.microsoft.com/dataset/io-lulc-annual-v02', run: landcover, modes: ['full'], feeds: 'Declared-use check, conversion' },
  { id: 'water', name: 'Surface water occurrence 1984-2021', provider: 'EC JRC Global Surface Water (Planetary Computer)', licence: 'Copernicus open licence', url: 'https://planetarycomputer.microsoft.com/dataset/jrc-gsw', run: surfaceWater, modes: ['full'], feeds: 'Inundation history' },
  { id: 'indiapost', name: 'PIN code directory', provider: 'India Post (api.postalpincode.in)', licence: 'Public', url: 'https://api.postalpincode.in', run: null, modes: ['full'], feeds: 'Postal district, delivery coverage', dependsOn: 'geocode' },
];

export const BENCHMARK_SOURCES = [
  { id: 'proptiger', name: 'City residential prices CY2025', provider: 'PropTiger Real Insight (published)', use: 'Valuation anchor in 8 metros' },
  { id: 'agri_prior', name: 'Agricultural land price prior by state band', provider: 'Low-confidence prior; production feed = IIMA agri land price index + jantri', use: 'Agri valuation anchor' },
  { id: 'circle', name: 'Government floor value (circle rate / ready reckoner / jantri / guidance value)', provider: `Curated state schedules (${CIRCLE_TABLE.length} localities + Delhi flat schedule); estimated from state ratios elsewhere`, use: 'Under-declaration check, registrable value, floor growth signal' },
  { id: 'policy', name: 'Lender policy (LTV caps, PD, EL threshold)', provider: 'Tenant configuration', use: 'LTV band and expected loss' },
];

function normaliseInput(input) {
  const out = { ...input };
  if (input.polygon && input.polygon.length >= 3) {
    const ring = input.polygon.map((p) => (Array.isArray(p) ? p : [p.lon, p.lat]));
    out.polygon = ring;
    out.area_sqm = out.area_sqm || Math.round(ringArea(ring));
    if (out.lat == null) [out.lat, out.lon] = centroid(ring);
  }
  out.lat = +out.lat; out.lon = +out.lon;
  if (!Number.isFinite(out.lat) || !Number.isFinite(out.lon) || Math.abs(out.lat) > 90 || Math.abs(out.lon) > 180) throw Object.assign(new Error('lat/lon (or polygon) required'), { status: 400 });
  out.asset_type = ASSET_TYPES[out.asset_type] ? out.asset_type : 'residential';
  for (const k of ['area_sqm', 'built_up_sqft', 'loan_amount', 'declared_value', 'building_age_years']) if (out[k] != null) out[k] = +out[k] || null;
  return out;
}

export function mergePolicy(policy) {
  const p = { ...DEFAULT_POLICY, ...(policy || {}) };
  p.ltv_caps = { ...DEFAULT_POLICY.ltv_caps, ...(policy?.ltv_caps || {}) };
  p.pd_12m = { ...DEFAULT_POLICY.pd_12m, ...(policy?.pd_12m || {}) };
  p.weights = { ...DEFAULT_POLICY.weights, ...(policy?.weights || {}) };
  return p;
}

// env: { fetch, decodeImage, onEvent, policy, cache, uaHeaders, disabled: [ids], opts }
export async function assess(input, env = {}) {
  const t0 = Date.now();
  const A = normaliseInput(input);
  const mode = input.mode || 'full';
  const emit = env.onEvent || (() => {});
  const ctx = {
    lat: A.lat, lon: A.lon, polygon: A.polygon, asset: A,
    fetch: env.fetch || globalThis.fetch.bind(globalThis), decodeImage: env.decodeImage || pureDecode,
    cache: env.cache || new Map(), uaHeaders: env.uaHeaders, opts: env.opts || {},
  };
  const F = {}; const health = {};
  const run = async (src, fn) => {
    const s = Date.now(); emit({ type: 'source:start', id: src.id, name: src.name, provider: src.provider });
    try {
      const r = await fn(ctx);
      Object.assign(F, r);
      health[src.id] = { status: 'ok', ms: Date.now() - s, fields: Object.keys(r).filter((k) => !k.startsWith('_')).length };
    } catch (e) {
      health[src.id] = { status: 'error', ms: Date.now() - s, error: String(e.message || e).slice(0, 160) };
    }
    emit({ type: 'source:end', id: src.id, name: src.name, ...health[src.id] });
  };
  const active = SOURCES.filter((s) => s.modes.includes(mode) && !(env.disabled || []).includes(s.id));
  const geocodeSrc = active.find((s) => s.id === 'geocode');
  const pinSrc = active.find((s) => s.id === 'indiapost');
  await Promise.all([
    ...active.filter((s) => s.run && s.id !== 'geocode').map((s) => run(s, s.run)),
    geocodeSrc ? run(geocodeSrc, geocodeSrc.run).then(() => (pinSrc ? run(pinSrc, (c) => indiaPost(c, F.postcode)) : null)) : null,
  ]);
  if (env.districtLookup && (!F.district || !F.state)) {
    const d = env.districtLookup(A.lat, A.lon);
    if (d) { F.district ||= d.district; F.state ||= d.state; F.admin_source = 'boundary lookup (geoBoundaries ADM2)'; }
  }
  const policy = mergePolicy(env.policy);
  const R = score(F, A, ctx, policy, health);
  const sources = active.map((s) => ({ id: s.id, name: s.name, provider: s.provider, licence: s.licence, url: s.url, feeds: s.feeds, ...(health[s.id] || { status: 'skipped' }) }));
  const res = {
    id: uid('asm'),
    object: 'collateral_assessment',
    created_at: new Date().toISOString(),
    engine_version: VERSION,
    mode,
    reference_id: input.reference_id || null,
    input: { lat: A.lat, lon: A.lon, polygon: A.polygon || null, asset_type: A.asset_type, area_sqm: A.area_sqm || null, built_up_sqft: A.built_up_sqft || null, loan_amount: A.loan_amount || null, declared_value: A.declared_value || null, building_age_years: A.building_age_years ?? null },
    location: { display_name: F.display_name, locality: F.locality, district: F.district || F.pin_district, state: F.state || F.pin_state, postcode: F.postcode },
    ...R,
    signals: F,
    sources,
    provenance: { live_sources_ok: sources.filter((s) => s.status === 'ok').length, live_sources_called: sources.length, benchmarks: BENCHMARK_SOURCES, enterprise_connectors: (env.enterprise || []).length ? env.enterprise : ENTERPRISE_CONNECTORS.map((c) => ({ id: c.id, status: 'requires_credentials' })) },
    timing_ms: Date.now() - t0,
    disclaimer: 'AI-assisted collateral second opinion from public data. Not a registered valuation; valuation ranges are uncalibrated priors until fitted on lender outcomes.',
  };
  emit({ type: 'done', id: res.id, ms: res.timing_ms });
  return res;
}

export async function assessMany(list, env = {}, { mode = 'fast', concurrency = 4, onProgress } = {}) {
  const cache = env.cache || new Map(); let done = 0;
  return pool(list, concurrency, async (item) => {
    const r = await assess({ ...item, mode: item.mode || mode }, { ...env, cache, onEvent: undefined }).catch((e) => ({ error: String(e.message || e), input: item }));
    done++; onProgress && onProgress(done, list.length, r);
    return r;
  });
}

// Book-level view for lenders, co-lending partners, pool buyers and equity investors.
export function portfolioAudit(results) {
  const ok = results.filter((r) => r && !r.error && r.score);
  const n = ok.length;
  const exposure = ok.reduce((s, r) => s + (r.input.loan_amount || 0), 0);
  const w = (f) => (exposure ? ok.reduce((s, r) => s + f(r) * (r.input.loan_amount || 0), 0) / exposure : mean(ok.map(f)));
  const grades = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  ok.forEach((r) => grades[r.score.grade]++);
  const byDistrict = {};
  ok.forEach((r) => { const k = [r.location.district, r.location.state].filter(Boolean).join(', ') || 'Unknown'; const d = (byDistrict[k] ||= { loans: 0, exposure: 0, cqs: [] }); d.loans++; d.exposure += r.input.loan_amount || 0; d.cqs.push(r.score.cqs); });
  const districts = Object.entries(byDistrict).map(([k, v]) => ({ district: k, loans: v.loans, exposure: v.exposure, share: exposure ? round(v.exposure / exposure, 3) : null, mean_cqs: round(mean(v.cqs), 1) })).sort((a, b) => b.exposure - a.exposure);
  const flagCounts = {};
  ok.forEach((r) => r.flags.forEach((f) => (flagCounts[f.code] = (flagCounts[f.code] || 0) + 1)));
  const wcqs = w((r) => r.score.cqs);
  const ltvBreach = ok.filter((r) => r.lending.actual_ltv != null && r.lending.actual_ltv > r.lending.recommended_ltv);
  const highFlood = ok.filter((r) => (r.hazards.flood ?? 0) >= 60);
  const el = ok.reduce((s, r) => s + (r.lending.expected_loss || 0), 0);
  const hhi = districts.reduce((s, d) => s + (d.share || 0) ** 2, 0);
  const bookGrade = wcqs >= 78 ? 'A' : wcqs >= 66 ? 'B' : wcqs >= 54 ? 'C' : wcqs >= 42 ? 'D' : 'E';
  return {
    object: 'portfolio_audit',
    loans_scored: n, loans_failed: results.length - n, exposure,
    book_grade: bookGrade, exposure_weighted_cqs: round(wcqs, 1), median_cqs: round(quantile(ok.map((r) => r.score.cqs), 0.5), 1),
    grade_mix: grades,
    ltv_breaches: { count: ltvBreach.length, exposure: ltvBreach.reduce((s, r) => s + (r.input.loan_amount || 0), 0) },
    high_flood_exposure: { count: highFlood.length, exposure: highFlood.reduce((s, r) => s + (r.input.loan_amount || 0), 0) },
    expected_loss_12m: Math.round(el), el_rate: exposure ? round(el / exposure, 4) : null,
    concentration: { top_district: districts[0] || null, hhi: round(hhi, 3), districts: districts.slice(0, 15) },
    flag_counts: flagCounts,
    field_visits_avoided: ok.filter((r) => r.decision && !r.decision.field_visit).length,
  };
}

// Pulse: monthly re-check of a financed asset. Compares with the previous snapshot and raises alerts.
export async function pulseSnapshot(asset, env = {}, previous = null) {
  const r = await assess({ ...asset, mode: 'pulse' }, env);
  const F = r.signals;
  const snap = {
    object: 'pulse_snapshot', asset_id: asset.asset_id || asset.reference_id || null, taken_at: r.created_at,
    activity_index: activityIndex(F, r.asset_type), light_index_local: F.light_index_local ?? null,
    ndvi_latest: F.ndvi_latest ?? null, ndvi_latest_date: F.ndvi_latest_date ?? null, ndvi_anomaly: ndviAnomaly(F.ndvi_series),
    flood_alert: F.forecast_alert || F.recent_alert || null, river_forecast_max_m3s: F.forecast_30d_max_m3s ?? null,
    latest_scene: F.latest_scene || null,
  };
  const alerts = [];
  if (snap.flood_alert === 'severe') alerts.push({ severity: 'high', code: 'FLOOD_ALERT', text: `River forecast above 1-in-10-year peak (${snap.river_forecast_max_m3s} m³/s).` });
  else if (snap.flood_alert === 'elevated') alerts.push({ severity: 'medium', code: 'FLOOD_WATCH', text: 'River forecast above the median annual peak.' });
  if (snap.ndvi_anomaly != null && snap.ndvi_anomaly < -0.15 && r.asset_type === 'agri_land') alerts.push({ severity: 'medium', code: 'CROP_STRESS', text: `Latest NDVI ${snap.ndvi_latest} is ${Math.abs(snap.ndvi_anomaly)} below the parcel's 12-month mean.` });
  if (previous && previous.activity_index != null && snap.activity_index != null) {
    const d = snap.activity_index - previous.activity_index;
    snap.activity_change = d;
    if (d <= -15) alerts.push({ severity: 'high', code: 'ACTIVITY_DROP', text: `Activity index fell ${Math.abs(d)} points since ${previous.taken_at.slice(0, 10)}.` });
  }
  snap.alerts = alerts;
  return snap;
}
