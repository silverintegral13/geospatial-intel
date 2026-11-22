// Collateral models: location value index, valuation range, hazards, access, activity, land-use
// consistency, liquidity and realisable value, expected-loss LTV band, red flags and a plain-language summary.
// Every coefficient here is a transparent prior. Calibration on lender outcomes replaces them per tenant.
import { clamp, ramp, round, mean, inr, MODEL_VERSION } from '../util.js';
import { nearestBenchmark, TIER_PRIOR, agriPrior } from '../sources/india.js';
import { circleCheck } from '../sources/circle.js';

export const ASSET_TYPES = {
  residential: { label: 'Residential property', days: 110, haircut: 0.14, halfwidth: 0.18, ltvCap: 0.75, pd: 0.035 },
  commercial: { label: 'Commercial property', days: 170, haircut: 0.2, halfwidth: 0.25, ltvCap: 0.65, pd: 0.05 },
  industrial: { label: 'Industrial / MSME unit', days: 260, haircut: 0.27, halfwidth: 0.28, ltvCap: 0.6, pd: 0.06 },
  agri_land: { label: 'Agricultural land', days: 230, haircut: 0.25, halfwidth: 0.35, ltvCap: 0.6, pd: 0.07 },
  plot: { label: 'Non-agricultural plot', days: 150, haircut: 0.18, halfwidth: 0.25, ltvCap: 0.55, pd: 0.05 },
};

export const DEFAULT_POLICY = {
  cost_of_funds: 0.105,      // annual, discounts the time to sale
  el_threshold: 0.02,        // max 12-month expected loss as a share of the loan
  sale_costs: 0.03,          // legal + brokerage + holding on a forced sale
  ltv_caps: Object.fromEntries(Object.entries(ASSET_TYPES).map(([k, v]) => [k, v.ltvCap])),
  pd_12m: Object.fromEntries(Object.entries(ASSET_TYPES).map(([k, v]) => [k, v.pd])),
  weights: { location: 0.22, access: 0.18, hazard: 0.22, activity: 0.18, consistency: 0.12, confidence: 0.08 },
};

const wavg = (pairs) => {
  const ok = pairs.filter(([v]) => v != null && Number.isFinite(v));
  const w = ok.reduce((s, [, k]) => s + k, 0);
  return w ? ok.reduce((s, [v, k]) => s + v * k, 0) / w : null;
};
const log10p = (x) => (x == null ? null : Math.log10(x + 1));

export function locationIndex(F, lat, lon) {
  const bench = nearestBenchmark(lat, lon);
  const parts = {
    lights: ramp(F.light_index_local, 3, 60),
    buildings: ramp(log10p(F.buildings_1500m), 1, 3.7),
    amenities: ramp(log10p(F.amenities_1500m), 0.3, 2.0),
    road: ramp(F.nearest_major_road_m, 5000, 150),
    city: ramp(bench?.dist_km, 80, 5),
  };
  const v = wavg([[parts.lights, 0.35], [parts.buildings, 0.2], [parts.amenities, 0.15], [parts.road, 0.15], [parts.city, 0.15]]);
  return { value: v, parts, bench };
}

