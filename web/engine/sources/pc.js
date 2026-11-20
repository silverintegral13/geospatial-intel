// Microsoft Planetary Computer: Sentinel-2 L2A (NDVI history + latest scene), ESA WorldCover,
// Impact Observatory annual land use 2017-2023, JRC Global Surface Water. Public STAC + data API.
import { getJSON, pool, round, isoDate, daysAgo, bboxAround, mean, quantile } from '../util.js';

export const PC_STAC = 'https://planetarycomputer.microsoft.com/api/stac/v1';
export const PC_DATA = 'https://planetarycomputer.microsoft.com/api/data/v1';

async function search(ctx, body) {
  return getJSON(ctx.fetch, `${PC_STAC}/search`, {
    timeout: 20000,
    init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
  });
}

const flat = (v) => (Array.isArray(v) ? v.flatMap(flat) : [v]);

async function point(ctx, collection, item, assets, lon = ctx.lon, lat = ctx.lat) {
  const qs = `collection=${collection}&item=${encodeURIComponent(item)}&` + assets.map((a) => `assets=${a}`).join('&');
  const j = await getJSON(ctx.fetch, `${PC_DATA}/item/point/${lon},${lat}?${qs}`, { timeout: 15000, retries: 1 });
  return flat(j.values).map((x) => (x == null ? null : +x));
}

const CLOUDY_SCL = new Set([0, 1, 3, 8, 9, 10]);

export async function sentinel2(ctx) {
  const end = new Date(), start = daysAgo(400, end);
  const fc = await search(ctx, {
    collections: ['sentinel-2-l2a'],
    intersects: { type: 'Point', coordinates: [ctx.lon, ctx.lat] },
    datetime: `${isoDate(start)}T00:00:00Z/${isoDate(end)}T23:59:59Z`,
    query: { 'eo:cloud_cover': { lt: 35 } },
    sortby: [{ field: 'datetime', direction: 'desc' }],
    limit: 80,
  });
  const items = (fc.features || []).map((f) => ({
    id: f.id, date: (f.properties.datetime || '').slice(0, 10), cloud: f.properties['eo:cloud_cover'],
    baseline: parseFloat(f.properties['s2:processing_baseline'] || '0'),
  }));
  if (!items.length) throw new Error('no clear Sentinel-2 scenes in the last 13 months');
  const latest = items.reduce((b, x) => (x.date > b.date || (x.date === b.date && x.cloud < b.cloud) ? x : b), items[0]);
  const clearest = [...items].sort((a, b) => a.cloud - b.cloud || (a.date < b.date ? 1 : -1))[0];
  // One scene per month (least cloudy), newest first, at most 10.
  const byMonth = new Map();
  for (const it of items) { const m = it.date.slice(0, 7); if (!byMonth.has(m) || it.cloud < byMonth.get(m).cloud) byMonth.set(m, it); }
  const picks = [...byMonth.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, ctx.opts?.ndviScenes ?? 10);
  const vals = await pool(picks, 4, async (it) => {
    const [b4, b8, scl] = await point(ctx, 'sentinel-2-l2a', it.id, ['B04', 'B08', 'SCL']);
    if (b4 == null || b8 == null) return null;
    const off = it.baseline >= 4 ? 1000 : 0; // processing baseline >= 04.00 adds a +1000 DN offset
    const r = Math.max(0, b4 - off), n = Math.max(0, b8 - off);
    const ndvi = n + r > 0 ? (n - r) / (n + r) : null;
    return { date: it.date, ndvi: round(ndvi, 3), scl, valid: scl == null || !CLOUDY_SCL.has(scl), cloud: round(it.cloud, 1) };
  });
  const series = vals.filter((v) => v && !v.error && v.ndvi != null).sort((a, b) => (a.date < b.date ? -1 : 1));
  const good = series.filter((v) => v.valid).map((v) => v.ndvi);
  const latestValid = [...series].reverse().find((v) => v.valid) || null;
  return {
    scenes_13m: items.length,
    latest_scene: { id: latest.id, date: latest.date, cloud: round(latest.cloud, 1) },
    clearest_scene: { id: clearest.id, date: clearest.date, cloud: round(clearest.cloud, 1) },
    ndvi_series: series,
    ndvi_latest: latestValid ? latestValid.ndvi : null,
    ndvi_latest_date: latestValid ? latestValid.date : null,
    ndvi_max: good.length ? round(Math.max(...good), 3) : null,
    ndvi_min: good.length ? round(Math.min(...good), 3) : null,
    ndvi_median: round(quantile(good, 0.5), 3),
    ndvi_amplitude: good.length > 2 ? round(quantile(good, 0.9) - quantile(good, 0.1), 3) : null,
    ndvi_valid_obs: good.length,
    imagery: sceneImagery(ctx, clearest.id),
  };
}

