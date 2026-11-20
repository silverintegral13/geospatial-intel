// Map: MapLibre globe, night-flight styling, VIIRS-driven sparkle, street-lamp twinkle, picking and parcel drawing.
import { gibsTileUrl, GIBS } from '../../engine/sources/gibs.js';
import { ringArea } from '../../engine/util.js';
import { bus, S } from './state.js';

const ML = window.maplibregl;
export let map;
const OFM = 'https://tiles.openfreemap.org/planet';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const yday = () => new Date(Date.now() - 36 * 3600e3).toISOString().slice(0, 10);
const GIBS_LAYERS = {
  blackmarble: (epoch) => ({ type: 'raster', tiles: [gibsTileUrl('VIIRS_Black_Marble', epoch, '{z}', '{y}', '{x}', 'png')], tileSize: 256, maxzoom: 8, attribution: 'NASA GIBS · VIIRS Black Marble' }),
  nightly: () => ({ type: 'raster', tiles: [`${GIBS}/VIIRS_SNPP_DayNightBand_At_Sensor_Radiance/default/${yday()}/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`], tileSize: 256, maxzoom: 8, attribution: 'NASA GIBS · VIIRS DNB' }),
  ndvi: () => ({ type: 'raster', tiles: [`${GIBS}/MODIS_Terra_NDVI_8Day/default/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`], tileSize: 256, maxzoom: 9, attribution: 'NASA GIBS · MODIS NDVI' }),
  flood: () => ({ type: 'raster', tiles: [`${GIBS}/MODIS_Combined_Flood_3-Day/default/default/GoogleMapsCompatible_Level9/{z}/{y}/{x}.png`], tileSize: 256, maxzoom: 9, attribution: 'NASA GIBS · MODIS flood' }),
};
const NAME = ['coalesce', ['get', 'name:en'], ['get', 'name_en'], ['get', 'name:latin'], ['get', 'name']];
const empty = () => ({ type: 'FeatureCollection', features: [] });

