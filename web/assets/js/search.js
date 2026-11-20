// Search: coordinates, PIN codes, local city/district index (instant), Photon autocomplete, Nominatim fallback.
import { S } from './state.js';
import { map, setAsset, toast } from './map.js';

const box = () => document.getElementById('searchResults');
const input = () => document.getElementById('searchInput');
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
let items = [], sel = -1, timer = 0, gen = 0;

function parseCoords(q) {
  const m = q.match(/^\s*(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)\s*$/);
  if (!m) return null; const lat = +m[1], lon = +m[2];
  return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { lat, lon } : null;
}
function local(q) {
  const n = norm(q); if (n.length < 2) return [];
  const out = [];
  for (const [lon, lat, pop, name] of S.cities) { if (norm(name).startsWith(n)) { out.push({ kind: 'CITY', name, sub: `${pop.toLocaleString('en-IN')} people · GeoNames`, lat, lon, zoom: pop > 1e6 ? 10.5 : pop > 1e5 ? 12 : 13.5 }); if (out.length >= 4) break; } }
  if (S.districtsFC) for (const f of S.districtsFC.features) { if (norm(f.properties.district).startsWith(n)) { const bb = bbox(f.geometry); out.push({ kind: 'DIST', name: f.properties.district + ' district', sub: f.properties.state, bbox: bb, lat: (bb[1] + bb[3]) / 2, lon: (bb[0] + bb[2]) / 2 }); if (out.length >= 7) break; } }
  return out;
}
function bbox(g) { let w = 180, s = 90, e = -180, n = -90; const walk = (c) => (typeof c[0] === 'number' ? (w = Math.min(w, c[0]), e = Math.max(e, c[0]), s = Math.min(s, c[1]), n = Math.max(n, c[1])) : c.forEach(walk)); walk(g.coordinates); return [w, s, e, n]; }

async function remote(q, g) {
  if (S.offline) return [];
  const c = map.getCenter();
  try {
    const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(q)}&limit=7&lat=${c.lat.toFixed(3)}&lon=${c.lng.toFixed(3)}&bbox=68,6,98,37.5`);
    const j = await r.json(); if (g !== gen) return null;
    return (j.features || []).filter((f) => !f.properties.countrycode || f.properties.countrycode === 'IN').map((f) => {
      const p = f.properties; const [lon, lat] = f.geometry.coordinates;
      const kind = ['house', 'street'].includes(p.type) ? 'ADDR' : ['city', 'town'].includes(p.type) ? 'CITY' : p.osm_key === 'place' ? 'AREA' : 'POI';
      return { kind, name: [p.housenumber, p.name || p.street].filter(Boolean).join(' '), sub: [p.street && p.name ? p.street : null, p.district || p.locality, p.city || p.county, p.state, p.postcode].filter(Boolean).join(', '), lat, lon, zoom: kind === 'CITY' ? 11.5 : kind === 'AREA' ? 14 : 17, bbox: p.extent ? [p.extent[0], p.extent[3], p.extent[2], p.extent[1]] : null };
    });
  } catch {
    try {
      const j = await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=in&limit=7&q=${encodeURIComponent(q)}`)).json();
      if (g !== gen) return null;
      return j.map((x) => ({ kind: x.addresstype === 'city' ? 'CITY' : 'ADDR', name: x.name || x.display_name.split(',')[0], sub: x.display_name.split(',').slice(1, 4).join(','), lat: +x.lat, lon: +x.lon, zoom: 16, bbox: x.boundingbox ? [+x.boundingbox[2], +x.boundingbox[0], +x.boundingbox[3], +x.boundingbox[1]] : null }));
    } catch { return []; }
  }
}
async function pin(q, g) {
  try {
    const j = await (await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=in&postalcode=${q}&limit=3`)).json();
    if (g !== gen) return null;
    return j.map((x) => ({ kind: 'PIN', name: `PIN ${q}`, sub: x.display_name, lat: +x.lat, lon: +x.lon, zoom: 13.5 }));
  } catch { return []; }
}
function render() {
  const el = box();
  if (!items.length) { el.classList.remove('open'); return; }
  el.innerHTML = items.map((it, i) => `<div class="sr${i === sel ? ' on' : ''}" data-i="${i}" role="option"><span class="ic">${it.kind}</span><div><b>${esc(it.name)}</b><small>${esc(it.sub || '')}</small></div></div>`).join('');
  el.classList.add('open');
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function choose(it) {
  box().classList.remove('open'); input().blur();
  if (it.bbox && it.kind !== 'ADDR') map.fitBounds([[it.bbox[0], it.bbox[1]], [it.bbox[2], it.bbox[3]]], { padding: 80, maxZoom: it.zoom || 14, duration: 2200 });
  else map.flyTo({ center: [it.lon, it.lat], zoom: it.zoom || 15, speed: 1.1, curve: 1.5, pitch: (it.zoom || 15) > 14 ? 45 : 20 });
  if (it.kind === 'ADDR' || it.kind === 'POI' || it.kind === 'COORD') { setAsset(it.lat, it.lon, { label: it.name }); toast('Pin dropped · drag the map or use Pin to refine the exact asset'); }
  else toast('Zoom in and use Pin (P) or Parcel (B) to select the asset');
}

export function initSearch() {
  const inp = input();
  inp.addEventListener('input', () => {
    const q = inp.value.trim(); clearTimeout(timer); const g = ++gen;
    const c = parseCoords(q);
    if (c) { items = [{ kind: 'COORD', name: `${c.lat}, ${c.lon}`, sub: 'Go to coordinates and pin the asset', ...c, zoom: 17 }]; sel = 0; render(); return; }
    items = local(q); sel = items.length ? 0 : -1; render();
    if (q.length < 3) return;
    timer = setTimeout(async () => {
      const extra = /^\d{6}$/.test(q) ? await pin(q, g) : await remote(q, g);
      if (extra === null || g !== gen) return;
      items = [...local(q), ...extra].slice(0, 12); if (sel < 0 && items.length) sel = 0; render();
    }, 260);
  });
  inp.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { sel = Math.min(items.length - 1, sel + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter' && items[sel]) choose(items[sel]);
    else if (e.key === 'Escape') { box().classList.remove('open'); inp.blur(); }
  });
  box().addEventListener('mousedown', (e) => { const r = e.target.closest('.sr'); if (r) { e.preventDefault(); choose(items[+r.dataset.i]); } });
  inp.addEventListener('blur', () => setTimeout(() => box().classList.remove('open'), 150));
  inp.addEventListener('focus', () => items.length && render());
}
export const searchLocal = local;
