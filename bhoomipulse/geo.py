"""Geometry helpers: distances to real anchors, H3 grid, boundary loading.

Everything in this module is computed from real boundary files and from
approximate, publicly known anchor coordinates. Nothing here is synthetic.
"""
from __future__ import annotations

import geopandas as gpd
import h3
import numpy as np
import pandas as pd
from pyproj import Transformer
from shapely.geometry import LineString, Point, Polygon, mapping

from .config import CFG, DEMO

UTM = 32643  # WGS84 / UTM 43N: metres, adequate for Gujarat
_TO_UTM = Transformer.from_crs(4326, UTM, always_xy=True)

# Approximate city-centre coordinates (public knowledge, not surveyed).
CITIES = {
    "Ahmedabad": (23.0225, 72.5714), "Surat": (21.1702, 72.8311),
    "Vadodara": (22.3072, 73.1812), "Rajkot": (22.3039, 70.8022),
    "Gandhinagar": (23.2156, 72.6369), "Bhavnagar": (21.7645, 72.1519),
    "Jamnagar": (22.4707, 70.0577), "Junagadh": (21.5222, 70.4579),
    "Bhuj": (23.2420, 69.6669), "Mehsana": (23.5880, 72.3693),
}
SANAND_TOWN = (22.9957, 72.3759)   # representative point of the Sanand town polygon
# Centre of the villages that host the Sanand GIDC estates (Bol, Hirapur, Charal, Shiyawada).
SANAND_GIDC = (22.9806, 72.2514)
# Rough trace of the Sarkhej-Sanand-Viramgam highway (three hand-placed points).
HIGHWAY = [(22.99, 72.50), (22.9957, 72.3759), (23.12, 72.04)]


def to_xy_km(lat, lon) -> tuple[np.ndarray, np.ndarray]:
    x, y = _TO_UTM.transform(np.asarray(lon, float), np.asarray(lat, float))
    return np.asarray(x) / 1000.0, np.asarray(y) / 1000.0


def dist_km(lat, lon, anchor: tuple[float, float]) -> np.ndarray:
    x, y = to_xy_km(lat, lon)
    ax, ay = to_xy_km(anchor[0], anchor[1])
    return np.hypot(x - ax, y - ay)


def dist_nearest_city_km(lat, lon) -> np.ndarray:
    return np.min([dist_km(lat, lon, c) for c in CITIES.values()], axis=0)


def dist_highway_km(lat, lon) -> np.ndarray:
    hx, hy = to_xy_km([p[0] for p in HIGHWAY], [p[1] for p in HIGHWAY])
    line = LineString(list(zip(hx, hy)))
    x, y = to_xy_km(lat, lon)
    return np.array([line.distance(Point(a, b)) for a, b in zip(np.atleast_1d(x), np.atleast_1d(y))])


def geometry_features(lat, lon) -> pd.DataFrame:
    """Real, geometry-derived features for any points in Gujarat."""
    lat, lon = np.atleast_1d(lat).astype(float), np.atleast_1d(lon).astype(float)
    return pd.DataFrame({
        "dist_major_city_km": dist_nearest_city_km(lat, lon),
        "dist_ahmedabad_km": dist_km(lat, lon, CITIES["Ahmedabad"]),
        "dist_sanand_town_km": dist_km(lat, lon, SANAND_TOWN),
        "dist_gidc_km": dist_km(lat, lon, SANAND_GIDC),
        "dist_highway_km": dist_highway_km(lat, lon),
    })


# ---------------------------------------------------------------- boundaries
def load_districts() -> gpd.GeoDataFrame:
    return gpd.read_file(DEMO / "districts.geojson")


def load_villages() -> gpd.GeoDataFrame:
    return gpd.read_file(DEMO / "villages_sanand.geojson")


def h3_grid(villages: gpd.GeoDataFrame, res: int | None = None) -> gpd.GeoDataFrame:
    """H3 cells whose centre falls inside the taluka, tagged with their village."""
    res = res or CFG["h3_resolution"]
    union = villages.geometry.union_all()
    polys = list(union.geoms) if union.geom_type == "MultiPolygon" else [union]
    cells: set[str] = set()
    for p in polys:
        cells |= set(h3.geo_to_cells(mapping(p), res))
    cells = sorted(cells)
    latlon = np.array([h3.cell_to_latlng(c) for c in cells])
    geoms = [Polygon([(lo, la) for la, lo in h3.cell_to_boundary(c)]) for c in cells]
    g = gpd.GeoDataFrame({"h3": cells, "lat": latlon[:, 0], "lon": latlon[:, 1]}, geometry=geoms, crs=4326)
    pts = gpd.GeoDataFrame(g[["h3"]], geometry=gpd.points_from_xy(g.lon, g.lat), crs=4326)
    j = gpd.sjoin(pts, villages[["village_id", "village", "geometry"]], how="left", predicate="within")
    j = j.drop_duplicates("h3").set_index("h3")
    g["village_id"] = g.h3.map(j.village_id)
    g["village"] = g.h3.map(j.village)
    return g.dropna(subset=["village_id"]).reset_index(drop=True)


def square(lat: float, lon: float, area_sqm: float) -> Polygon:
    """Axis-aligned square of a given area centred on a point (placeholder parcel)."""
    half = np.sqrt(area_sqm) / 2
    x, y = _TO_UTM.transform(lon, lat)
    back = Transformer.from_crs(UTM, 4326, always_xy=True)
    corners = [(x - half, y - half), (x + half, y - half), (x + half, y + half), (x - half, y + half)]
    return Polygon([back.transform(a, b) for a, b in corners])


def area_sqm(geom) -> float:
    return float(gpd.GeoSeries([geom], crs=4326).to_crs(UTM).area.iloc[0])
