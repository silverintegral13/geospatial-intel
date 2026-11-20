// Offline demo upstreams. Returns deterministic, location-aware stand-ins for every public API the engine calls,
// so the Command Center and the API still run with no internet (classroom Wi-Fi, CI tests).
// Everything produced here is SIMULATED and the UI labels it as such.
import { CITY_BENCHMARKS } from './sources/india.js';
import { haversine } from './util.js';

const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };
const urban = (lat, lon) => {
  let u = 0;
  for (const c of CITY_BENCHMARKS) u = Math.max(u, Math.exp(-haversine(lat, lon, c.lat, c.lon) / 1000 / 18));
  return Math.min(1, u + 0.15 * hash(lat.toFixed(2) + lon.toFixed(2)));
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

let pngEncoder = null;
export function setPngEncoder(fn) { pngEncoder = fn; }

function tileImage(z, x, y, epoch) {
  // Gaussian city blobs rendered into a 256x256 RGBA tile, brighter in 2016 than 2012.
  const W = 256, data = new Uint8Array(W * W * 4);
  const n = 2 ** z, k = epoch === '2012' ? 0.8 : 1;
  for (let py = 0; py < W; py++) for (let px = 0; px < W; px++) {
    const lon = (x + px / W) / n * 360 - 180;
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + py / W) / n))) * 180 / Math.PI;
    let v = 0;
    for (const c of CITY_BENCHMARKS) { const d = haversine(lat, lon, c.lat, c.lon) / 1000; v += Math.exp(-(d * d) / (2 * 22 * 22)); }
    v = Math.min(1, v * k + 0.08 * hash(px + ':' + py + epoch) * Math.min(1, v * 6));
    const i = (py * W + px) * 4;
    data[i] = 10 + 245 * v; data[i + 1] = 14 + 200 * v; data[i + 2] = 30 + 110 * v; data[i + 3] = 255;
  }
  return { width: W, height: W, data };
}

