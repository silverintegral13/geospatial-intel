// Government floor values: circle rate (Delhi), ready reckoner (Maharashtra), jantri (Gujarat),
// guidance value (Karnataka). No state publishes these through an API: the official portals are
// PDFs, captcha-gated search pages or district-wise tables. So the engine works in three tiers:
//
//   1. published   – a curated, cited, versioned rate for the locality (table below)
//   2. schedule    – a published state schedule that does not need the locality (Delhi flat bands)
//   3. estimated   – no published rate on file: circle ≈ market rate × state circle-to-market ratio,
//                    clearly labelled, with the ratio's rationale. Replaced by tier 1 as soon as the
//                    lender (or our document-AI ingestion of the state PDFs) supplies the rate.
//
// Rates are ₹ per square metre, as the states publish them.
import { haversine, round, clamp } from '../util.js';

const SQM_PER_SQFT = 1 / 10.7639;

// Tier 1: curated localities used by the demo assets and the deck. Each row carries its source.
export const CIRCLE_TABLE = [
  { id: 'pune_hinjewadi', city: 'Pune', state: 'Maharashtra', locality: 'Hinjewadi', lat: 18.5913, lon: 73.7389, radius_km: 3.5,
    regime: 'Ready reckoner (Annual Statement of Rates)', authority: 'IGR Maharashtra', fy: 'FY 2025-26',
    flat: 53780, office: 88500,
    prev_factor: 1 / 1.0595, prev_fy: 'FY 2023-24', growth_basis: 'state average for metros other than Mumbai (+5.95% in FY 2025-26, first revision in two years)',
    src: { label: 'Housing.com, ready reckoner rate for Hinjewadi (IGR Maharashtra ASR)', url: 'https://housing.com/news/ready-reckoner-rate-in-wakad-pune/' } },
  { id: 'pune_baner', city: 'Pune', state: 'Maharashtra', locality: 'Baner', lat: 18.559, lon: 73.7868, radius_km: 2.5,
    regime: 'Ready reckoner (Annual Statement of Rates)', authority: 'IGR Maharashtra', fy: 'FY 2025-26',
    flat_range: [42760, 83830], land: [19690, 31800],
    prev_factor: 1 / 1.0595, prev_fy: 'FY 2023-24', growth_basis: 'state average for metros other than Mumbai',
    src: { label: 'Square Yards, Pune ready reckoner by area', url: 'https://www.squareyards.com/blog/circle-rate-in-pune-crc' } },
  { id: 'pune_kothrud', city: 'Pune', state: 'Maharashtra', locality: 'Kothrud', lat: 18.5074, lon: 73.8077, radius_km: 2.5,
    regime: 'Ready reckoner (Annual Statement of Rates)', authority: 'IGR Maharashtra', fy: 'FY 2025-26',
    flat_range: [68320, 114570], land: [20530, 44730],
    prev_factor: 1 / 1.0595, prev_fy: 'FY 2023-24', growth_basis: 'state average for metros other than Mumbai',
    src: { label: 'Square Yards, Pune ready reckoner by area', url: 'https://www.squareyards.com/blog/circle-rate-in-pune-crc' } },
  { id: 'pune_hadapsar', city: 'Pune', state: 'Maharashtra', locality: 'Hadapsar', lat: 18.5089, lon: 73.926, radius_km: 3,
    regime: 'Ready reckoner (Annual Statement of Rates)', authority: 'IGR Maharashtra', fy: 'FY 2025-26',
    flat_range: [38180, 80930], land: [16700, 29700],
    prev_factor: 1 / 1.0595, prev_fy: 'FY 2023-24', growth_basis: 'state average for metros other than Mumbai',
    src: { label: 'Square Yards, Pune ready reckoner by area', url: 'https://www.squareyards.com/blog/circle-rate-in-pune-crc' } },
  { id: 'mumbai_andheri_e', city: 'Mumbai', state: 'Maharashtra', locality: 'Andheri East', lat: 19.1136, lon: 72.8697, radius_km: 2.5,
    regime: 'Ready reckoner (Annual Statement of Rates)', authority: 'IGR Maharashtra', fy: 'FY 2025-26',
    flat_range: [114000, 244000], office_range: [125000, 268000],
    prev_factor: 1 / 1.0339, prev_fy: 'FY 2023-24', growth_basis: 'MCGM average (+3.39% in FY 2025-26, first revision in two years)',
    src: { label: 'Bajaj Finserv Markets, Mumbai ready reckoner rates', url: 'https://www.bajajfinservmarkets.in/resources/stamp-duty/ready-reckoner-rate' } },
];

