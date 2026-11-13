"""SYNTHETIC fallbacks for sources that could not be reached.

Everything produced here is made up by documented formulas plus seeded noise.
It exists so the pipeline, models, reports and app can be exercised end to end.
It is NOT evidence about real land, auctions or loans. Every table written from
this module carries synthetic=True and every UI surface shows a SYNTHETIC badge.

Design: smooth random spatial fields (sums of cosine waves) are sampled at any
lat/lon, so H3 cells, plots, auction listings and loans all see one consistent
"world". Real geometry (distance to cities, to Sanand town, to the GIDC area)
shapes the fields so the maps look geographically sensible.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from shapely.geometry import Point

from . import geo
from .config import AS_OF, ASSET_TYPES, rng

N_EMB = 16
SYNTH_COLS = [
    "road_access_km", "drive_time_city_min", "built_up_share", "built_growth_2016_2023",
    "building_height_m", "ntl_radiance", "ntl_trend_pct_yr", "ndvi_amplitude",
    "cropping_intensity", "flood_occurrence_pct", "slope_deg", "rain_cv", "heat_days",
] + [f"emb_pc{i:02d}" for i in range(1, N_EMB + 1)]


class Field:
    """Smooth, roughly standard-normal random field over Gujarat."""

    def __init__(self, tag: str, k: int = 24, lmin: float = 4.0, lmax: float = 160.0):
        r = rng("field:" + tag)
        wl = np.exp(r.uniform(np.log(lmin), np.log(lmax), k))
        th = r.uniform(0, 2 * np.pi, k)
        self.kx, self.ky = 2 * np.pi / wl * np.cos(th), 2 * np.pi / wl * np.sin(th)
        self.ph = r.uniform(0, 2 * np.pi, k)
        self.k = k

    def __call__(self, lat, lon) -> np.ndarray:
        x, y = geo.to_xy_km(np.atleast_1d(lat), np.atleast_1d(lon))
        return np.cos(np.outer(x, self.kx) + np.outer(y, self.ky) + self.ph).sum(1) * np.sqrt(2 / self.k)


_F = {t: Field(t) for t in ["built", "growth", "road", "ntl", "crop", "flood", "slope", "rain",
                            "heat", "value", "jantri", "height", "demand"]}
_EMB = [Field(f"emb{i}", lmin=2.0, lmax=60.0) for i in range(N_EMB)]


def static_fields(lat, lon) -> pd.DataFrame:
    """Geometry features (real) + SYNTHETIC satellite-style features for points."""
    lat, lon = np.atleast_1d(lat).astype(float), np.atleast_1d(lon).astype(float)
    g = geo.geometry_features(lat, lon)
    urban = np.exp(-g.dist_major_city_km / 22.0)
    urban = urban + 0.35 * np.exp(-g.dist_sanand_town_km / 3.0) + 0.30 * np.exp(-g.dist_gidc_km / 4.0)
    urban = np.clip(urban, 0, 1).to_numpy()
    f = {k: v(lat, lon) for k, v in _F.items()}
    built = np.clip(0.72 * urban + 0.10 * f["built"] + 0.03, 0.0, 0.98)
    growth = np.clip(0.04 + 0.30 * urban * (1 - built) + 0.04 * f["growth"], -0.02, 0.6)
    road = np.exp(0.7 * f["road"] - 0.4 - 1.5 * urban)
    d = g.copy()
    d["road_access_km"] = road
    d["drive_time_city_min"] = g.dist_major_city_km * 1.5 + road * 4.0
    d["built_up_share"] = built
    d["built_growth_2016_2023"] = growth
    d["building_height_m"] = np.clip(3 + 9 * built + 1.2 * f["height"], 2.5, 40)
    d["ntl_radiance"] = np.exp(0.3 + 3.2 * built + 0.3 * f["ntl"])
    d["ntl_trend_pct_yr"] = 2 + 20 * growth + 2 * f["ntl"]
    d["ndvi_amplitude"] = np.clip(0.50 * (1 - built) + 0.07 * f["crop"], 0.02, 0.7)
    d["cropping_intensity"] = np.clip(1.5 + 0.45 * f["crop"], 1.0, 2.6)
    d["flood_occurrence_pct"] = np.clip(np.exp(1.1 * f["flood"] - 0.2) * 2.0, 0, 60)
    d["slope_deg"] = np.clip(np.exp(0.6 * f["slope"] - 0.3), 0, 15)
    d["rain_cv"] = np.clip(0.32 + 0.06 * f["rain"], 0.15, 0.6)
    d["heat_days"] = np.clip(55 + 12 * f["heat"], 10, 110)
    for i, e in enumerate(_EMB, 1):   # stand-in for AlphaEarth embeddings (PCA to 16)
        d[f"emb_pc{i:02d}"] = 0.6 * e(lat, lon) + 0.4 * (built - 0.3) * (1 if i % 2 else -1)
    d["_urban"] = urban
    d["_value_noise"] = f["value"]
    d["_jantri_noise"] = f["jantri"]
    d["_demand_noise"] = f["demand"]
    return d


_ASSET_MULT = {"agri_land": (1.0, 0), "plot_na": (2.2, 0), "industrial": (1.8, 1500),
               "residential": (4.0, 12000), "commercial": (6.0, 15000)}


def latent_value_sqm(d: pd.DataFrame, asset_type) -> np.ndarray:
    """SYNTHETIC 'true' market value in Rs per sq m (generator-only knowledge).

    Rural base exp(6.2) ~ Rs 490/sq m (~Rs 20 lakh/acre); rises with urbanisation,
    built-up share and growth; falls with poor road access and flood history.
    """
    logv = (6.2 + 2.6 * d["_urban"] + 0.9 * d["built_up_share"] + 0.8 * d["built_growth_2016_2023"]
            - 0.25 * np.log1p(d["road_access_km"]) - 0.012 * d["flood_occurrence_pct"]
            + 0.25 * d["_value_noise"])
    at = np.broadcast_to(np.asarray(asset_type, dtype=object), (len(d),))
    mult = np.array([_ASSET_MULT[a][0] for a in at])
    add = np.array([_ASSET_MULT[a][1] for a in at])
    return np.exp(logv.to_numpy()) * mult + add


def jantri_ratio(d: pd.DataFrame) -> np.ndarray:
    """Jantri as a share of market value: understated, 30-80 %."""
    return np.clip(0.52 + 0.10 * d["_jantri_noise"].to_numpy(), 0.3, 0.8)


def demand_index(d: pd.DataFrame, asset_type, overpricing) -> np.ndarray:
    """SYNTHETIC buyer demand for a distressed asset (drives sale odds)."""
    at = np.broadcast_to(np.asarray(asset_type, dtype=object), (len(d),))
    eff = {"agri_land": -0.6, "industrial": -0.4, "residential": 0.3, "commercial": 0.0, "plot_na": 0.1}
    z = lambda s: (s - s.mean()) / (s.std() + 1e-9)
    return (0.9 * d["_urban"].to_numpy() + 0.4 * z(d["ntl_trend_pct_yr"]).to_numpy()
            - 0.5 * z(d["flood_occurrence_pct"]).to_numpy() - 0.3 * np.log1p(d["road_access_km"]).to_numpy()
            + np.array([eff[a] for a in at]) - 0.8 * np.asarray(overpricing)
            + 0.35 * d["_demand_noise"].to_numpy())


def random_points(poly, n: int, r: np.random.Generator) -> np.ndarray:
    minx, miny, maxx, maxy = poly.bounds
    out: list[tuple[float, float]] = []
    while len(out) < n:
        xs, ys = r.uniform(minx, maxx, 4 * n), r.uniform(miny, maxy, 4 * n)
        out += [(y, x) for x, y in zip(xs, ys) if poly.contains(Point(x, y))]
    return np.array(out[:n])


# ----------------------------------------------------------------- auctions
def generate_listings(districts, n: int = 4500) -> tuple[pd.DataFrame, pd.DataFrame]:
    """SYNTHETIC stand-in for BAANKNET listings in Gujarat, with re-listing history.

    Per-round sale odds are centred near 13-15 %, in line with the publicly
    reported 14.7 % auction success rate on BAANKNET. Each failed round is
    re-listed 30-60 days later with the reserve price cut by 5-15 %.
    """
    r = rng("listings")
    w = np.ones(len(districts))
    for name, wt in {"Ahmadabad": 8, "Surat": 6, "Vadodara": 4, "Rajkot": 4, "Gandhinagar": 2}.items():
        w[districts.district.to_numpy() == name] = wt
    idx = r.choice(len(districts), size=n, p=w / w.sum())
    lat, lon = np.zeros(n), np.zeros(n)
    for i in np.unique(idx):
        m = idx == i
        pts = random_points(districts.geometry.iloc[i], int(m.sum()), r)
        lat[m], lon[m] = pts[:, 0], pts[:, 1]
    at = r.choice(ASSET_TYPES, size=n, p=[0.16, 0.40, 0.16, 0.14, 0.14])
    d = static_fields(lat, lon)
    area_mu = {"agri_land": np.log(9000), "residential": np.log(95), "commercial": np.log(60),
               "industrial": np.log(2500), "plot_na": np.log(300)}
    area = np.exp(np.array([area_mu[a] for a in at]) + r.normal(0, 0.55, n))
    true_val = latent_value_sqm(d, at) * area
    over = r.normal(0.08, 0.18, n)                     # bank valuation error (log)
    reserve1 = true_val * np.exp(over)
    D = demand_index(d, at, over) + r.normal(0, 0.5, n)
    start, end = np.datetime64("2024-07-01"), np.datetime64("2026-09-30")
    listed = start + (r.uniform(0, 1, n) * (end - start).astype(int)).astype("timedelta64[D]")
    rows, rounds = [], []
    for i in range(n):
        date = listed[i] + np.timedelta64(int(r.integers(20, 36)), "D")
        reserve, sold, n_r, last_date, price = reserve1[i], False, 0, None, None
        for k in range(1, 7):
            if date > AS_OF:
                break
            n_r, last_date = k, date
            rounds.append((i, k, date, round(reserve, -3)))
            p = 1 / (1 + np.exp(-(-2.6 + 0.8 * D[i] + 0.35 * (k - 1))))
            if r.uniform() < p:
                sold, price = True, reserve * (1 + r.uniform(0, 0.06))
                break
            date = date + np.timedelta64(int(r.integers(30, 61)), "D")
            if date <= AS_OF:
                reserve *= 1 - r.uniform(0.05, 0.15)
        final = price if sold else reserve
        dur = ((last_date if sold else AS_OF) - listed[i]).astype(int)
        rows.append((n_r, sold, round(reserve, -3), round(final, -3), last_date, int(dur)))
    L = pd.DataFrame(rows, columns=["n_rounds", "sold", "reserve_last", "final_price", "last_auction_date", "duration_days"])
    L.insert(0, "listing_id", [f"SYN-{i:05d}" for i in range(n)])
    L["bank"] = r.choice([f"PSB-{c}" for c in "ABCDEFGHIJKL"], size=n)
    L["asset_type"], L["district"] = at, districts.district.to_numpy()[idx]
    L["lat"], L["lon"] = lat.round(5), lon.round(5)
    L["geocode_confidence"] = r.choice([0.9, 0.7, 0.5], size=n, p=[0.5, 0.3, 0.2])
    L["area_sqm"], L["reserve_first"] = area.round(1), reserve1.round(-3)
    L["emd"] = (0.10 * L.reserve_first).round(-2)
    L["listed_date"] = listed
    L["haircut_pct"] = (1 - L.final_price / L.reserve_first).clip(-0.1, 0.9)
    L["sold_180d"] = L.sold & (L.duration_days <= 180)
    L["observed_180d"] = L.sold_180d | ((AS_OF - listed).astype(int) >= 180)
    L["synthetic"] = True
    L = L[L.n_rounds > 0].reset_index(drop=True)
    R = pd.DataFrame(rounds, columns=["i", "round", "auction_date", "reserve_price"])
    R["listing_id"] = [f"SYN-{i:05d}" for i in R.pop("i")]
    R["synthetic"] = True
    return L, R


# ----------------------------------------------------------- district panel
def generate_district_panel(districts) -> pd.DataFrame:
    """SYNTHETIC district-year credit-stress panel (stand-in for SLBC / RBI BSR tables)."""
    r = rng("district-panel")
    rows = []
    for _, row in districts.iterrows():
        pts = random_points(row.geometry, 150, r)
        d = static_fields(pts[:, 0], pts[:, 1])
        f = d[[c for c in d.columns if not c.startswith("_")]].mean()
        f["district"] = row.district
        rows.append(f)
    F = pd.DataFrame(rows)
    z = lambda s: (s - s.mean()) / (s.std() + 1e-9)
    F["agri_share_credit"] = np.clip(0.55 - 0.9 * F.built_up_share + r.normal(0, 0.05, len(F)), 0.05, 0.8)
    base = (4.8 + 1.3 * z(F.rain_cv) * (0.5 + F.agri_share_credit) + 0.9 * z(F.flood_occurrence_pct)
            - 0.9 * z(F.ntl_trend_pct_yr) + 0.6 * z(F.road_access_km) + r.normal(0, 0.6, len(F)))
    out = []
    for fy, shock in zip(range(2019, 2026), [0.3, 1.4, 1.6, 0.6, 0.0, -0.3, -0.4]):
        P = F.copy()
        P["fy"] = fy
        P["npa_ratio_pct"] = np.clip(base + shock + r.normal(0, 0.5, len(F)), 0.8, 18)
        out.append(P)
    P = pd.concat(out, ignore_index=True)
    P["synthetic"] = True
    return P


# -------------------------------------------------------------------- pulse
def months(n: int = 36) -> pd.DatetimeIndex:
    last = pd.Timestamp(str(AS_OF)).to_period("M")
    return pd.period_range(last - n + 1, last, freq="M").to_timestamp()


def monthly_series(lat: float, lon: float, tag: str, scenario: str | None = None) -> pd.DataFrame:
    """SYNTHETIC 36-month series standing in for Sentinel-2 NDVI, Sentinel-1 VV,
    VIIRS night lights and a built-up index. `scenario` scripts a demo event."""
    r = rng(f"series:{tag}")
    d = static_fields([lat], [lon]).iloc[0]
    ms = months()
    m, t = ms.month.to_numpy(), np.arange(len(ms)) / 12.0
    bump = lambda centre, width: np.exp(-0.5 * (((m - centre + 6) % 12 - 6) / width) ** 2)
    kharif, rabi = bump(9, 1.3), bump(1, 1.2)
    year_fx = 1 + 0.12 * r.normal(0, 1, len(ms) // 12 + 2)[(np.arange(len(ms)) + 2) // 12]
    k_amp = d.ndvi_amplitude * year_fx
    if scenario == "unsown":
        k_amp = np.where((ms.year == 2026) & (ms.month >= 6), 0.12 * k_amp, k_amp)
    rabi_on = 0.85 if d.cropping_intensity > 1.4 else 0.15
    ndvi = 0.16 + k_amp * kharif + rabi_on * d.ndvi_amplitude * rabi + r.normal(0, 0.015, len(ms))
    ntl = d.ntl_radiance * (1 + d.ntl_trend_pct_yr / 100) ** (t - t[-1]) * (1 + r.normal(0, 0.04, len(ms)))
    built = d.built_up_share + d.built_growth_2016_2023 / 7 * (t - t[-1]) + r.normal(0, 0.006, len(ms))
    if scenario == "factory_slowdown":   # activity fades to 68 % over the last six months
        ntl = ntl * np.interp(np.arange(len(ms)), [len(ms) - 7, len(ms) - 1], [1.0, 0.68])
    if scenario == "construction":
        built = 0.08 + 0.72 / (1 + np.exp(-(np.arange(len(ms)) - (len(ms) - 12)) / 3.0)) + r.normal(0, 0.01, len(ms))
    return pd.DataFrame({"month": ms, "ndvi": np.clip(ndvi, 0.02, 0.95), "sar_vv_db": -14 + 9 * np.clip(ndvi, 0, 1) + r.normal(0, 0.4, len(ms)),
                         "ntl": np.clip(ntl, 0.1, None), "built_index": np.clip(built, 0, 1), "synthetic": True})