export function valuation(F, A, loc) {
  const t = A.asset_type, L = loc.value ?? 0.4, bench = loc.bench;
  const inCity = bench && bench.dist_km <= bench.radius_km;
  let psf, basis;
  if (inCity) { psf = bench.resi_psf * (0.6 + 0.8 * L); basis = `${bench.city} average ₹${bench.resi_psf.toLocaleString('en-IN')}/sq ft (${bench.src}), scaled by location index`; }
  else {
    const tier = L > 0.6 ? 'tier2_city' : L > 0.4 ? 'town' : L > 0.2 ? 'periurban' : 'rural';
    psf = TIER_PRIOR[tier] * (0.8 + 0.4 * L); basis = `${tier.replace('_', ' ')} prior ₹${TIER_PRIOR[tier].toLocaleString('en-IN')}/sq ft (low-confidence), scaled by location index`;
  }
  const areaSqft = (A.area_sqm || 0) * 10.7639;
  let value, unit, rate;
  if (t === 'agri_land') {
    const pr = agriPrior(F.state);
    const periurban = 1 + 2.5 * Math.max(0, L - 0.25);
    const vigour = F.ndvi_max == null ? 1 : F.ndvi_max > 0.6 ? 1.1 : F.ndvi_max < 0.3 ? 0.85 : 1;
    const acres = (A.area_sqm || 4046.86) / 4046.86;
    rate = pr.value * periurban * vigour; unit = '₹/acre';
    value = rate * acres;
    basis = `${pr.band}-band state prior ₹${(pr.value / 1e5).toFixed(1)} L/acre (low-confidence), ×${periurban.toFixed(2)} peri-urban premium, ×${vigour} crop vigour`;
  } else if (t === 'residential' || t === 'commercial') {
    const built = A.built_up_sqft || areaSqft || 1000;
    rate = psf * (t === 'commercial' ? 1.25 : 1); unit = '₹/sq ft built-up';
    value = rate * built;
  } else if (t === 'industrial') {
    rate = psf * 0.32; unit = '₹/sq ft land incl. sheds';
    value = rate * (areaSqft || 10000);
  } else {
    rate = psf * 0.55; unit = '₹/sq ft land';
    value = rate * (areaSqft || 2000);
  }
  return { value, rate, unit, basis, in_benchmark_city: !!inCity };
}

export function hazards(F) {
  const river = { none: 0, small: 0.25, medium: 0.5, large: 0.7 }[F.river_size] ?? null;
  const low = F.rel_elev_1500m == null ? null : clamp((5 - F.rel_elev_1500m) / 8);
  const water = F.water_occurrence_250m_max == null ? null : clamp(F.water_occurrence_250m_max / 40);
  const rain = F.very_heavy_rain_days_yr == null ? null : clamp(F.very_heavy_rain_days_yr / 4);
  const alertBump = { severe: 0.35, elevated: 0.2, normal: 0 }[F.forecast_alert || F.recent_alert] ?? 0;
  const base = wavg([[river != null && low != null ? river * (0.4 + 0.6 * low) : river, 0.45], [water, 0.3], [rain, 0.15], [low, 0.1]]);
  const flood = base == null ? null : clamp(base + alertBump);
  const heat = ramp(F.heat_days_40_yr, 5, 60);
  const drought = wavg([[ramp(F.rain_cv, 0.15, 0.4), 0.5], [ramp(F.max_monsoon_dry_spell_d, 10, 30), 0.5]]);
  const goodness = wavg([[flood == null ? null : 1 - flood, 0.6], [heat == null ? null : 1 - heat, 0.2], [drought == null ? null : 1 - drought, 0.2]]);
  return { flood, heat, drought, score: goodness };
}

export function access(F) {
  return wavg([
    [ramp(F.nearest_major_road_m, 6000, 200), 0.45],
    [F.local_road_within_250m == null ? null : F.local_road_within_250m ? 1 : 0, 0.25],
    [ramp(F.nearest_rail_station_m, 25000, 2000), 0.1],
    [ramp(log10p(F.buildings_1500m), 0.5, 3.3), 0.2],
  ]);
}

export function activity(F, t) {
  if (t === 'agri_land') {
    return wavg([[ramp(F.ndvi_max, 0.25, 0.7), 0.5], [ramp(F.ndvi_amplitude, 0.05, 0.35), 0.3], [F.ndvi_valid_obs == null ? null : clamp(F.ndvi_valid_obs / 5), 0.2]]);
  }
  const growth = ramp(F.light_growth_2012_2016, -0.1, 0.3);
  if (t === 'industrial') {
    const ind = F.landuse_at_point === 'industrial' ? 1 : (F.landuse_nearby?.industrial ? 0.7 : 0.2);
    return wavg([[ramp(F.light_index_point, 5, 60), 0.5], [F.landuse_nearby ? ind : null, 0.3], [growth, 0.2]]);
  }
  return wavg([[ramp(F.light_index_local, 2, 50), 0.5], [ramp(log10p(F.buildings_500m), 0.5, 2.5), 0.3], [growth, 0.2]]);
}