export function mockFetch(realFetch) {
  return async (url, init = {}) => {
    const u = new URL(typeof url === 'string' ? url : url.url);
    const p = u.searchParams;
    await new Promise((r) => setTimeout(r, 120 + 380 * hash(u.pathname + p.toString())));
    if (u.hostname.includes('nominatim')) {
      const lat = +p.get('lat'), lon = +p.get('lon');
      const near = CITY_BENCHMARKS.map((c) => ({ c, d: haversine(lat, lon, c.lat, c.lon) })).sort((a, b) => a.d - b.d)[0];
      return json({ display_name: `Simulated address near ${near.c.city}`, category: 'place', type: 'yes', address: { suburb: 'Sector ' + Math.floor(hash(lat) * 40 + 1), city: near.d < 40000 ? near.c.city.split(' ')[0] : undefined, village: near.d >= 40000 ? 'Simulated village' : undefined, state_district: near.c.city.split(' ')[0] + ' District', state: 'Simulated State', postcode: String(380000 + Math.floor(hash(lon) * 9999)) } });
    }
    if (u.hostname.includes('postalpincode')) return json([{ Status: 'Success', PostOffice: [{ Name: 'Simulated H.O', BranchType: 'Head Post Office', DeliveryStatus: 'Delivery', District: 'Simulated', Division: 'Simulated', Block: 'Simulated', State: 'Simulated State' }, { Name: 'Simulated B.O', BranchType: 'Branch Post Office', DeliveryStatus: 'Delivery', District: 'Simulated', Division: 'Simulated', Block: 'Simulated', State: 'Simulated State' }] }]);
    if (u.hostname.includes('overpass')) {
      const body = decodeURIComponent(String(init.body || '').replace(/^data=/, ''));
      const m = body.match(/around:3000,([\d.-]+),([\d.-]+)/); const lat = +m[1], lon = +m[2]; const U = urban(lat, lon);
      const d = 120 + (1 - U) * 4000 * hash(lat + 'r');
      const els = [
        { type: 'way', tags: { highway: U > 0.5 ? 'primary' : 'secondary', name: 'Simulated Highway' }, geometry: [{ lat: lat + d / 111320, lon: lon - 0.02 }, { lat: lat + d / 111320, lon: lon + 0.02 }] },
        { type: 'way', tags: { highway: 'residential' }, geometry: [{ lat: lat + 0.0005, lon: lon - 0.001 }, { lat: lat + 0.0005, lon: lon + 0.001 }] },
        ...Array.from({ length: Math.round(4 + 70 * U) }, (_, i) => ({ type: 'node', tags: { amenity: ['school', 'bank', 'clinic', 'atm', 'pharmacy', 'marketplace'][i % 6] }, center: { lat: lat + 0.004, lon } })),
        { type: 'node', tags: { railway: 'station', name: 'Simulated Jn' }, center: { lat: lat + (0.01 + (1 - U) * 0.04), lon } },
        { type: 'way', tags: { landuse: U > 0.4 ? 'residential' : 'farmland' }, center: { lat, lon } },
        { type: 'way', tags: { landuse: U > 0.4 ? 'residential' : 'farmland' } },
        { type: 'way', tags: { waterway: 'canal' }, geometry: [{ lat: lat - 0.012, lon: lon - 0.02 }, { lat: lat - 0.012, lon: lon + 0.02 }] },
        { type: 'count', tags: { ways: String(Math.round(10 + 1400 * U * U)) } },
        { type: 'count', tags: { ways: String(Math.round(60 + 9000 * U * U)) } },
      ];
      return json({ elements: els });
    }
    if (u.hostname === 'api.open-meteo.com') {
      const lats = p.get('latitude').split(',').map(Number);
      return json({ elevation: lats.map((la, i) => Math.round(50 + 40 * hash(la.toFixed(3) + i) + (i === 0 ? -2 : 0))) });
    }
    if (u.hostname.includes('flood-api')) {
      const lat = +p.get('latitude'), base = 5 + 400 * hash(lat.toFixed(2) + 'q') ** 2;
      const days = p.get('forecast_days') ? 30 : 365 * 23; const start = p.get('start_date') ? new Date(p.get('start_date')) : new Date();
      const time = [], q = [];
      for (let i = 0; i < days; i++) { const dt = new Date(start.getTime() + i * 864e5); time.push(dt.toISOString().slice(0, 10)); const m = dt.getUTCMonth(); q.push(+(base * (m >= 6 && m <= 8 ? 2.5 + 3 * hash(i + 'f') ** 4 : 0.6 + 0.2 * hash(i))).toFixed(1)); }
      return json({ daily: { time, river_discharge: q } });
    }
    if (u.hostname.includes('archive-api')) {
      const lat = +p.get('latitude'); const start = new Date('2016-01-01'), end = new Date(p.get('end_date'));
      const time = [], pr = [], tx = [];
      for (let t = start; t <= end; t = new Date(t.getTime() + 864e5)) {
        const m = t.getUTCMonth(), h = hash(t.toISOString().slice(0, 10) + lat.toFixed(1));
        time.push(t.toISOString().slice(0, 10));
        pr.push(m >= 5 && m <= 8 ? +(h < 0.45 ? 0 : 60 * h ** 3 * (1 + h)).toFixed(1) : +(h > 0.97 ? 8 * h : 0).toFixed(1));
        tx.push(+(26 + 10 * Math.sin(((m - 1) / 12) * 2 * Math.PI) + 6 * h - (lat - 20) * 0.3).toFixed(1));
      }
      return json({ daily: { time, precipitation_sum: pr, temperature_2m_max: tx } });
    }
    if (u.hostname.includes('gibs')) {
      const parts = u.pathname.split('/'); const [z, y, x] = parts.slice(-3).map((s) => parseInt(s, 10));
      const epoch = u.pathname.includes('2012') ? '2012' : '2016';
      const img = tileImage(z, x, y, epoch);
      if (!pngEncoder) return new Response('no encoder', { status: 500 });
      return new Response(pngEncoder(img), { status: 200, headers: { 'content-type': 'image/png' } });
    }
    if (u.hostname.includes('planetarycomputer')) {
      if (u.pathname.endsWith('/search')) {
        const b = JSON.parse(init.body || '{}'); const col = b.collections[0];
        if (col === 'sentinel-2-l2a') {
          const feats = []; const now = Date.now();
          for (let i = 0; i < 40; i++) feats.push({ id: `S2_SIM_${i}`, properties: { datetime: new Date(now - i * 9.5 * 864e5).toISOString(), 'eo:cloud_cover': +(30 * hash('c' + i)).toFixed(1), 's2:processing_baseline': '05.11' } });
          return json({ features: feats });
        }
        if (col === 'esa-worldcover') return json({ features: [{ id: 'ESA_WC_SIM', properties: { datetime: '2021-01-01T00:00:00Z' } }] });
        if (col === 'io-lulc-annual-v02') return json({ features: [2017, 2019, 2021, 2023].map((y) => ({ id: `IO_${y}`, properties: { start_datetime: `${y}-01-01T00:00:00Z` } })) });
        if (col === 'jrc-gsw') return json({ features: [{ id: 'JRC_SIM', properties: {} }] });
      }
      if (u.pathname.includes('/item/point/')) {
        const [lon, lat] = u.pathname.split('/point/')[1].split(',').map(Number); const U = urban(lat, lon);
        const col = p.get('collection'), item = p.get('item');
        if (col === 'sentinel-2-l2a') { const i = +item.split('_').pop(); const season = 0.5 + 0.5 * Math.sin((i / 40) * 2 * Math.PI * 1.1); const ndvi = U > 0.55 ? 0.12 + 0.06 * season : 0.2 + 0.5 * season; const r = 600, n = r * (1 + ndvi) / (1 - ndvi); return json({ coordinates: [lon, lat], values: [r + 1000, Math.round(n + 1000), hash(item) < 0.15 ? 9 : 4], band_names: ['B04_b1', 'B08_b1', 'SCL_b1'] }); }
        if (col === 'esa-worldcover') return json({ coordinates: [lon, lat], values: [U > 0.5 ? 50 : 40] });
        if (col === 'io-lulc-annual-v02') { const y = +item.split('_')[1]; return json({ coordinates: [lon, lat], values: [U > 0.5 ? 7 : U > 0.35 && y >= 2021 ? 7 : 5] }); }
        if (col === 'jrc-gsw') return json({ coordinates: [lon, lat], values: [hash(lat.toFixed(4)) < 0.15 ? 35 : 0, 0] });
      }
      return json({}, 404);
    }
    if (realFetch) return realFetch(url, init);
    return json({ error: 'offline' }, 503);
  };
}
