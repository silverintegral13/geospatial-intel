"""LIVE fetchers for Sentinel-2 / Sentinel-1 from the Planetary Computer STAC API.

NOT exercised in the build environment (host unreachable). Needs
requirements-full.txt. Returns (static_df, monthly_df) keyed by H3 cell.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from ..config import CFG


def _cube(grid, collection: str, bands: list[str], query: dict | None = None):
    import odc.stac
    import planetary_computer
    import pystac_client

    cat = pystac_client.Client.open(CFG["live"]["stac_url"], modifier=planetary_computer.sign_inplace)
    minx, miny, maxx, maxy = grid.total_bounds
    end = pd.Timestamp(CFG["as_of"])
    start = end - pd.DateOffset(months=CFG["live"]["months_back"])
    items = cat.search(collections=[collection], bbox=[minx, miny, maxx, maxy],
                       datetime=f"{start:%Y-%m-%d}/{end:%Y-%m-%d}", query=query or {}).item_collection()
    if not len(items):
        raise RuntimeError(f"no {collection} items found")
    return odc.stac.load(items, bands=bands, bbox=[minx, miny, maxx, maxy], crs="EPSG:32643",
                         resolution=20, chunks={"x": 2048, "y": 2048}, groupby="solar_day")


def _zonal(da, grid) -> pd.DataFrame:
    """Mean of a (month, y, x) DataArray at each H3 cell centre (3x3 pixel window)."""
    from pyproj import Transformer

    x, y = Transformer.from_crs(4326, 32643, always_xy=True).transform(grid.lon.to_numpy(), grid.lat.to_numpy())
    sm = da.rolling(x=3, y=3, center=True, min_periods=1).mean()
    import xarray as xr

    pts = sm.sel(x=xr.DataArray(x, dims="cell"), y=xr.DataArray(y, dims="cell"), method="nearest").compute()
    df = pts.to_pandas().T if pts.dims[0] != "cell" else pts.to_pandas()
    df.index = grid.h3.to_numpy()
    out = df.stack().rename("v").reset_index()
    out.columns = ["h3", "month", "v"]
    return out


def sentinel2(grid):
    ds = _cube(grid, "sentinel-2-l2a", ["B04", "B08", "SCL"], {"eo:cloud_cover": {"lt": 60}})
    clear = ds.SCL.isin([4, 5, 6, 7])
    ndvi = ((ds.B08 - ds.B04) / (ds.B08 + ds.B04)).where(clear)
    monthly = ndvi.resample(time="1MS").median().rename({"time": "month"})
    m = _zonal(monthly, grid).rename(columns={"v": "ndvi"})
    g = m.assign(year=pd.to_datetime(m.month).dt.year).groupby("h3")
    amp = (g.ndvi.quantile(0.95) - g.ndvi.quantile(0.05)).rename("ndvi_amplitude")
    # cropping intensity: seasons per year whose peak NDVI exceeds 0.4 (kharif Jul-Oct, rabi Dec-Mar)
    mm = pd.to_datetime(m.month).dt.month
    k = m[mm.isin([7, 8, 9, 10])].groupby("h3").ndvi.max() > 0.4
    r = m[mm.isin([12, 1, 2, 3])].groupby("h3").ndvi.max() > 0.4
    ci = (1 + (k & r).astype(float)).rename("cropping_intensity")
    return pd.concat([amp, ci], axis=1).reset_index(), m


def sentinel1(grid):
    ds = _cube(grid, "sentinel-1-rtc", ["vv"])
    vv = 10 * np.log10(ds.vv.where(ds.vv > 0))
    monthly = vv.resample(time="1MS").median().rename({"time": "month"})
    return None, _zonal(monthly, grid).rename(columns={"v": "sar_vv_db"})