// Tier 2: Delhi minimum rates for built-up flats depend only on plinth area (2014 notification,
// unrevised since). DDA / co-operative society flats; private builder flats carry a multiplier.
export const DELHI = {
  state: 'Delhi', lat: 28.6139, lon: 77.209, radius_km: 18,
  regime: 'Circle rate (minimum value for registration)', authority: 'Revenue Department, GNCTD', fy: '2014 notification (unrevised; revision committee formed 2025)',
  flat_bands: [ { upto: 30, dda: 50400, builder: 55440 }, { upto: 50, dda: 54480, builder: 62652 }, { upto: 100, dda: 66240, builder: 79488 } ],
  land_by_category: { A: 774000, B: 245520, C: 159840, D: 127680, E: 70080, F: 56640, G: 46200, H: 23280 },
  src: { label: 'Delhi circle rates by category and flat size (2014 schedule)', url: 'https://www.realestateindia.com/blog/delhi-circle-rate.htm' },
};

// Tier 3: state circle-to-market ratios. Each is a prior with a stated reason, to be replaced by
// ratios fitted on the lender's own registered deeds (agreement value vs our P50).
export const STATE_RATIO = {
  Maharashtra: { ratio: 0.68, why: 'annual revisions keep the ready reckoner close to market; Hinjewadi RR is about two-thirds of our market estimate' },
  Delhi: { ratio: 0.45, why: 'circle rates unrevised since 2014 while prices rose' },
  Gujarat: { ratio: 0.55, why: 'jantri doubled in 2023 after 12 years; the 2024 draft revision is still pending' },
  Karnataka: { ratio: 0.7, why: 'guidance values revised up 25-30% on average in October 2023' },
  Rajasthan: { ratio: 0.5, why: 'government value was 50% of market value in the public SRG Housing Finance report we reviewed' },
  _default: { ratio: 0.55, why: 'median of public NBFC/HFC valuation reports reviewed (government value at 50% and 57% of market value)' },
};

// Regime notes for states with no locality rate on file, so the report names the right instrument.
const REGIME = {
  Maharashtra: ['Ready reckoner', 'IGR Maharashtra', 'igrmaharashtra.gov.in'],
  Gujarat: ['Jantri (Annual Statement of Rates)', 'Revenue Department, Gujarat (GARVI)', 'revenuedepartment.gujarat.gov.in'],
  Karnataka: ['Guidance value', 'Department of Stamps & Registration (Kaveri)', 'kaveri.karnataka.gov.in'],
  'Tamil Nadu': ['Guideline value', 'Registration Department, Tamil Nadu', 'tnreginet.gov.in'],
  Telangana: ['Market value (SRO)', 'Registration & Stamps Department, Telangana', 'registration.telangana.gov.in'],
  'West Bengal': ['Market value', 'Directorate of Registration & Stamp Revenue, WB', 'wbregistration.gov.in'],
  Delhi: ['Circle rate', 'Revenue Department, GNCTD', 'revenue.delhi.gov.in'],
};

const mid = (r) => (r ? (r[0] + r[1]) / 2 : null);

function lookupTable(lat, lon) {
  let best = null;
  for (const row of CIRCLE_TABLE) {
    const d = haversine(lat, lon, row.lat, row.lon) / 1000;
    if (d <= row.radius_km && (!best || d < best.dist_km)) best = { ...row, dist_km: round(d, 2) };
  }
  return best;
}

function inDelhi(lat, lon, state) {
  if (state) return /delhi/i.test(state);
  return haversine(lat, lon, DELHI.lat, DELHI.lon) / 1000 <= DELHI.radius_km;
}

// Generic depreciation for older buildings (state schedules differ; flagged as generic).
export function ageFactor(age) {
  if (age == null || !Number.isFinite(+age)) return { factor: 1, note: null };
  const f = clamp(1 - 0.01 * Math.max(0, +age - 2), 0.7, 1);
  return { factor: round(f, 3), note: `generic age factor ${round(f, 2)} for a ${age}-year-old building (state schedules differ)` };
}