const BUILT = /built|residential|commercial|retail|industrial|construction/i;
const FARM = /crop|farmland|orchard|grass|rangeland|tree|shrub|meadow/i;
const WET = /water|wetland|flooded|mangrove/i;
export function consistency(F, t) {
  const obs = [F.worldcover_label, F.lulc_latest, F.landuse_at_point].filter(Boolean).join(' ');
  if (!obs) return { score: null, observed: null };
  let s;
  if (WET.test(F.worldcover_label || '') && (F.water_occurrence_pct ?? 0) > 30) s = 0.1;
  else if (t === 'agri_land') s = FARM.test(obs) ? 1 : BUILT.test(obs) ? 0.35 : 0.6;
  else if (t === 'residential' || t === 'commercial') s = BUILT.test(obs) ? 1 : /bare/i.test(obs) ? 0.65 : FARM.test(obs) ? 0.45 : 0.6;
  else if (t === 'industrial') s = /industrial/i.test(obs) ? 1 : BUILT.test(obs) || /bare/i.test(obs) ? 0.85 : FARM.test(obs) ? 0.4 : 0.6;
  else s = /bare|grass|built|construction/i.test(obs) ? 0.9 : FARM.test(obs) ? 0.7 : 0.6;
  return { score: s, observed: [F.worldcover_label, F.lulc_latest && `${F.lulc_latest} (${F.lulc_latest_year})`, F.landuse_at_point && `OSM: ${F.landuse_at_point}`].filter(Boolean).join(' · ') };
}

export function grade(cqs) { return cqs >= 80 ? 'A' : cqs >= 68 ? 'B' : cqs >= 55 ? 'C' : cqs >= 42 ? 'D' : 'E'; }

export function liquidity(t, L, hz, acc, cons) {
  const base = ASSET_TYPES[t];
  const fl = hz.flood ?? 0.2;
  const days = base.days * (1.6 - 1.0 * (L ?? 0.4)) * (1 + 0.5 * fl) * ((acc ?? 0.5) < 0.4 ? 1.25 : 1);
  const haircut = clamp(base.haircut + 0.1 * (1 - (L ?? 0.4)) + 0.08 * fl + ((cons ?? 1) < 0.5 ? 0.05 : 0), 0.05, 0.6);
  return { days_to_sell: Math.round(days), haircut };
}

export function ltvBand(t, V, realisable, cqs, policy, loanAmount) {
  const cap = policy.ltv_caps[t] ?? 0.6;
  const pdBase = policy.pd_12m[t] ?? 0.05;
  const pd = clamp(pdBase * Math.exp((60 - cqs) / 25), 0.003, 0.5);
  const lgdAt = (ltv) => clamp(1 - realisable / (ltv * V) + 0.02, 0.05, 1);
  let maxEl = 0.1;
  for (let l = 0.1; l <= 0.95; l += 0.005) { if (pd * lgdAt(l) <= policy.el_threshold) maxEl = l; else break; }
  const rec = Math.min(cap, maxEl);
  const out = { pd_12m: pd, policy_cap: cap, el_max_ltv: maxEl, recommended_ltv: rec, max_loan: rec * V };
  if (loanAmount) {
    const ltv = loanAmount / V;
    out.actual_ltv = ltv; out.lgd = lgdAt(ltv); out.expected_loss = pd * lgdAt(ltv) * loanAmount; out.el_rate = pd * lgdAt(ltv);
  }
  return out;
}

