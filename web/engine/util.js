// Shared helpers for the BhoomiPulse engine. Runs unchanged in browsers, Cloudflare Workers and Node 18+.

export const VERSION = '2.0.0';
export const MODEL_VERSION = 'cqs-2026.11';

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const round = (x, d = 0) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
export const mean = (xs) => { const v = xs.filter(Number.isFinite); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null; };
export const std = (xs) => { const m = mean(xs); const v = xs.filter(Number.isFinite); return v.length > 1 ? Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / (v.length - 1)) : null; };
export const quantile = (xs, q) => { const v = xs.filter(Number.isFinite).sort((a, b) => a - b); if (!v.length) return null; const p = (v.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return v[lo] + (v[hi] - v[lo]) * (p - lo); };
// Smooth 0..1 score: 0 at `bad`, 1 at `good` (works whichever way round they are).
export const ramp = (x, bad, good) => (x == null || Number.isNaN(x) ? null : clamp((x - bad) / (good - bad)));

const R = 6371008.8;
export function haversine(lat1, lon1, lat2, lon2) {
  const t = Math.PI / 180, dLat = (lat2 - lat1) * t, dLon = (lon2 - lon1) * t;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * t) * Math.cos(lat2 * t) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
export function offset(lat, lon, dNorthM, dEastM) {
  const t = Math.PI / 180;
  return [lat + (dNorthM / R) / t, lon + (dEastM / (R * Math.cos(lat * t))) / t];
}
// Distance from point to a polyline given as [{lat, lon}, ...] (metres, equirectangular, fine below ~50 km).
export function distToLine(lat, lon, pts) {
  if (!pts || !pts.length) return Infinity;
  const kx = Math.cos(lat * Math.PI / 180) * 111320, ky = 110540;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const ax = (pts[i].lon - lon) * kx, ay = (pts[i].lat - lat) * ky;
    if (i === pts.length - 1) { best = Math.min(best, Math.hypot(ax, ay)); break; }
    const bx = (pts[i + 1].lon - lon) * kx, by = (pts[i + 1].lat - lat) * ky;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
    const t = L ? clamp(-(ax * dx + ay * dy) / L) : 0;
    best = Math.min(best, Math.hypot(ax + t * dx, ay + t * dy));
  }
  return best;
}
// Geodesic polygon area (m²) for [[lon, lat], ...] rings.
export function ringArea(ring) {
  if (!ring || ring.length < 3) return 0;
  const t = Math.PI / 180; let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[(i + 1) % ring.length];
    s += (x2 - x1) * t * (2 + Math.sin(y1 * t) + Math.sin(y2 * t));
  }
  return Math.abs(s * R * R / 2);
}
export function centroid(ring) {
  let x = 0, y = 0; const n = ring.length - (ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? 1 : 0);
  for (let i = 0; i < n; i++) { x += ring[i][0]; y += ring[i][1]; }
  return [y / n, x / n];
}
export function bboxAround(lat, lon, halfM) {
  const [n] = offset(lat, lon, halfM, 0), [s] = offset(lat, lon, -halfM, 0);
  const [, e] = offset(lat, lon, 0, halfM), [, w] = offset(lat, lon, 0, -halfM);
  return [w, s, e, n];
}
// Web-mercator tile maths
export function lonLatToTilePixel(lat, lon, z, size = 256) {
  const n = 2 ** z, x = (lon + 180) / 360 * n;
  const r = lat * Math.PI / 180, y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
  const tx = Math.floor(x), ty = Math.floor(y);
  return { tx, ty, px: Math.floor((x - tx) * size), py: Math.floor((y - ty) * size), z };
}
export const metresPerPixel = (lat, z, size = 256) => 156543.03392 * Math.cos(lat * Math.PI / 180) / (2 ** z) * (256 / size);

export const isoDate = (d) => d.toISOString().slice(0, 10);
export const daysAgo = (n, from = new Date()) => { const d = new Date(from); d.setUTCDate(d.getUTCDate() - n); return d; };

export function uid(prefix = 'asm') {
  const a = new Uint8Array(8); (globalThis.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => (a[i] = Math.random() * 256));
  return prefix + '_' + Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

export class UpstreamError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

// fetch with timeout + simple retry; returns parsed JSON (or ArrayBuffer when as='buffer').
export async function getJSON(fetchFn, url, { timeout = 15000, as = 'json', init = {}, retries = 1, signal } = {}) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    const onAbort = () => ctl.abort();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    try {
      const r = await fetchFn(url, { ...init, signal: ctl.signal });
      if (!r.ok) throw new UpstreamError(`HTTP ${r.status}`, r.status);
      return as === 'buffer' ? await r.arrayBuffer() : as === 'text' ? await r.text() : await r.json();
    } catch (e) {
      last = e;
      if (e.status && e.status < 500 && e.status !== 429) break;
      if (attempt < retries) await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
    }
  }
  throw last;
}

// Run async tasks with a concurrency cap.
export async function pool(items, n, fn) {
  const out = new Array(items.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; try { out[k] = await fn(items[k], k); } catch (e) { out[k] = { error: String(e.message || e) }; } }
  }));
  return out;
}

export const inr = (x) => {
  if (x == null || !Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1e7) return '₹' + (x / 1e7).toFixed(a >= 1e9 ? 0 : 2) + ' Cr';
  if (a >= 1e5) return '₹' + (x / 1e5).toFixed(1) + ' L';
  return '₹' + Math.round(x).toLocaleString('en-IN');
};
