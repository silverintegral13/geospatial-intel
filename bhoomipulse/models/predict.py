"""One call that assesses a piece of collateral: value range, liquidity, realisable value, EL, LTV band."""
from __future__ import annotations

from functools import lru_cache

import numpy as np
import pandas as pd

from ..config import CFG
from ..features.build import point_features
from . import expected_loss as el
from .avm import AVM
from .liquidity import Liquidity


@lru_cache(maxsize=1)
def _models():
    return AVM(), Liquidity()


def assess_frame(df: pd.DataFrame, features: pd.DataFrame | None = None) -> pd.DataFrame:
    """df: lat, lon, asset_type, area_sqm, loan_amount (optional pd_12m). Returns one row per asset."""
    avm, liq = _models()
    df = df.reset_index(drop=True)
    F = point_features(df.lat.to_numpy(), df.lon.to_numpy(), df.asset_type.to_numpy()) if features is None else features.reset_index(drop=True)
    X = pd.concat([df[["asset_type", "area_sqm"]], F], axis=1)
    v = avm.predict(X)
    out = pd.DataFrame({"value_low": v.value_sqm_low * df.area_sqm, "value_mid": v.value_sqm_mid * df.area_sqm,
                        "value_high": v.value_sqm_high * df.area_sqm, "value_sqm_mid": v.value_sqm_mid,
                        "jantri_value": F.jantri_rate_sqm * df.area_sqm})
    X["reserve_first"] = out.value_mid
    lq = liq.predict(X)
    out = pd.concat([out, lq], axis=1)
    # time to sale: model median, or the observed window if under half sell within it
    days = out.median_days_to_sale.fillna(out.max_observed_days)
    out["years_to_sale"] = (days + 365) / 365.0           # + ~1 year from default to first auction (ASSUMPTION)
    pd_map = CFG["lender"]["pd_12m_by_asset"]
    out["pd_12m"] = df["pd_12m"] if "pd_12m" in df else df.asset_type.map(pd_map)
    out["realisable_low"] = [el.realisable_value(a, h, t) for a, h, t in zip(out.value_low, out.haircut, out.years_to_sale)]
    out["realisable_mid"] = [el.realisable_value(a, h, t) for a, h, t in zip(out.value_mid, out.haircut, out.years_to_sale)]
    loan = df["loan_amount"].astype(float) if "loan_amount" in df else out.value_mid * 0.6
    out["loan_amount"] = loan
    out["ltv_requested"] = loan / out.value_mid
    out["lgd"] = [el.lgd(a, b) for a, b in zip(loan, out.realisable_mid)]
    out["lgd_stressed"] = [el.lgd(a, b) for a, b in zip(loan, out.realisable_low)]
    out["el_rate"] = out.pd_12m * out.lgd
    out["el_amount"] = out.el_rate * loan
    bands = [el.ltv_band(a, b, h, t, p) for a, b, h, t, p in zip(out.value_low, out.value_mid, out.haircut, out.years_to_sale, out.pd_12m)]
    out["ltv_band_low"], out["ltv_band_high"] = [b[0] for b in bands], [b[1] for b in bands]
    return pd.concat([out, F.add_prefix("f_")], axis=1).replace([np.inf, -np.inf], np.nan)


def assess(lat: float, lon: float, asset_type: str, area_sqm: float, loan_amount: float) -> dict:
    df = pd.DataFrame([{"lat": lat, "lon": lon, "asset_type": asset_type, "area_sqm": area_sqm, "loan_amount": loan_amount}])
    return assess_frame(df).iloc[0].to_dict()
