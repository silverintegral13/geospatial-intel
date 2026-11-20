// India-specific sources: India Post PIN directory (live), market benchmarks (published figures, embedded),
// and the enterprise / government connectors a lender switches on with its own credentials or consent.
import { getJSON, haversine, round } from '../util.js';

export async function indiaPost(ctx, pin) {
  if (!pin || !/^\d{6}$/.test(String(pin).replace(/\s/g, ''))) throw new Error('no PIN code for this location');
  const j = await getJSON(ctx.fetch, `https://api.postalpincode.in/pincode/${String(pin).replace(/\s/g, '')}`, { timeout: 10000 });
  const r = Array.isArray(j) ? j[0] : j;
  if (!r || r.Status !== 'Success') throw new Error('PIN not found');
  const po = r.PostOffice || [];
  return {
    pin: String(pin),
    post_offices: po.length,
    delivery_offices: po.filter((p) => p.DeliveryStatus === 'Delivery').length,
    pin_district: po[0]?.District || null,
    pin_division: po[0]?.Division || null,
    pin_block: po[0]?.Block || null,
    pin_state: po[0]?.State || null,
    branch_types: [...new Set(po.map((p) => p.BranchType))],
  };
}

// Average primary-market residential prices, ₹ per sq ft, calendar 2025 (PropTiger Real Insight CY2025;
// Bengaluru, NCR and MMR use the Q4 2025 figures). Used only as the market anchor for the valuation prior.
export const CITY_BENCHMARKS = [
  { city: 'Mumbai MMR', lat: 19.076, lon: 72.8777, radius_km: 45, resi_psf: 13164, src: 'PropTiger CY2025' },
  { city: 'Delhi NCR', lat: 28.6139, lon: 77.209, radius_km: 50, resi_psf: 8570, src: 'PropTiger CY2025' },
  { city: 'Bengaluru', lat: 12.9716, lon: 77.5946, radius_km: 35, resi_psf: 8533, src: 'PropTiger CY2025' },
  { city: 'Hyderabad', lat: 17.385, lon: 78.4867, radius_km: 35, resi_psf: 7644, src: 'PropTiger CY2025' },
  { city: 'Pune', lat: 18.5204, lon: 73.8567, radius_km: 30, resi_psf: 7192, src: 'PropTiger CY2025' },
  { city: 'Chennai', lat: 13.0827, lon: 80.2707, radius_km: 35, resi_psf: 7200, src: 'PropTiger CY2025' },
  { city: 'Kolkata', lat: 22.5726, lon: 88.3639, radius_km: 30, resi_psf: 5945, src: 'PropTiger CY2025' },
  { city: 'Ahmedabad', lat: 23.0225, lon: 72.5714, radius_km: 30, resi_psf: 4754, src: 'PropTiger CY2025' },
];

// Tier fallback (₹ per sq ft built-up) when the asset is outside the eight benchmark metros.
// LOW-CONFIDENCE PRIOR: replace with circle rates / lender comparables per state before production use.
export const TIER_PRIOR = { tier2_city: 4200, town: 2900, periurban: 2300, rural: 1500 };

// Agricultural land ₹ per acre by state band. LOW-CONFIDENCE PRIOR for the demo; the production feed is
// the IIMA agri land price index plus state jantri / circle rates under a data agreement.
export const AGRI_PRIOR_PER_ACRE = {
  high: { states: ['Punjab', 'Haryana', 'Gujarat', 'Maharashtra', 'Kerala', 'Tamil Nadu', 'Karnataka', 'Telangana', 'Andhra Pradesh', 'Goa', 'Delhi', 'Chandigarh', 'Puducherry'], value: 1400000 },
  mid: { states: ['Uttar Pradesh', 'Uttarakhand', 'Himachal Pradesh', 'Rajasthan', 'Madhya Pradesh', 'West Bengal', 'Jammu and Kashmir', 'Bihar'], value: 750000 },
  low: { states: [], value: 450000 },
};
export function agriPrior(state) {
  const s = (state || '').normalize('NFD').replace(/[̀-ͯ]/g, '');
  for (const band of ['high', 'mid']) if (AGRI_PRIOR_PER_ACRE[band].states.some((x) => s.includes(x))) return { band, value: AGRI_PRIOR_PER_ACRE[band].value };
  return { band: 'low', value: AGRI_PRIOR_PER_ACRE.low.value };
}

export function nearestBenchmark(lat, lon) {
  let best = null;
  for (const c of CITY_BENCHMARKS) {
    const d = haversine(lat, lon, c.lat, c.lon) / 1000;
    if (!best || d < best.dist_km) best = { ...c, dist_km: round(d, 1) };
  }
  return best;
}

// Connectors a lender enables with its own credentials, consent artefacts or data agreements.
// They are never called from the public demo; the API reports them as `requires_credentials`.
export const ENTERPRISE_CONNECTORS = [
  { id: 'uli_land_records', name: 'ULI land records (RoR, mutation, mortgage)', provider: 'RBI Innovation Hub · Unified Lending Interface', adds: 'Owner name match, encumbrances, mutation history, ULPIN', access: 'Consent-based API for regulated lenders' },
  { id: 'cersai', name: 'CERSAI security-interest search', provider: 'Central Registry (CERSAI)', adds: 'Prior charges on the same asset; double-financing check', access: 'Lender login; per-search fee' },
  { id: 'ecourts', name: 'eCourts case search', provider: 'eCourts Services', adds: 'Litigation on the parcel or owner; dispute risk', access: 'Case metadata; captcha-gated portal, needs licensed aggregator' },
  { id: 'rera', name: 'State RERA project registry', provider: 'State RERA authorities', adds: 'Project approval, completion stage, complaints (Property Pulse ground truth)', access: 'Public portals per state' },
  { id: 'baanknet', name: 'BAANKNET / SARFAESI auction notices', provider: 'PSB Alliance', adds: 'Reserve prices, re-listing rounds, realised haircuts (liquidity labels)', access: 'Public listings; parsed archive' },
  { id: 'jantri', name: 'Circle / jantri rates', provider: 'State IGR & revenue departments', adds: 'Government floor value per village and land use', access: 'Public, state-specific formats' },
  { id: 'gatishakti', name: 'PM GatiShakti Public (UGI)', provider: 'BISAG-N · DPIIT', adds: 'Planned highways, rail, logistics parks, utility corridors (230 approved datasets)', access: 'Regulated access with registration' },
  { id: 'bhuvan', name: 'Bhuvan thematic layers', provider: 'ISRO NRSC', adds: 'LULC 1:50k, wasteland, flood-hazard zonation', access: 'OGC WMS; some layers need login' },
  { id: 'account_aggregator', name: 'Account Aggregator / GSTN', provider: 'Sahamati network · GSTN', adds: 'Cash flows and GST turnover to cross-check Factory Pulse', access: 'Borrower consent artefact' },
  { id: 'lender_book', name: 'Lender loan book & recoveries', provider: 'Tenant', adds: 'PD, LGD, realised recovery labels for calibration', access: 'Tenant upload / SFTP / API' },
];
