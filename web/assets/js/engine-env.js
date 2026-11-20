// Browser wiring for the shared engine: live fetch or offline mocks, tenant policies, district lookup, console log.
import { S, bus } from './state.js';
import { mockFetch, setPngEncoder } from '../../engine/mock.js';
import { encodePng } from '../../engine/vendor/imgdecode.js';
import { makeDistrictLookup } from '../../engine/geo.js';

setPngEncoder(encodePng);
const mock = mockFetch();
let lookup = null;
const cache = new Map();

export const TENANTS = {
  default: { name: 'BhoomiPulse default policy', policy: {} },
  psb: { name: 'Conservative public-sector bank', policy: { ltv_caps: { residential: 0.7, commercial: 0.6, industrial: 0.55, agri_land: 0.5, plot: 0.5 }, el_threshold: 0.01, pd_12m: { residential: 0.025, commercial: 0.04, industrial: 0.05, agri_land: 0.06, plot: 0.04 } } },
  nbfc: { name: 'Growth NBFC · small-ticket LAP', policy: { ltv_caps: { residential: 0.7, commercial: 0.65, industrial: 0.6, agri_land: 0.55, plot: 0.55 }, el_threshold: 0.03, cost_of_funds: 0.12, pd_12m: { residential: 0.05, commercial: 0.07, industrial: 0.08, agri_land: 0.09, plot: 0.07 } } },
  agri: { name: 'Agri & rural lender', policy: { ltv_caps: { agri_land: 0.65, residential: 0.65, plot: 0.5 }, el_threshold: 0.025, pd_12m: { agri_land: 0.06 } } },
};

export function engineEnv(extra = {}) {
  if (!lookup && S.districtsFC) lookup = makeDistrictLookup(S.districtsFC);
  return { fetch: S.offline ? mock : (u, i) => window.fetch(u, i), districtLookup: lookup, policy: TENANTS[S.tenant]?.policy, cache, ...extra };
}

const body = () => document.getElementById('consoleBody');
export function log(msg, cls = '') {
  const t = new Date().toLocaleTimeString('en-GB', { hour12: false, timeZone: 'Asia/Kolkata' }) + '.' + String(Date.now() % 1000).padStart(3, '0');
  const d = document.createElement('div'); d.innerHTML = `<span class="t">${t}</span> <span class="${cls}">${msg}</span>`;
  const b = body(); b.appendChild(d); while (b.children.length > 400) b.firstChild.remove(); b.scrollTop = b.scrollHeight;
}
export function consoleStat(s) { document.getElementById('consoleStat').textContent = s; }
bus.on('offline', (on) => log(on ? 'Offline demo mode ON · simulated upstreams' : 'Live mode · public APIs', 'hl'));
