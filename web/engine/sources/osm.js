// OpenStreetMap: Nominatim reverse geocoding + Overpass context (roads, amenities, buildings, rail, land use, water).
import { getJSON, haversine, distToLine, round } from '../util.js';

export const NOMINATIM = 'https://nominatim.openstreetmap.org';
// Public Overpass instances. The main one (overpass-api.de) is heavily shared and often answers
// 502/504 when overloaded, so we keep several mirrors and remember whichever answered last.
export const OVERPASS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
let preferredMirror = 0;

export async function reverseGeocode(ctx) {
  const { lat, lon } = ctx;
  const url = `${NOMINATIM}/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18&addressdetails=1&accept-language=en`;
  const j = await getJSON(ctx.fetch, url, { timeout: 10000, init: ctx.uaHeaders ? { headers: ctx.uaHeaders } : {} });
  const a = j.address || {};
  return {
    display_name: j.display_name || null,
    locality: a.village || a.hamlet || a.suburb || a.neighbourhood || a.town || a.city || null,
    city: a.city || a.town || a.municipality || null,
    district: (a.state_district || a.county || '').replace(/ District$/i, '') || null,
    state: a.state || null,
    postcode: a.postcode || null,
    osm_class: j.category || j.class || null,
    osm_type: j.type || null,
  };
}

const MAJOR = { motorway: 1, trunk: 1, primary: 2, secondary: 3, tertiary: 4 };

export function overpassQuery(lat, lon) {
  return `[out:json][timeout:25];
way(around:3000,${lat},${lon})["highway"~"^(motorway|trunk|primary|secondary|tertiary)$"]->.r;
.r out tags geom qt 120;
way(around:250,${lat},${lon})["highway"]->.loc;
.loc out tags geom qt 40;
nwr(around:1500,${lat},${lon})["amenity"~"^(school|college|university|hospital|clinic|doctors|bank|atm|marketplace|pharmacy|police|fuel|bus_station)$"];
out tags center qt 300;
nwr(around:6000,${lat},${lon})["railway"~"^(station|halt)$"];
out tags center qt 15;
nwr(around:2000,${lat},${lon})["landuse"~"^(industrial|commercial|retail|residential|farmland|orchard|quarry|construction|brownfield|greenfield)$"];
out tags center qt 80;
nwr(around:2500,${lat},${lon})["waterway"~"^(river|canal|stream)$"];
out tags geom qt 40;
nwr(around:2500,${lat},${lon})["natural"="water"];
out tags center qt 30;
is_in(${lat},${lon})->.a;
way(pivot.a)["landuse"];
out tags;
rel(pivot.a)["landuse"];
out tags;
way(around:500,${lat},${lon})["building"];
out count;
way(around:1500,${lat},${lon})["building"];
out count;`;
}

function geomPts(el) {
  if (el.geometry) return el.geometry.map((g) => ({ lat: g.lat, lon: g.lon }));
  if (el.center) return [{ lat: el.center.lat, lon: el.center.lon }];
  if (el.lat != null) return [{ lat: el.lat, lon: el.lon }];
  return [];
}