function style(offline) {
  const sources = {
    bm: GIBS_LAYERS.blackmarble('2016-01-01'),
    districts: { type: 'geojson', data: 'data/india_districts.geojson' },
    states: { type: 'geojson', data: 'data/india_states.geojson' },
  };
  if (!offline) { sources.ofm = { type: 'vector', url: OFM }; sources.esri = { type: 'raster', tiles: [ESRI], tileSize: 256, maxzoom: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }; }
  const layers = [{ id: 'bg', type: 'background', paint: { 'background-color': '#02040a' } }];
  if (!offline) layers.push(
    { id: 'sat', type: 'raster', source: 'esri', layout: { visibility: 'none' }, paint: { 'raster-saturation': -0.05, 'raster-contrast': 0.08 } },
    { id: 'water', type: 'fill', source: 'ofm', 'source-layer': 'water', paint: { 'fill-color': '#040915', 'fill-outline-color': '#0d2140' } },
    { id: 'landuse-res', type: 'fill', source: 'ofm', 'source-layer': 'landuse', minzoom: 9, filter: ['in', ['get', 'class'], ['literal', ['residential', 'suburb', 'neighbourhood', 'commercial', 'industrial', 'retail']]], paint: { 'fill-color': ['match', ['get', 'class'], 'industrial', '#120d06', '#0b0b10'], 'fill-opacity': 0.8 } },
  );
  layers.push({ id: 'bm', type: 'raster', source: 'bm', paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.95, 9, 0.75, 12, 0.25], 'raster-contrast': 0.18, 'raster-saturation': 0.1, 'raster-fade-duration': 400 } });
  if (!offline) layers.push(
    { id: 'rail', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 8, filter: ['==', ['get', 'class'], 'rail'], paint: { 'line-color': '#5ce1ff', 'line-opacity': 0.22, 'line-width': 1, 'line-dasharray': [2, 2] } },
    { id: 'road-glow-minor', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 10, filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary', 'minor', 'service']]], paint: { 'line-color': '#ff8a24', 'line-opacity': 0.28, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 10, 0.8, 14, 5, 18, 22], 'line-blur': ['interpolate', ['linear'], ['zoom'], 10, 1, 18, 14] } },
    { id: 'road-core-minor', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 11, filter: ['in', ['get', 'class'], ['literal', ['secondary', 'tertiary', 'minor', 'service']]], paint: { 'line-color': '#ffc46b', 'line-opacity': 0.75, 'line-width': ['interpolate', ['exponential', 1.6], ['zoom'], 11, 0.3, 14, 1, 18, 3] } },
    { id: 'road-glow-major', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 4, filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]], paint: { 'line-color': '#ff9a3d', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.15, 8, 0.35], 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 4, 0.6, 8, 2, 12, 8, 17, 28], 'line-blur': ['interpolate', ['linear'], ['zoom'], 4, 0.5, 17, 16] } },
    { id: 'road-core-major', type: 'line', source: 'ofm', 'source-layer': 'transportation', minzoom: 5, filter: ['in', ['get', 'class'], ['literal', ['motorway', 'trunk', 'primary']]], paint: { 'line-color': '#ffe1a8', 'line-opacity': 0.9, 'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 5, 0.25, 9, 0.7, 13, 2, 18, 5] } },
    { id: 'buildings', type: 'fill-extrusion', source: 'ofm', 'source-layer': 'building', minzoom: 13.5, paint: { 'fill-extrusion-color': ['interpolate', ['linear'], ['coalesce', ['get', 'render_height'], 6], 0, '#1d1609', 30, '#3b2a10', 100, '#6b4a18'], 'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 6], 'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0], 'fill-extrusion-opacity': ['interpolate', ['linear'], ['zoom'], 13.5, 0, 14.5, 0.88] } },
  );
  layers.push(
    { id: 'states-line', type: 'line', source: 'states', paint: { 'line-color': '#5ce1ff', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 3, 0.32, 8, 0.15], 'line-width': 0.8 } },
    { id: 'districts-fill', type: 'fill', source: 'districts', minzoom: 4.5, paint: { 'fill-color': '#5ce1ff', 'fill-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.07, 0] } },
    { id: 'districts-line', type: 'line', source: 'districts', minzoom: 4.5, paint: { 'line-color': '#5ce1ff', 'line-opacity': ['interpolate', ['linear'], ['zoom'], 4.5, 0, 6, 0.16, 10, 0.1], 'line-width': 0.6, 'line-dasharray': [3, 2] } },
  );
  if (!offline) layers.push(
    { id: 'place-city', type: 'symbol', source: 'ofm', 'source-layer': 'place', filter: ['in', ['get', 'class'], ['literal', ['city', 'town']]], layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 4, ['match', ['get', 'class'], 'city', 11, 0], 10, ['match', ['get', 'class'], 'city', 15, 12]], 'text-letter-spacing': 0.06, 'text-max-width': 8 }, paint: { 'text-color': '#d9e2f7', 'text-halo-color': '#02040a', 'text-halo-width': 1.4, 'text-opacity': ['interpolate', ['linear'], ['zoom'], 4, 0.65, 8, 0.9] } },
    { id: 'place-village', type: 'symbol', source: 'ofm', 'source-layer': 'place', minzoom: 11, filter: ['in', ['get', 'class'], ['literal', ['village', 'suburb', 'neighbourhood', 'hamlet']]], layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': 11 }, paint: { 'text-color': '#9fb0d6', 'text-halo-color': '#02040a', 'text-halo-width': 1.2 } },
  );
  return {
    version: 8, glyphs: 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    projection: { type: 'globe' },
    sky: { 'sky-color': '#02040a', 'horizon-color': '#10254d', 'fog-color': '#02040a', 'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.9, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 4, 0.8, 7, 0] },
    sources, layers,
  };
}

// ---------- sparkle ----------
const rnd = (() => { let s = 1337; return () => ((s = Math.imul(s ^ (s >>> 15), 2246822507) + 0x9e3779b9 >>> 0) / 4294967296); })();
const gauss = () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };

function citySparkle(cities) {
  const f = [];
  for (const [lon, lat, pop] of cities) {
    const n = Math.min(260, Math.max(2, Math.round(Math.sqrt(pop) / 9)));
    const sig = (0.7 + 1.5 * Math.log10(Math.max(pop, 1000) / 1000)) / 111;
    const k = Math.cos(lat * Math.PI / 180);
    for (let i = 0; i < n; i++) {
      const dx = gauss() * sig, dy = gauss() * sig * 0.9, r2 = (dx * dx + dy * dy) / (sig * sig);
      f.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lon + dx / k, lat + dy] }, properties: { g: (i + Math.floor(rnd() * 4)) % 4, b: Math.min(1, Math.exp(-r2 / 2) * (0.5 + rnd() * 0.7)), s: 0.5 + rnd() * rnd() * 1.6 } });
    }
  }
  return { type: 'FeatureCollection', features: f };
}

// fade stops: [zoom, opacity, dimPointsExponent] — at low zoom dim points are suppressed so the map stays sparkly, not blobby.
const SPARK = [
  { id: 'spk', src: 'city-sparkle', groups: 4, minzoom: 0, maxzoom: 9.5, stops: [[0, 0.9, 2.2], [4, 0.9, 1.6], [7, 0.85, 0.6], [9.5, 0, 0]] },
  { id: 'vspk', src: 'viirs-sparkle', groups: 3, minzoom: 4, maxzoom: 12.5, stops: [[4, 0, 1], [6, 1, 0.6], [11, 0.8, 0], [12.5, 0, 0]] },
  { id: 'lamp', src: 'lamps', groups: 3, minzoom: 12, maxzoom: 22, stops: [[12, 0, 0], [13, 1, 0], [22, 1, 0]] },
];
// Zoom-only (non data-driven) so per-frame twinkle updates stay a cheap uniform change.
const opacityExpr = (stops, k) => ['interpolate', ['linear'], ['zoom'], ...stops.flatMap(([z, o]) => [z, +(o * k).toFixed(3)])];
const groupState = [];

function addSparkleLayers() {
  map.addLayer({ id: 'spk-glow', type: 'heatmap', source: 'city-sparkle', maxzoom: 10, paint: {
    'heatmap-weight': ['*', ['^', ['get', 'b'], 2], 0.14], 'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 2, 0.45, 8, 1.1],
    'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 2, 4, 6, 10, 9, 26],
    'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.15, 'rgba(255,120,30,0.12)', 0.4, 'rgba(255,160,60,0.32)', 0.7, 'rgba(255,205,120,0.55)', 1, 'rgba(255,240,200,0.8)'],
    'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.7, 8, 0.5, 10, 0] } });
  map.on('error', (e) => { if (/circle-opacity|heatmap/.test(String(e?.error?.message))) console.warn(e.error.message); });
  for (const L of SPARK) for (let g = 0; g < L.groups; g++) for (const part of L.id === 'spk' ? ['hi', 'lo'] : ['all']) {
    const id = `${L.id}-${g}-${part}`;
    const filter = part === 'all' ? ['==', ['get', 'g'], g] : ['all', ['==', ['get', 'g'], g], [part === 'hi' ? '>' : '<=', ['get', 'b'], 0.38]];
    map.addLayer({ id, type: 'circle', source: L.src, minzoom: part === 'lo' ? 5.2 : L.minzoom, maxzoom: L.maxzoom, filter, paint: {
      'circle-color': ['interpolate', ['linear'], ['get', 'b'], 0, '#ff8a24', 0.5, '#ffc46b', 0.85, '#fff1cf', 1, '#ffffff'],
      'circle-opacity': opacityExpr(L.stops, 0.8),
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, ['*', 0.42, ['get', 's']], 5, ['*', 0.8, ['get', 's']], 7, ['*', 1.35, ['get', 's']], 10, ['*', 2.2, ['get', 's']], 14, ['*', 2.6, ['get', 's']], 18, ['*', 4, ['get', 's']]],
      'circle-blur': 0.55, 'circle-pitch-alignment': 'map' } });
    groupState.push({ id, w: 0.6 + rnd() * 1.6, ph: rnd() * 6.28, stops: L.stops, base: L.id === 'lamp' ? 0.85 : part === 'lo' ? 0.7 : 0.95 });
  }
}

let raf = 0, lastT = 0;
function animate(t) {
  raf = requestAnimationFrame(animate);
  if (t - lastT < 40) return; lastT = t;
  if (!S.layers.sparkle) return;
  const s = t / 1000, I = S.sparkleIntensity;
  for (const g of groupState) {
    const tw = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(s * g.w + g.ph)) * (0.85 + 0.15 * Math.sin(s * 7.3 * g.w + g.ph * 3));
    map.setPaintProperty(g.id, 'circle-opacity', opacityExpr(g.stops, Math.round(Math.min(1, g.base * tw * I) * 100) / 100));
  }
}

// ---------- VIIRS sampler (real data → sparkle) ----------
const tileCache = new Map();
async function loadTile(url) {
  if (!tileCache.has(url)) tileCache.set(url, (async () => {
    const r = await fetch(url, { mode: 'cors' }); if (!r.ok) throw new Error(r.status);
    const bmp = await createImageBitmap(await r.blob());
    const c = new OffscreenCanvas(bmp.width, bmp.height); const cx = c.getContext('2d', { willReadFrequently: true }); cx.drawImage(bmp, 0, 0);
    return cx.getImageData(0, 0, bmp.width, bmp.height);
  })().catch((e) => { tileCache.delete(url); throw e; }));
  const p = tileCache.get(url); p.then((img) => { p.__img = img; }).catch(() => {});
  return p;
}
const tile2lon = (x, z) => x / 2 ** z * 360 - 180;
const tile2lat = (y, z) => { const n = Math.PI - 2 * Math.PI * y / 2 ** z; return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n))); };
let sampleTimer = 0, sampleGen = 0;
export let viirsOK = null;