export function sceneImagery(ctx, itemId, halfM) {
  const h = halfM || ctx.opts?.clipHalfM || 350;
  const [w, s, e, n] = bboxAround(ctx.lat, ctx.lon, h).map((v) => v.toFixed(6));
  const base = `collection=sentinel-2-l2a&item=${encodeURIComponent(itemId)}`;
  const rgb = `${base}&assets=visual&asset_bidx=visual%7C1%2C2%2C3&nodata=0`;
  const ndvi = `${base}&assets=B04&assets=B08&asset_as_band=true&expression=(B08-B04)%2F(B08%2BB04)&rescale=-0.1,0.8&colormap_name=rdylgn`;
  return {
    bbox: [+w, +s, +e, +n],
    rgb: [`${PC_DATA}/item/bbox/${w},${s},${e},${n}/512x512.png?${rgb}`, `${PC_DATA}/item/crop/${w},${s},${e},${n}/512x512.png?${rgb}`],
    ndvi: [`${PC_DATA}/item/bbox/${w},${s},${e},${n}/512x512.png?${ndvi}`, `${PC_DATA}/item/crop/${w},${s},${e},${n}/512x512.png?${ndvi}`],
    tilejson: `${PC_DATA}/item/tilejson.json?${rgb}&format=png`,
  };
}

export const WORLDCOVER = { 10: 'Tree cover', 20: 'Shrubland', 30: 'Grassland', 40: 'Cropland', 50: 'Built-up', 60: 'Bare / sparse', 70: 'Snow and ice', 80: 'Water', 90: 'Wetland', 95: 'Mangroves', 100: 'Moss and lichen' };
export const IO_LULC = { 1: 'Water', 2: 'Trees', 4: 'Flooded vegetation', 5: 'Crops', 7: 'Built area', 8: 'Bare ground', 9: 'Snow/ice', 10: 'Clouds', 11: 'Rangeland' };

export async function landcover(ctx) {
  const [wc, io] = await Promise.all([
    search(ctx, { collections: ['esa-worldcover'], intersects: { type: 'Point', coordinates: [ctx.lon, ctx.lat] }, limit: 5 }).catch(() => null),
    search(ctx, { collections: ['io-lulc-annual-v02'], intersects: { type: 'Point', coordinates: [ctx.lon, ctx.lat] }, limit: 20 }).catch(() => null),
  ]);
  const out = { worldcover_class: null, worldcover_label: null, worldcover_year: null, lulc_by_year: [], lulc_latest: null, lulc_changed: null };
  const wcItems = (wc?.features || []).sort((a, b) => (a.properties.datetime < b.properties.datetime ? 1 : -1));
  if (wcItems[0]) {
    const [v] = await point(ctx, 'esa-worldcover', wcItems[0].id, ['map']).catch(() => [null]);
    if (v != null) { out.worldcover_class = v; out.worldcover_label = WORLDCOVER[v] || `class ${v}`; out.worldcover_year = (wcItems[0].properties.datetime || wcItems[0].properties.start_datetime || '').slice(0, 4); }
  }
  const ioItems = (io?.features || []).map((f) => ({ id: f.id, year: (f.properties.start_datetime || f.properties.datetime || '').slice(0, 4) }))
    .sort((a, b) => (a.year < b.year ? -1 : 1));
  const yrs = await pool(ioItems, 4, async (it) => { const [v] = await point(ctx, 'io-lulc-annual-v02', it.id, ['data']); return { year: it.year, cls: v, label: IO_LULC[v] || null }; });
  out.lulc_by_year = yrs.filter((y) => y && !y.error && y.cls);
  if (out.lulc_by_year.length) {
    const first = out.lulc_by_year[0], last = out.lulc_by_year[out.lulc_by_year.length - 1];
    out.lulc_latest = last.label; out.lulc_first = first.label; out.lulc_first_year = first.year; out.lulc_latest_year = last.year;
    out.lulc_changed = first.cls !== last.cls;
    out.lulc_converted_to_built = first.cls !== 7 && last.cls === 7;
  }
  if (out.worldcover_class == null && !out.lulc_by_year.length) throw new Error('land-cover rasters unavailable');
  return out;
}

export async function surfaceWater(ctx) {
  const fc = await search(ctx, { collections: ['jrc-gsw'], intersects: { type: 'Point', coordinates: [ctx.lon, ctx.lat] }, limit: 2 });
  const it = fc.features?.[0];
  if (!it) throw new Error('no JRC tile');
  // Sample the asset and a 9-point stencil (~250 m) to catch water right next to the parcel.
  const pts = [[0, 0], [250, 0], [-250, 0], [0, 250], [0, -250], [180, 180], [-180, 180], [180, -180], [-180, -180]];
  const t = Math.PI / 180;
  const vals = await pool(pts, 3, async ([dn, de]) => {
    const lat = ctx.lat + dn / 111320, lon = ctx.lon + de / (111320 * Math.cos(ctx.lat * t));
    const [occ, seas] = await point(ctx, 'jrc-gsw', it.id, ['occurrence', 'seasonality'], lon, lat);
    return { occ: occ > 100 ? 0 : occ ?? 0, seas: seas > 12 ? 0 : seas ?? 0 };
  });
  const ok = vals.filter((v) => v && !v.error);
  return {
    water_occurrence_pct: ok[0] ? ok[0].occ : null,
    water_occurrence_250m_max: ok.length ? Math.max(...ok.map((v) => v.occ)) : null,
    water_seasonality_months: ok[0] ? ok[0].seas : null,
    water_cells_nearby: ok.filter((v) => v.occ > 10).length,
  };
}

// Recent-month NDVI anomaly for Pulse (latest valid vs same-season median of the series).
export function ndviAnomaly(series) {
  if (!series || series.length < 4) return null;
  const last = series[series.length - 1];
  const others = series.slice(0, -1).map((s) => s.ndvi);
  return round(last.ndvi - mean(others), 3);
}
