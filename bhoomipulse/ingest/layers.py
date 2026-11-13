"""Geospatial layers per H3 cell: satellite, buildings, embeddings, terrain, climate, roads.

For every source: try the live fetcher; if the host is unreachable or a
credential/package is missing, log why and fall back to labelled SYNTHETIC
values with the same columns. Output: one parquet per source in data/interim/.

The live fetchers (live_stac.py, live_gee.py, live_osm.py) are written against
the public APIs but were NOT exercised in the build environment, which could
reach only GitHub. Expect to debug them on first live run.
"""
from __future__ import annotations

import pandas as pd

from .. import geo, sources, synth
from ..config import INTERIM
from . import live_gee, live_osm, live_stac

E = [f"emb_pc{i:02d}" for i in range(1, synth.N_EMB + 1)]
# name, url, licence, static columns, monthly columns, live fetcher, use
LAYERS = [
    ("Sentinel-2 L2A (Planetary Computer STAC)", "https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-2-l2a",
     "Copernicus Sentinel data terms (free, open)", ["ndvi_amplitude", "cropping_intensity"], ["ndvi"], live_stac.sentinel2,
     "NDVI seasonality, cropping intensity, Farm Pulse"),
    ("Sentinel-1 RTC (Planetary Computer STAC)", "https://planetarycomputer.microsoft.com/api/stac/v1/collections/sentinel-1-rtc",
     "Copernicus Sentinel data terms (free, open)", [], ["sar_vv_db"], live_stac.sentinel1, "Cloud-free sowing check"),
    ("Landsat C2 L2 surface temperature / ERA5-Land", "https://developers.google.com/earth-engine/datasets/catalog/ECMWF_ERA5_LAND_DAILY_AGGR",
     "USGS public domain / Copernicus licence", ["heat_days"], [], live_gee.heat_days, "Heat exposure"),
    ("VIIRS night lights (monthly)", "https://developers.google.com/earth-engine/datasets/catalog/NOAA_VIIRS_DNB_MONTHLY_V1_VCMSLCFG",
     "Public domain (NOAA / EOG)", ["ntl_radiance", "ntl_trend_pct_yr"], ["ntl"], live_gee.night_lights, "Activity Index"),
    ("Copernicus DEM GLO-30", "https://developers.google.com/earth-engine/datasets/catalog/COPERNICUS_DEM_GLO30",
     "Copernicus DEM licence (free)", ["slope_deg"], [], live_gee.slope, "Terrain"),
    ("JRC Global Surface Water", "https://developers.google.com/earth-engine/datasets/catalog/JRC_GSW1_4_GlobalSurfaceWater",
     "Copernicus / JRC open licence", ["flood_occurrence_pct"], [], live_gee.surface_water, "Flood history"),
    ("Google Open Buildings 2.5D Temporal", "https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_Research_open-buildings-temporal_v1",
     "CC BY 4.0", ["built_up_share", "built_growth_2016_2023", "building_height_m"], ["built_index"], live_gee.open_buildings,
     "Built-up share, growth, height, Property Pulse"),
    ("AlphaEarth Satellite Embeddings (annual)", "https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_SATELLITE_EMBEDDING_V1_ANNUAL",
     "CC BY 4.0", E, [], live_gee.embeddings, "Model features (PCA to 16)"),
    ("CHIRPS daily rainfall", "https://developers.google.com/earth-engine/datasets/catalog/UCSB-CHG_CHIRPS_DAILY",
     "CC0", ["rain_cv"], [], live_gee.rain_cv, "Rainfall variability"),
    ("OpenStreetMap roads", "https://www.openstreetmap.org", "ODbL 1.0", ["road_access_km", "drive_time_city_min"], [],
     live_osm.road_access, "Road access, drive time, repossession feasibility"),
    ("Fields of The World field boundaries", "https://source.coop/ftw/global-data", "CC BY 4.0 (per-source terms)", [], [],
     None, "Farmed boundary for the title boundary check"),
    ("ESA WorldCover 10 m", "https://developers.google.com/earth-engine/datasets/catalog/ESA_WorldCover_v200", "CC BY 4.0",
     [], [], None, "Land-cover class (not yet used by a feature)"),
]


def run() -> None:
    villages = geo.load_villages()
    grid = geo.h3_grid(villages)
    grid.drop(columns="geometry").to_parquet(INTERIM / "h3_grid.parquet")
    synth_static = synth.static_fields(grid.lat.to_numpy(), grid.lon.to_numpy())
    synth_monthly = None
    static, monthly = grid[["h3"]].copy(), None
    for name, url, lic, s_cols, m_cols, fetch, use in LAYERS:
        mode, note = "synthetic", ""
        try:
            if fetch is None:
                raise RuntimeError("no live fetcher written yet")
            s_df, m_df = fetch(grid)                       # keyed by h3 (and month)
            mode = "live"
        except Exception as e:                             # unreachable host, missing package or credential
            note = f"Live fetch failed: {type(e).__name__}: {str(e)[:120]}. SYNTHETIC fallback used."
            s_df = pd.concat([grid[["h3"]], synth_static[s_cols]], axis=1) if s_cols else None
            m_df = None
            if m_cols:
                if synth_monthly is None:
                    synth_monthly = pd.concat([synth.monthly_series(la, lo, f"h3:{h}").assign(h3=h)
                                               for h, la, lo in zip(grid.h3, grid.lat, grid.lon)], ignore_index=True)
                m_df = synth_monthly[["h3", "month"] + m_cols]
        if s_df is not None:
            static = static.merge(s_df, on="h3", how="left")
        if m_df is not None:
            monthly = m_df if monthly is None else monthly.merge(m_df, on=["h3", "month"], how="outer")
        for c in s_cols:
            static[f"{c}__synthetic"] = mode != "live"
        rows = (0 if s_df is None else len(s_df)) + (0 if m_df is None else len(m_df))
        sources.record(name, url=url, licence=lic, rows=rows, mode=mode if rows else "template", use=use, note=note)
        print(f"layers: {name}: {mode} ({rows} rows)")
    static.to_parquet(INTERIM / "h3_static.parquet")
    monthly["synthetic"] = True if synth_monthly is not None else False
    monthly.to_parquet(INTERIM / "h3_monthly.parquet")