async function sampleViirs() {
  if (S.offline || !S.layers.sparkle) return;
  const z = map.getZoom(); if (z < 4 || z > 12.5) return;
  const L = Math.max(4, Math.min(8, Math.round(z)));
  const b = map.getBounds(); const gen = ++sampleGen;
  const n = 2 ** L, clampLat = (v) => Math.max(-85, Math.min(85, v));
  const x0 = Math.floor((b.getWest() + 180) / 360 * n), x1 = Math.floor((b.getEast() + 180) / 360 * n);
  const ly = (lat) => Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n);
  const y0 = ly(clampLat(b.getNorth())), y1 = ly(clampLat(b.getSouth()));
  const tiles = []; for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) tiles.push([x, y]);
  if (tiles.length > 30) return;
  const feats = []; const budget = 26000; const stride = L >= 7 ? 1 : 2;
  const res = await Promise.allSettled(tiles.map(([x, y]) => loadTile(gibsTileUrl('VIIRS_Black_Marble', S.epoch === 'nightly' ? '2016-01-01' : S.epoch, L, y, x, 'png')).then((img) => ({ img, x, y }))));
  if (gen !== sampleGen) return;
  const okTiles = res.filter((r) => r.status === 'fulfilled').map((r) => r.value);
  viirsOK = okTiles.length > 0; bus.emit('viirs', viirsOK);
  const perTile = Math.floor(budget / Math.max(1, okTiles.length));
  for (const { img, x, y } of okTiles) {
    const d = img.data, W = img.width; let c = 0;
    const lonW = tile2lon(x, L), lonE = tile2lon(x + 1, L), latN = tile2lat(y, L), latS = tile2lat(y + 1, L);
    for (let py = 0; py < W && c < perTile; py += stride) for (let px = 0; px < W && c < perTile; px += stride) {
      const i = (py * W + px) * 4, l = (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
      if (l < 0.17) continue;
      const p = Math.min(1, (l - 0.12) ** 1.4 * (L >= 7 ? 2.4 : 3.2));
      if (rnd() > p) continue;
      const fx = (px + rnd() * stride) / W, fy = (py + rnd() * stride) / W;
      feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [lonW + (lonE - lonW) * fx, latN + (latS - latN) * fy] }, properties: { g: c % 3, b: Math.min(1, l * 1.15), s: 0.4 + l * 1.1 * (0.6 + rnd() * 0.6) } });
      c++;
    }
  }
  map.getSource('viirs-sparkle')?.setData({ type: 'FeatureCollection', features: feats });
}