export function parseOverpass(j, lat, lon) {
  const out = {
    nearest_major_road_m: null, nearest_major_road_class: null, nearest_major_road_name: null,
    major_roads_3km: 0, local_road_within_250m: false, frontage_road_class: null,
    amenities_1500m: 0, amenity_mix: {}, nearest_rail_station_m: null, rail_station_name: null,
    landuse_at_point: null, landuse_nearby: {}, nearest_water_m: null, nearest_water_kind: null,
    buildings_500m: null, buildings_1500m: null,
  };
  const counts = [];
  let bestRoad = Infinity;
  for (const el of j.elements || []) {
    if (el.type === 'count') { counts.push(+((el.tags && (el.tags.ways ?? el.tags.total)) || 0)); continue; }
    const t = el.tags || {};
    const pts = geomPts(el);
    if (t.highway) {
      const d = distToLine(lat, lon, pts);
      if (MAJOR[t.highway] && el.geometry && el.geometry.length > 1 && d <= 3000) {
        out.major_roads_3km++;
        // Rank by distance but give arterial classes a small advantage when nearly tied.
        if (d < bestRoad) { bestRoad = d; out.nearest_major_road_class = t.highway; out.nearest_major_road_name = t.name || t.ref || null; }
      }
      if (d <= 250) {
        out.local_road_within_250m = true;
        if (!out.frontage_road_class || (MAJOR[t.highway] || 9) < (MAJOR[out.frontage_road_class] || 9)) out.frontage_road_class = t.highway;
      }
      continue;
    }
    if (t.amenity) { out.amenities_1500m++; out.amenity_mix[t.amenity] = (out.amenity_mix[t.amenity] || 0) + 1; continue; }
    if (t.railway) {
      const d = pts.length ? haversine(lat, lon, pts[0].lat, pts[0].lon) : Infinity;
      if (out.nearest_rail_station_m == null || d < out.nearest_rail_station_m) { out.nearest_rail_station_m = d; out.rail_station_name = t.name || null; }
      continue;
    }
    if (t.waterway || t.natural === 'water') {
      const d = distToLine(lat, lon, pts);
      if (Number.isFinite(d) && (out.nearest_water_m == null || d < out.nearest_water_m)) { out.nearest_water_m = d; out.nearest_water_kind = t.waterway || t.water || 'water body'; }
      continue;
    }
    if (t.landuse) {
      if (!el.center && !el.geometry) { if (!out.landuse_at_point) out.landuse_at_point = t.landuse; }
      else out.landuse_nearby[t.landuse] = (out.landuse_nearby[t.landuse] || 0) + 1;
    }
  }
  if (Number.isFinite(bestRoad)) out.nearest_major_road_m = round(bestRoad);
  if (out.nearest_rail_station_m != null) out.nearest_rail_station_m = round(out.nearest_rail_station_m);
  if (out.nearest_water_m != null) out.nearest_water_m = round(out.nearest_water_m);
  out.buildings_500m = counts[0] ?? null;
  out.buildings_1500m = counts[1] ?? null;
  return out;
}

export async function overpassContext(ctx) {
  // Hedged failover: start with the mirror that worked last; if it errors (e.g. 502) move on at once,
  // and if it is merely slow, start the next mirror after 6 s and take whichever answers first.
  const list = ctx.opts?.overpass || OVERPASS;
  const start = Math.min(preferredMirror, list.length - 1);
  const order = [...list.slice(start), ...list.slice(0, start)];
  const q = overpassQuery(ctx.lat, ctx.lon);
  const init = { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) };
  return new Promise((resolve, reject) => {
    let next = 0, running = 0, done = false; const errs = []; let lastStatus;
    const launch = () => {
      if (done || next >= order.length) return;
      const ep = order[next++]; running++;
      const hedge = setTimeout(launch, ctx.opts?.overpassHedgeMs ?? 6000);
      getJSON(ctx.fetch, ep, { timeout: 25000, retries: 0, init })
        .then((j) => {
          clearTimeout(hedge); running--;
          if (done) return;
          done = true; preferredMirror = Math.max(0, list.indexOf(ep));
          try { const r = parseOverpass(j, ctx.lat, ctx.lon); r._endpoint = ep; r._failed_mirrors = errs.slice(); resolve(r); } catch (e) { reject(e); }
        })
        .catch((e) => {
          clearTimeout(hedge); running--; lastStatus = e.status ?? lastStatus;
          errs.push(`${new URL(ep).host}: ${e.status ? 'HTTP ' + e.status : e.name === 'AbortError' ? 'timeout' : e.message}`);
          if (done) return;
          if (next < order.length) launch();
          else if (running === 0) { const err = new Error(`all ${order.length} Overpass mirrors failed (${errs.join('; ')})`); err.status = lastStatus; reject(err); }
        });
    };
    launch();
  });
}