export function score(F, A, ctx, policy = DEFAULT_POLICY, health = {}) {
  const t = ASSET_TYPES[A.asset_type] ? A.asset_type : 'residential';
  A = { ...A, asset_type: t };
  const loc = locationIndex(F, ctx.lat, ctx.lon);
  const val = valuation(F, A, loc);
  const hz = hazards(F);
  const acc = access(F);
  const act = activity(F, t);
  const con = consistency(F, t);
  const live = Object.values(health).filter((h) => h.status === 'ok').length;
  const total = Object.keys(health).length || 1;
  const confidence = live / total;
  const W = policy.weights || DEFAULT_POLICY.weights;
  const sub = { location: loc.value, access: acc, hazard: hz.score, activity: act, consistency: con.score, confidence };
  const cqs = 100 * (wavg(Object.entries(sub).map(([k, v]) => [v, W[k]])) ?? 0.5);
  const missingKey = ['nightlights', 'osm', 'sentinel2', 'landcover'].filter((k) => health[k] && health[k].status !== 'ok').length;
  const w = ASSET_TYPES[t].halfwidth + 0.05 * missingKey + (val.in_benchmark_city || t === 'agri_land' ? 0 : 0.08);
  const V = val.value;
  const circ = circleCheck({ lat: ctx.lat, lon: ctx.lon, state: F.state || F.pin_state, assetType: t, builtSqft: A.built_up_sqft || (A.area_sqm ? A.area_sqm * 10.7639 : null), areaSqm: A.area_sqm, p50: V, marketRatePsf: val.unit === '₹/acre' ? val.rate / 43560 : val.rate, declared: A.declared_value, ageYears: A.building_age_years });
  const liq = liquidity(t, loc.value, hz, acc, con.score);
  // A government floor at or above market makes resale slower: buyers pay stamp duty on the floor.
  if (circ.circle_above_market) { liq.haircut = clamp(liq.haircut + 0.04, 0.05, 0.6); liq.days_to_sell = Math.round(liq.days_to_sell * 1.15); circ.liquidity_penalty = { haircut_pp: 4, days_pct: 15 }; }
  const r = policy.cost_of_funds;
  const realisable = V * (1 - liq.haircut) / Math.pow(1 + r, liq.days_to_sell / 365) * (1 - policy.sale_costs);
  const ltv = ltvBand(t, V, realisable, cqs, policy, A.loan_amount);
  const result = {
    model_version: MODEL_VERSION,
    asset_type: t, asset_label: ASSET_TYPES[t].label,
    score: { cqs: round(cqs, 1), grade: grade(cqs), sub: Object.fromEntries(Object.entries(sub).map(([k, v]) => [k, v == null ? null : round(v * 100)])) },
    valuation: {
      p50: Math.round(V), p10: Math.round(V / (1 + w)), p90: Math.round(V * (1 + w)), interval: '80% (prior width, uncalibrated)',
      rate: Math.round(val.rate), rate_unit: val.unit, basis: val.basis,
      declared_value: A.declared_value || null, declared_vs_p50: A.declared_value ? round(A.declared_value / V, 2) : null,
    },
    liquidity: { days_to_sell: liq.days_to_sell, forced_sale_haircut: round(liq.haircut, 3), realisable_value: Math.round(realisable), realisable_share: round(realisable / V, 3) },
    hazards: { flood: round((hz.flood ?? NaN) * 100), heat: round((hz.heat ?? NaN) * 100), drought: round((hz.drought ?? NaN) * 100) },
    lending: {
      pd_12m: round(ltv.pd_12m, 4), policy_ltv_cap: ltv.policy_cap, el_constrained_ltv: round(ltv.el_max_ltv, 3), recommended_ltv: round(ltv.recommended_ltv, 3),
      max_loan: Math.round(ltv.max_loan), el_threshold: policy.el_threshold,
      loan_amount: A.loan_amount || null, actual_ltv: ltv.actual_ltv != null ? round(ltv.actual_ltv, 3) : null,
      stress_ltv_p10: A.loan_amount ? round(A.loan_amount / (V / (1 + w)), 3) : null,
      expected_loss: ltv.expected_loss != null ? Math.round(ltv.expected_loss) : null, el_rate: ltv.el_rate != null ? round(ltv.el_rate, 4) : null,
    },
    land_use: { observed: con.observed, consistency: con.score == null ? null : round(con.score * 100) },
    circle_rate: circ,
  };
  result.flags = flags(F, A, result, hz, health);
  result.decision = decision(result);
  result.summary = narrative(F, A, result);
  return result;
}