// Lumen readout: brightness of the VIIRS pixel under the cursor (any cached tile, finest level first).
function lumenAt(lng, lat) {
  for (let L = 8; L >= 4; L--) {
    const n = 2 ** L, x = (lng + 180) / 360 * n, r = lat * Math.PI / 180, y = (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n;
    const url = gibsTileUrl('VIIRS_Black_Marble', S.epoch === 'nightly' ? '2016-01-01' : S.epoch, L, Math.floor(y), Math.floor(x), 'png');
    const p = tileCache.get(url); if (!p || !p.__img) continue;
    const img = p.__img, px = Math.floor((x % 1) * img.width), py = Math.floor((y % 1) * img.height), i = (py * img.width + px) * 4, d = img.data;
    return Math.max(0, Math.min(100, (((0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255 - 0.045) / 0.85) * 100));
  }
  return null;
}

// ---------- street-lamp twinkle from rendered roads ----------
let lampTimer = 0;
function sampleLamps() {
  if (map.getZoom() < 12 || !S.layers.sparkle || S.offline || !map.getLayer('road-core-minor')) { map.getSource('lamps')?.setData(empty()); return; }
  const feats = map.queryRenderedFeatures({ layers: ['road-core-minor', 'road-core-major'] });
  const out = []; const step = 38 / 111320; let budget = 9000;
  for (const f of feats) {
    const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
    const major = ['motorway', 'trunk', 'primary'].includes(f.properties.class);
    for (const ln of lines) for (let i = 0; i < ln.length - 1 && budget > 0; i++) {
      const [x1, y1] = ln[i], [x2, y2] = ln[i + 1]; const seg = Math.hypot(x2 - x1, y2 - y1); const k = Math.max(1, Math.floor(seg / (major ? step * 0.7 : step)));
      for (let j = 0; j < k && budget > 0; j++, budget--) { const t = (j + rnd() * 0.3) / k; out.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [x1 + (x2 - x1) * t, y1 + (y2 - y1) * t] }, properties: { g: Math.floor(rnd() * 3), b: major ? 0.9 : 0.55 + rnd() * 0.35, s: major ? 0.9 : 0.55 } }); }
    }
  }
  map.getSource('lamps')?.setData({ type: 'FeatureCollection', features: out });
}

// ---------- picking & drawing ----------
let marker = null, draft = [];
export function setAsset(lat, lon, { fly = false, label } = {}) {
  S.asset = { lat, lon, polygon: S.asset?.polygon && S.tool === 'draw' ? S.asset.polygon : null, label: label || S.asset?.label || null };
  if (!marker) { const el = document.createElement('div'); el.className = 'marker-pulse'; marker = new ML.Marker({ element: el }); }
  marker.setLngLat([lon, lat]).addTo(map);
  if (fly) map.flyTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 16), speed: 1.2, pitch: 45 });
  bus.emit('asset', S.asset);
}
export function setParcel(ring) {
  map.getSource('parcel')?.setData(ring ? { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[...ring, ring[0]]] }, properties: {} } : empty());
}
function drawDraft(cursor) {
  const pts = cursor ? [...draft, cursor] : draft;
  const fc = { type: 'FeatureCollection', features: pts.map((p) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: {} })) };
  if (pts.length > 1) fc.features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: pts.length > 2 ? [...pts, pts[0]] : pts }, properties: {} });
  map.getSource('draft').setData(fc);
  if (pts.length > 2) tip(`Parcel ${Math.round(ringArea(pts)).toLocaleString('en-IN')} m² · ${(ringArea(pts) / 4046.86).toFixed(2)} acres · double-click or Enter to finish`);
}
export function finishDraw() {
  if (draft.length < 3) { tip('Add at least 3 corners'); return; }
  const ring = draft.slice(); draft = []; map.getSource('draft').setData(empty());
  const lon = ring.reduce((s, p) => s + p[0], 0) / ring.length, lat = ring.reduce((s, p) => s + p[1], 0) / ring.length;
  S.asset = { lat, lon, polygon: ring, area_sqm: Math.round(ringArea(ring)), label: S.asset?.label };
  setParcel(ring);
  if (!marker) { const el = document.createElement('div'); el.className = 'marker-pulse'; marker = new ML.Marker({ element: el }); }
  marker.setLngLat([lon, lat]).addTo(map);
  setTool(null); bus.emit('asset', S.asset);
}
export function setTool(t) {
  S.tool = t; draft = []; map.getSource('draft')?.setData(empty());
  document.body.classList.toggle('picking', !!t);
  map.getCanvas().style.cursor = t ? 'crosshair' : '';
  if (t === 'draw') { map.doubleClickZoom.disable(); tip('Click each corner of the parcel · double-click or Enter to finish · Esc to cancel'); if (map.getZoom() < 14) toast('Zoom in close and switch on satellite to trace the boundary'); }
  else { map.doubleClickZoom.enable(); }
  if (t === 'pick') tip('Click the exact asset location');
  if (!t) tip('');
  bus.emit('tool', t);
}
export function tip(text) { const el = document.getElementById('hudTip'); el.textContent = text || ''; el.classList.toggle('on', !!text); }
export function toast(text, ms = 2600) { const el = document.getElementById('toast'); el.textContent = text; el.classList.add('on'); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove('on'), ms); }

