// Point-in-polygon district lookup over a GeoJSON FeatureCollection (properties: district, state).
export function makeDistrictLookup(fc) {
  const feats = (fc.features || []).map((f) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let w = 180, s = 90, e = -180, n = -90;
    for (const p of polys) for (const [x, y] of p[0]) { if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
    return { p: f.properties, polys, bb: [w, s, e, n] };
  });
  const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  return (lat, lon) => {
    for (const f of feats) {
      if (lon < f.bb[0] || lon > f.bb[2] || lat < f.bb[1] || lat > f.bb[3]) continue;
      for (const poly of f.polys) if (inRing(lon, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lon, lat, h))) return { district: f.p.district, state: f.p.state };
    }
    return null;
  };
}