export function flags(F, A, R, hz, health) {
  const f = [];
  const add = (severity, code, text) => f.push({ severity, code, text });
  if ((hz.flood ?? 0) >= 0.6) add('high', 'FLOOD_EXPOSURE', `High flood exposure: ${F.river_size || 'unknown'} river within 5 km, ${F.rel_elev_1500m != null ? (F.rel_elev_1500m < 0 ? `${Math.abs(F.rel_elev_1500m)} m below` : `${F.rel_elev_1500m} m above`) + ' its surroundings' : 'terrain unknown'}${F.water_occurrence_250m_max ? `, surface water seen ${F.water_occurrence_250m_max}% of the time within 250 m` : ''}.`);
  else if ((hz.flood ?? 0) >= 0.4) add('medium', 'FLOOD_WATCH', 'Moderate flood exposure: check drainage and past inundation on a site visit.');
  if (F.forecast_alert === 'severe' || F.recent_alert === 'severe') add('high', 'RIVER_ALERT', `River discharge forecast above the 1-in-10-year annual peak (${F.forecast_30d_max_m3s} m³/s).`);
  if (R.land_use.consistency != null && R.land_use.consistency < 50) add('high', 'USE_MISMATCH', `Declared ${R.asset_label.toLowerCase()} but satellites see ${R.land_use.observed}.`);
  if (F.lulc_converted_to_built && A.asset_type === 'agri_land') add('medium', 'LAND_CONVERTED', `Parcel turned from ${F.lulc_first} (${F.lulc_first_year}) to built area (${F.lulc_latest_year}); check conversion (NA) status.`);
  if (R.valuation.declared_vs_p50 != null && A.declared_value > R.valuation.p90) add('high', 'VALUE_ABOVE_RANGE', `Declared value ${inr(A.declared_value)} is ${R.valuation.declared_vs_p50}× the model estimate, above the 90th percentile ${inr(R.valuation.p90)}.`);
  if (R.lending.actual_ltv != null && R.lending.actual_ltv > R.lending.recommended_ltv) add('high', 'LTV_BREACH', `Requested LTV ${(R.lending.actual_ltv * 100).toFixed(0)}% exceeds the recommended ${(R.lending.recommended_ltv * 100).toFixed(0)}%.`);
  if ((F.nearest_major_road_m ?? 0) > 5000) add('medium', 'REMOTE', `Nearest arterial road is ${(F.nearest_major_road_m / 1000).toFixed(1)} km away; repossession and resale will be slow.`);
  if (F.local_road_within_250m === false) add('medium', 'NO_FRONTAGE', 'No mapped road within 250 m: confirm legal access on site.');
  if (A.asset_type === 'agri_land' && F.ndvi_max != null && F.ndvi_max < 0.3) add('medium', 'LOW_VIGOUR', `Peak NDVI only ${F.ndvi_max} in the last year: parcel looks fallow or barren.`);
  if (A.asset_type === 'industrial' && F.light_index_point != null && F.light_index_point < 5) add('medium', 'DARK_UNIT', 'Almost no night-time light at the unit: confirm it is operating.');
  if ((hz.heat ?? 0) >= 0.7) add('low', 'HEAT_STRESS', `${F.heat_days_40_yr} days a year above 40 °C.`);
  if ((hz.drought ?? 0) >= 0.6 && A.asset_type === 'agri_land') add('medium', 'RAIN_VOLATILE', `Rainfall varies ${Math.round((F.rain_cv || 0) * 100)}% year to year; dry spells of ${F.max_monsoon_dry_spell_d} days in the monsoon.`);
  const C = R.circle_rate;
  if (C?.declared_below_circle) add('high', 'BELOW_CIRCLE', `Declared value ${inr(A.declared_value)} is below the government ${C.regime.toLowerCase()} value of ${inr(C.circle_value)} (${C.tier_label.toLowerCase()}): stamp duty applies on the higher figure, so the deed value is likely understated. Confirm the registered agreement value.`);
  if (C?.circle_above_market) add('medium', 'CIRCLE_ABOVE_MARKET', `Government floor ${inr(C.circle_value)} is at or above our market estimate: buyers would pay stamp duty on more than the price, which slows resale. Liquidity penalty applied (+4 pp haircut, +15% days to sell).`);
  else if (C?.market_to_circle != null && C.market_to_circle > 2) add('medium', 'WIDE_FLOOR_GAP', `Market estimate is ${C.market_to_circle}× the government floor. Deeds in such areas are often registered near the floor, and lenders can only lean on the documented value: size the loan on the registrable value.`);
  if (C?.growth?.signal === 'slow') add('low', 'SLOW_FLOOR_GROWTH', `Government floor rose only ${(C.growth.cagr_2y * 100).toFixed(1)}% a year over two years: weaker appreciation, watch liquidity.`);
  if (C?.growth?.signal === 'fast') add('low', 'TOP_UP_SIGNAL', `Government floor rising ${(C.growth.cagr_2y * 100).toFixed(1)}% a year: candidate for a top-up offer.`);
  const down = Object.entries(health).filter(([, h]) => h.status !== 'ok').map(([k]) => k);
  if (down.length >= 3) add('low', 'DATA_GAPS', `${down.length} sources did not respond (${down.join(', ')}); the range is widened.`);
  return f;
}