// ---------- public controls ----------
export function setLayer(key, on) {
  S.layers[key] = on;
  const vis = (ids, v) => ids.forEach((id) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', v ? 'visible' : 'none'));
  const sparkIds = ['spk-glow', ...groupState.map((g) => g.id)];
  if (key === 'sparkle') { vis(sparkIds, on); if (on) sampleViirs(); }
  if (key === 'blackmarble') vis(['bm'], on);
  if (key === 'roads') vis(['road-glow-minor', 'road-core-minor', 'road-glow-major', 'road-core-major', 'rail'], on);
  if (key === 'buildings') vis(['buildings'], on);
  if (key === 'districts') vis(['districts-fill', 'districts-line'], on);
  if (key === 'satellite') { vis(['sat'], on); if (on && !S.offline) map.setPaintProperty('bm', 'raster-opacity', 0.25); else map.setPaintProperty('bm', 'raster-opacity', ['interpolate', ['linear'], ['zoom'], 3, 0.95, 9, 0.75, 12, 0.25]); }
  if (key === 'portfolio') vis(['pf-halo', 'pf'], on);
  if (key === 'watch') vis(['watch'], on);
  for (const k of ['ndvi', 'flood']) if (key === k) {
    if (on && !map.getSource('gibs-' + k)) { map.addSource('gibs-' + k, GIBS_LAYERS[k]()); map.addLayer({ id: 'gibs-' + k, type: 'raster', source: 'gibs-' + k, paint: { 'raster-opacity': 0.7 } }, 'states-line'); }
    vis(['gibs-' + k], on);
  }
  if (key === 's2scene') vis(['s2scene'], on);
}
export function setEpoch(epoch) {
  S.epoch = epoch;
  const src = epoch === 'nightly' ? GIBS_LAYERS.nightly() : GIBS_LAYERS.blackmarble(epoch);
  map.getSource('bm').setTiles(src.tiles);
  sampleViirs();
}
export function toggleGlobe() { S.globe = !S.globe; map.setProjection({ type: S.globe ? 'globe' : 'mercator' }); }
export function showScene(tilejsonUrl) {
  if (!tilejsonUrl) return;
  if (map.getLayer('s2scene')) map.removeLayer('s2scene');
  if (map.getSource('s2scene')) map.removeSource('s2scene');
  map.addSource('s2scene', { type: 'raster', url: tilejsonUrl, tileSize: 256 });
  map.addLayer({ id: 's2scene', type: 'raster', source: 's2scene', minzoom: 10, layout: { visibility: S.layers.s2scene ? 'visible' : 'none' }, paint: { 'raster-opacity': 0.95 } }, 'states-line');
}
export function setPortfolio(rows) {
  map.getSource('portfolio')?.setData({ type: 'FeatureCollection', features: rows.filter((r) => r.lat != null).map((r, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: { i, grade: r.grade || '-', loan: r.loan_amount || 0, ref: r.reference_id || '' } })) });
}
export function setWatch(items) {
  map.getSource('watch')?.setData({ type: 'FeatureCollection', features: items.map((w, i) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [w.asset.lon, w.asset.lat] }, properties: { i, alert: (w.last?.alerts || []).length } })) });
}
export function fitTo(rows) {
  if (!rows.length) return; const b = new ML.LngLatBounds();
  rows.forEach((r) => b.extend([r.lon, r.lat])); map.fitBounds(b, { padding: { top: 80, bottom: 180, left: 120, right: 480 }, maxZoom: 11, duration: 1800 });
}

