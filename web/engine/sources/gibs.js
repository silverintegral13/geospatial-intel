// NASA GIBS: VIIRS night lights (Black Marble) sampled straight from the public WMTS tiles.
// The index is the rendered luminance of the tile (0-100), a proxy for radiance rather than radiance itself.
import { getJSON, lonLatToTilePixel, metresPerPixel, round } from '../util.js';

export const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
export const gibsTileUrl = (layer, time, z, y, x, ext = 'png', matrix = 'GoogleMapsCompatible_Level8') =>
  `${GIBS}/${layer}/default/${time}/${matrix}/${z}/${y}/${x}.${ext}`;

export const LIGHT_EPOCHS = [
  { key: 'bm2016', label: 'VIIRS Black Marble 2016', layer: 'VIIRS_Black_Marble', time: '2016-01-01', ext: 'png' },
  { key: 'bm2012', label: 'VIIRS Black Marble 2012', layer: 'VIIRS_Black_Marble', time: '2012-01-01', ext: 'png', fallback: { layer: 'VIIRS_CityLights_2012', time: 'default', ext: 'jpg' } },
];

async function tile(ctx, layer, time, ext, z, y, x) {
  const url = gibsTileUrl(layer, time, z, y, x, ext);
  ctx.cache ||= new Map();
  if (!ctx.cache.has(url)) {
    ctx.cache.set(url, (async () => {
      const buf = await getJSON(ctx.fetch, url, { as: 'buffer', timeout: 15000 });
      return ctx.decodeImage(buf);
    })());
  }
  try { return await ctx.cache.get(url); } catch (e) { ctx.cache.delete(url); throw e; }
}

const lum = (d, i) => (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
const toIndex = (l) => Math.max(0, Math.min(100, ((l - 0.045) / 0.85) * 100));

function sample(img, px, py, r) {
  let s = 0, n = 0, mx = 0, lit = 0;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (dx * dx + dy * dy > r * r) continue;
    const x = px + dx, y = py + dy;
    if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
    const v = toIndex(lum(img.data, (y * img.width + x) * 4));
    s += v; n++; mx = Math.max(mx, v); if (v > 12) lit++;
  }
  return { mean: n ? s / n : null, max: mx, litShare: n ? lit / n : null };
}

export async function nightLightsAt(ctx, lat, lon, epoch) {
  const z = 8; const t = lonLatToTilePixel(lat, lon, z);
  let img;
  try { img = await tile(ctx, epoch.layer, epoch.time, epoch.ext, z, t.ty, t.tx); }
  catch (e) { if (!epoch.fallback) throw e; img = await tile(ctx, epoch.fallback.layer, epoch.fallback.time, epoch.fallback.ext, z, t.ty, t.tx); }
  const mpp = metresPerPixel(lat, z);
  const rLocal = Math.max(1, Math.round(1500 / mpp)), rArea = Math.max(2, Math.round(8000 / mpp));
  const p = sample(img, t.px, t.py, 1), l = sample(img, t.px, t.py, rLocal), a = sample(img, t.px, t.py, rArea);
  return { point: p.mean, local: l.mean, area: a.mean, area_max: a.max, lit_share_area: a.litShare };
}

export async function nightLights(ctx) {
  const [now, then] = await Promise.all(LIGHT_EPOCHS.map((e) => nightLightsAt(ctx, ctx.lat, ctx.lon, e).catch(() => null)));
  if (!now) throw new Error('night-light tiles unavailable');
  const growth = then && then.local > 1 ? (now.local - then.local) / then.local : null;
  return {
    light_index_point: round(now.point, 1),
    light_index_local: round(now.local, 1),
    light_index_area: round(now.area, 1),
    light_index_area_max: round(now.area_max, 1),
    lit_share_area: round(now.lit_share_area, 2),
    light_index_local_2012: then ? round(then.local, 1) : null,
    light_growth_2012_2016: growth == null ? null : round(growth, 2),
    epoch: 'VIIRS Black Marble 2016 (vs 2012)',
  };
}
