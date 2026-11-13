"""LIVE fetchers through Google Earth Engine (needs GEE_PROJECT and earthengine-api).

NOT exercised in the build environment (host unreachable, no project id).
Each function returns (static_df, monthly_df) keyed by H3 cell.
"""
from __future__ import annotations

import os

import pandas as pd

from ..config import CFG

_ready = False


def _ee():
    global _ready
    import ee

    if not _ready:
        project = os.environ.get("GEE_PROJECT")
        if not project:
            raise RuntimeError("GEE_PROJECT not set")
        ee.Initialize(project=project)
        _ready = True
    return ee


def _fc(grid):
    ee = _ee()
    return ee.FeatureCollection([ee.Feature(ee.Geometry.Polygon([list(g.exterior.coords)]), {"h3": h})
                                 for h, g in zip(grid.h3, grid.geometry)])


def _reduce(image, grid, scale: int) -> pd.DataFrame:
    """Mean of every band per H3 cell, fetched in chunks of 500 cells."""
    ee = _ee()
    out = []
    for i in range(0, len(grid), 500):
        fc = image.reduceRegions(_fc(grid.iloc[i:i + 500]), ee.Reducer.mean(), scale)
        out += [f["properties"] for f in fc.getInfo()["features"]]
    return pd.DataFrame(out)


def _years(end_offset: int = 0):
    end = pd.Timestamp(CFG["as_of"]).year - end_offset
    return end - 3, end


def night_lights(grid):
    ee = _ee()
    end = pd.Timestamp(CFG["as_of"])
    start = end - pd.DateOffset(months=CFG["live"]["months_back"])
    col = ee.ImageCollection("NOAA/VIIRS/DNB/MONTHLY_V1/VCMSLCFG").filterDate(f"{start:%Y-%m-%d}", f"{end:%Y-%m-%d}").select("avg_rad")
    img = col.toBands()
    wide = _reduce(img, grid, 500).set_index("h3")
    m = wide.stack().rename("ntl").reset_index()
    m.columns = ["h3", "band", "ntl"]
    m["month"] = pd.to_datetime(m.band.str.slice(0, 6), format="%Y%m")
    g = m.sort_values("month").groupby("h3").ntl
    level = g.apply(lambda s: s.tail(12).mean()).rename("ntl_radiance")
    trend = g.apply(lambda s: 100 * (s.tail(12).mean() / max(s.head(12).mean(), 0.05) - 1) / 2).rename("ntl_trend_pct_yr")
    return pd.concat([level, trend], axis=1).reset_index(), m[["h3", "month", "ntl"]]


def slope(grid):
    ee = _ee()
    dem = ee.ImageCollection("COPERNICUS/DEM/GLO30").select("DEM").mosaic()
    return _reduce(ee.Terrain.slope(dem).rename("slope_deg"), grid, 30)[["h3", "slope_deg"]], None


def surface_water(grid):
    ee = _ee()
    occ = ee.Image("JRC/GSW1_4/GlobalSurfaceWater").select("occurrence").unmask(0).rename("flood_occurrence_pct")
    return _reduce(occ, grid, 30)[["h3", "flood_occurrence_pct"]], None


def open_buildings(grid):
    ee = _ee()
    col = ee.ImageCollection("GOOGLE/Research/open-buildings-temporal/v1")

    def year(y):
        return col.filterDate(f"{y}-01-01", f"{y}-12-31").mosaic()

    first, last = year(2016), year(2023)
    img = (last.select("building_presence").rename("built_up_share")
           .addBands(last.select("building_presence").subtract(first.select("building_presence")).rename("built_growth_2016_2023"))
           .addBands(last.select("building_height").rename("building_height_m")))
    s = _reduce(img, grid, 10)[["h3", "built_up_share", "built_growth_2016_2023", "building_height_m"]]
    return s, None   # annual product: no monthly series; Property Pulse then uses Sentinel-2 change


def embeddings(grid):
    ee = _ee()
    from sklearn.decomposition import PCA

    y = min(2024, pd.Timestamp(CFG["as_of"]).year - 1)
    img = ee.ImageCollection("GOOGLE/SATELLITE_EMBEDDING/V1/ANNUAL").filterDate(f"{y}-01-01", f"{y + 1}-01-01").mosaic()
    raw = _reduce(img, grid, 10).set_index("h3")
    pcs = PCA(16, random_state=0).fit_transform(raw.fillna(raw.mean()))
    return pd.DataFrame(pcs, columns=[f"emb_pc{i:02d}" for i in range(1, 17)], index=raw.index).reset_index(), None


def rain_cv(grid):
    ee = _ee()
    col = ee.ImageCollection("UCSB-CHG/CHIRPS/DAILY").select("precipitation")
    annual = ee.ImageCollection([col.filterDate(f"{y}-01-01", f"{y}-12-31").sum() for y in range(2005, 2025)])
    cv = annual.reduce(ee.Reducer.stdDev()).divide(annual.mean()).rename("rain_cv")
    return _reduce(cv, grid, 5000)[["h3", "rain_cv"]], None


def heat_days(grid):
    ee = _ee()
    y0, y1 = _years(1)
    col = ee.ImageCollection("ECMWF/ERA5_LAND/DAILY_AGGR").select("temperature_2m_max").filterDate(f"{y0}-01-01", f"{y1}-01-01")
    hot = col.map(lambda i: i.gt(313.15)).sum().divide(y1 - y0).rename("heat_days")   # days above 40 C per year
    return _reduce(hot, grid, 10000)[["h3", "heat_days"]], None