const TOUR = [
  { c: [72.86, 19.05], z: 10.6, p: 62, b: -20, n: 'Mumbai' }, { c: [73.86, 18.52], z: 11, p: 60, b: 25, n: 'Pune' },
  { c: [77.59, 12.97], z: 10.8, p: 58, b: -35, n: 'Bengaluru' }, { c: [78.48, 17.39], z: 11, p: 60, b: 15, n: 'Hyderabad' },
  { c: [72.57, 23.03], z: 11.2, p: 62, b: -10, n: 'Ahmedabad' }, { c: [77.21, 28.61], z: 10.4, p: 60, b: 30, n: 'Delhi NCR' },
];
let touring = false;
export async function nightFlight() {
  if (touring) { touring = false; return; }
  touring = true; toast('Night flight · press F again to stop');
  for (const s of TOUR) {
    if (!touring) break;
    tip(`✈  ${s.n}`);
    map.flyTo({ center: s.c, zoom: s.z, pitch: s.p, bearing: s.b, speed: 0.5, curve: 1.6, essential: true });
    await new Promise((r) => map.once('moveend', r));
    if (!touring) break;
    map.easeTo({ bearing: s.b + 40, duration: 5200, easing: (t) => t });
    await new Promise((r) => setTimeout(r, 5300));
  }
  touring = false; tip('');
  map.flyTo({ center: [79, 22.5], zoom: 4.2, pitch: 0, bearing: 0, speed: 0.6 });
}