// Main entry. `p50` and `marketRate` come from the valuation model; `rateUnit` tells us whether the
// market rate is per sq ft built-up or per acre.
export function circleCheck({ lat, lon, state, assetType, builtSqft, areaSqm, p50, marketRatePsf, declared, ageYears }) {
  const isUnit = assetType === 'residential' || assetType === 'commercial';
  const areaBasisSqm = isUnit ? (builtSqft ? builtSqft * SQM_PER_SQFT : null) : (areaSqm || null);
  const out = { tier: null, regime: null, authority: null, locality: null, fy: null, rate_sqm: null, rate_sqft: null, area_basis_sqm: areaBasisSqm ? round(areaBasisSqm, 1) : null, circle_value: null, source: null, method: null, notes: [] };
  const row = lookupTable(lat, lon);
  const age = ageFactor(ageYears);

  if (row && (isUnit || row.land)) {
    let rate;
    if (isUnit) rate = assetType === 'commercial' ? (row.office ?? mid(row.office_range) ?? (row.flat ?? mid(row.flat_range)) * 1.25) : (row.flat ?? mid(row.flat_range));
    else rate = mid(row.land);
    Object.assign(out, { tier: 'published', regime: row.regime, authority: row.authority, locality: `${row.locality}, ${row.city}`, fy: row.fy, rate_sqm: Math.round(rate), source: row.src });
    if (row.flat_range && isUnit && assetType === 'residential') out.notes.push(`published band ₹${row.flat_range[0].toLocaleString('en-IN')}–${row.flat_range[1].toLocaleString('en-IN')}/m² by sub-zone; midpoint used until the survey number is matched`);
    out.growth = { prev_fy: row.prev_fy, cagr_2y: round(Math.pow(1 / row.prev_factor, 1 / 2) - 1, 4), basis: row.growth_basis };
    out.method = 'locality rate × built-up area × age factor';
  } else if (inDelhi(lat, lon, state) && isUnit && areaBasisSqm && areaBasisSqm <= 100) {
    const band = DELHI.flat_bands.find((b) => areaBasisSqm <= b.upto);
    Object.assign(out, { tier: 'schedule', regime: DELHI.regime, authority: DELHI.authority, locality: 'Delhi (flat-size schedule)', fy: DELHI.fy, rate_sqm: band.dda, source: DELHI.src });
    out.notes.push(`DDA / society flat band up to ${band.upto} m²; private builder flats use ₹${band.builder.toLocaleString('en-IN')}/m²`);
    out.growth = { prev_fy: '2014', cagr_2y: 0, basis: 'unrevised since 2014', stale: true };
    out.method = 'size-band rate × plinth area × age factor';
  } else {
    const key = Object.keys(STATE_RATIO).find((k) => state && state.toLowerCase().includes(k.toLowerCase())) || '_default';
    const r = STATE_RATIO[key];
    const reg = REGIME[key];
    const rate = marketRatePsf ? marketRatePsf * 10.7639 * r.ratio : null;
    Object.assign(out, { tier: 'estimated', regime: reg ? reg[0] : 'Circle / guidance value', authority: reg ? reg[1] : 'State registration department', locality: state || null, fy: 'estimate', rate_sqm: rate ? Math.round(rate) : null,
      source: { label: `Estimated: market rate × ${key === '_default' ? 'default' : key} circle-to-market ratio ${r.ratio}`, url: reg ? `https://${reg[2]}` : null } });
    out.ratio_rationale = r.why;
    out.notes.push('No published rate on file for this locality. Upload the state schedule or the sale deed to replace this estimate.');
    out.method = 'market rate × state circle-to-market ratio (estimate)';
    if (key === 'Delhi') out.growth = { prev_fy: '2014', cagr_2y: 0, basis: 'unrevised since 2014', stale: true };
  }

  if (out.rate_sqm) out.rate_sqft = Math.round(out.rate_sqm * SQM_PER_SQFT);
  if (out.rate_sqm && areaBasisSqm) {
    out.circle_value = Math.round(out.rate_sqm * areaBasisSqm * (isUnit ? age.factor : 1));
    if (isUnit && age.note) out.notes.push(age.note);
  }
  // Checks (all relative to the government floor)
  if (out.circle_value && p50) {
    out.market_to_circle = round(p50 / out.circle_value, 2);
    out.circle_above_market = out.market_to_circle < 1.05;
  }
  if (out.circle_value && declared) {
    out.declared_to_circle = round(declared / out.circle_value, 2);
    out.declared_below_circle = declared < out.circle_value * 0.9; // 10% tolerance mirrors s.50C / 56(2)(x)
  }
  if (out.growth && !out.growth.stale) {
    const g = out.growth.cagr_2y;
    out.growth.signal = g < 0.02 ? 'slow' : g > 0.08 ? 'fast' : 'normal';
    out.growth.reading = out.growth.signal === 'slow' ? 'Floor value barely moving: weaker appreciation, watch liquidity'
      : out.growth.signal === 'fast' ? 'Floor value rising fast: possible top-up or cross-sell opportunity'
      : 'Floor value moving in line with inflation';
  } else if (out.growth?.stale) {
    out.growth.signal = 'stale';
    out.growth.reading = 'Schedule not revised for years: the floor says little about today\'s market';
  }
  out.tier_label = { published: 'Published rate', schedule: 'Published schedule', estimated: 'Estimated' }[out.tier];
  return out;
}