export function decision(R) {
  const high = R.flags.filter((x) => x.severity === 'high').length;
  if (high >= 2 || R.score.cqs < 42) return { route: 'refer', label: 'Refer: full field valuation and legal review', field_visit: true };
  if (high === 1 || R.score.cqs < 60) return { route: 'verify', label: 'Verify: targeted site visit on the flagged items', field_visit: true };
  return { route: 'fast_track', label: 'Fast-track: desktop valuation is sufficient', field_visit: false };
}

export function narrative(F, A, R) {
  const where = [F.locality, F.district, F.state].filter(Boolean).join(', ') || 'this location';
  const s = [];
  s.push(`${R.asset_label} in ${where}: collateral quality ${R.score.grade} (${R.score.cqs}/100).`);
  s.push(`Estimated value ${inr(R.valuation.p50)} (80% range ${inr(R.valuation.p10)} to ${inr(R.valuation.p90)}); in a forced sale it would likely take about ${R.liquidity.days_to_sell} days and realise ${inr(R.liquidity.realisable_value)} after a ${Math.round(R.liquidity.forced_sale_haircut * 100)}% haircut and carrying costs.`);
  const loc = [];
  if (F.light_index_local != null) loc.push(`night-light index ${F.light_index_local}`);
  if (F.buildings_1500m != null) loc.push(`${F.buildings_1500m.toLocaleString('en-IN')} mapped buildings within 1.5 km`);
  if (F.nearest_major_road_m != null) loc.push(`${F.nearest_major_road_class} road ${(F.nearest_major_road_m / 1000).toFixed(1)} km away`);
  if (loc.length) s.push(`Location: ${loc.join(', ')}.`);
  if (A.asset_type === 'agri_land' && F.ndvi_max != null) s.push(`Crop signal: peak NDVI ${F.ndvi_max} across ${F.ndvi_valid_obs} clear Sentinel-2 passes in the last year.`);
  const C = R.circle_rate;
  if (C?.circle_value) s.push(`Government floor (${C.regime.toLowerCase()}, ${C.tier_label.toLowerCase()}): ${inr(C.circle_value)}, so our market estimate is ${C.market_to_circle}× the floor.`);
  s.push(`Suggested LTV up to ${Math.round(R.lending.recommended_ltv * 100)}% (max loan ${inr(R.lending.max_loan)}), keeping 12-month expected loss under ${(R.lending.el_threshold * 100).toFixed(0)}%.`);
  const hi = R.flags.filter((x) => x.severity === 'high');
  if (hi.length) s.push(`Watch: ${hi.map((x) => x.text).join(' ')}`);
  s.push(R.decision.label + '.');
  return s.join(' ');
}

export function activityIndex(F, t) {
  const a = activity(F, t);
  return a == null ? null : round(a * 100);
}