export async function initMap({ offline = false } = {}) {
  map = new ML.Map({ container: 'map', style: style(offline), center: [80, 21], zoom: 1.6, maxPitch: 78, attributionControl: { compact: true }, fadeDuration: 200 });
  map.addControl(new ML.NavigationControl({ visualizePitch: true }), 'bottom-right');
  map.addControl(new ML.ScaleControl({ maxWidth: 110 }), 'bottom-left');
  window.__map = map;
  await new Promise((r) => map.once('load', r));
  const cities = await (await fetch('data/cities_in.json')).json();
  S.cities = cities;
  map.addSource('city-sparkle', { type: 'geojson', data: citySparkle(cities), buffer: 0, maxzoom: 10 });
  map.addSource('viirs-sparkle', { type: 'geojson', data: empty(), buffer: 0 });
  map.addSource('lamps', { type: 'geojson', data: empty(), buffer: 0 });
  map.addSource('parcel', { type: 'geojson', data: empty() });
  map.addSource('draft', { type: 'geojson', data: empty() });
  map.addSource('portfolio', { type: 'geojson', data: empty() });
  map.addSource('watch', { type: 'geojson', data: empty() });
  addSparkleLayers();
  map.addLayer({ id: 'parcel-fill', type: 'fill', source: 'parcel', paint: { 'fill-color': '#5ce1ff', 'fill-opacity': 0.12 } });
  map.addLayer({ id: 'parcel-line', type: 'line', source: 'parcel', paint: { 'line-color': '#5ce1ff', 'line-width': 2.2 } });
  map.addLayer({ id: 'draft-line', type: 'line', source: 'draft', filter: ['==', ['geometry-type'], 'LineString'], paint: { 'line-color': '#ffd98a', 'line-width': 2, 'line-dasharray': [2, 1] } });
  map.addLayer({ id: 'draft-pt', type: 'circle', source: 'draft', filter: ['==', ['geometry-type'], 'Point'], paint: { 'circle-color': '#ffd98a', 'circle-radius': 4.5, 'circle-stroke-color': '#000', 'circle-stroke-width': 1 } });
  const gradeColor = ['match', ['get', 'grade'], 'A', '#3ee08f', 'B', '#a6e36b', 'C', '#ffd166', 'D', '#ff9a3d', 'E', '#ff5470', '#8a97b4'];
  const loanR = ['interpolate', ['linear'], ['sqrt', ['get', 'loan']], 0, 4, 3000, 7, 10000, 13];
  map.addLayer({ id: 'pf-halo', type: 'circle', source: 'portfolio', paint: { 'circle-color': gradeColor, 'circle-radius': ['*', loanR, 2.2], 'circle-opacity': 0.14, 'circle-blur': 0.8 } });
  map.addLayer({ id: 'pf', type: 'circle', source: 'portfolio', paint: { 'circle-color': gradeColor, 'circle-radius': loanR, 'circle-opacity': 0.9, 'circle-stroke-color': '#02040a', 'circle-stroke-width': 1 } });
  map.addLayer({ id: 'watch', type: 'circle', source: 'watch', paint: { 'circle-color': ['case', ['>', ['get', 'alert'], 0], '#ff5470', '#5ce1ff'], 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5, 'circle-opacity': 0.9 } });

  raf = requestAnimationFrame(animate);

  let hovered = null;
  map.on('mousemove', (e) => {
    const { lng, lat } = e.lngLat;
    document.getElementById('hudLL').textContent = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    const lm = lumenAt(lng, lat);
    document.getElementById('hudLum').textContent = lm == null ? 'lumen --' : `lumen ${lm.toFixed(0)}`;
    if (S.tool === 'draw' && draft.length) drawDraft([lng, lat]);
    if (map.getZoom() >= 4.5 && S.layers.districts) {
      const f = map.queryRenderedFeatures(e.point, { layers: ['districts-fill'] })[0];
      const id = f ? f.id ?? f.properties.district : null;
      if (hovered !== null && hovered !== id) map.setFeatureState({ source: 'districts', id: hovered }, { hover: false });
      if (f && f.id != null) { map.setFeatureState({ source: 'districts', id: f.id }, { hover: true }); hovered = f.id; }
    }
  });
  const hud = () => { const z = map.getZoom(); document.getElementById('hudZ').textContent = 'z ' + z.toFixed(1); document.getElementById('hudAlt').textContent = 'alt ' + Math.round(40075 * Math.cos(map.getCenter().lat * Math.PI / 180) / 2 ** z * 1.3).toLocaleString('en-IN') + ' km'; };
  map.on('move', hud); hud();
  map.on('moveend', () => { clearTimeout(sampleTimer); sampleTimer = setTimeout(sampleViirs, 250); clearTimeout(lampTimer); lampTimer = setTimeout(sampleLamps, 350); bus.emit('moveend'); });
  map.on('click', (e) => {
    if (S.tool === 'pick') { setAsset(e.lngLat.lat, e.lngLat.lng); setTool(null); return; }
    if (S.tool === 'draw') { draft.push([e.lngLat.lng, e.lngLat.lat]); drawDraft(); return; }
    const pf = map.queryRenderedFeatures(e.point, { layers: ['pf', 'watch'] })[0];
    if (pf) { bus.emit(pf.layer.id === 'pf' ? 'portfolio:click' : 'watch:click', pf.properties.i); return; }
    const d = map.queryRenderedFeatures(e.point, { layers: ['districts-fill'] })[0];
    if (d && map.getZoom() < 9) new ML.Popup({ closeButton: false }).setLngLat(e.lngLat).setHTML(`<b>${d.properties.district}</b><br><span style="color:#8a97b4">${d.properties.state}</span><br><small>Click Pin or Parcel to pick an asset</small>`).addTo(map);
  });
  map.on('dblclick', (e) => { if (S.tool === 'draw') { e.preventDefault(); finishDraw(); } });
  map.on('error', (e) => { const m = String(e?.error?.message || ''); if (/ofm|openfreemap/i.test(m) || e?.sourceId === 'ofm') bus.emit('basemap:error'); });
  ['pf', 'watch'].forEach((l) => { map.on('mouseenter', l, () => (map.getCanvas().style.cursor = 'pointer')); map.on('mouseleave', l, () => (map.getCanvas().style.cursor = S.tool ? 'crosshair' : '')); });
  // keep district ids for hover state
  map.getSource('districts').setData(await (await fetch('data/india_districts.geojson')).json().then((fc) => { fc.features.forEach((f, i) => (f.id = i)); S.districtsFC = fc; return fc; }));
  return map;
}
