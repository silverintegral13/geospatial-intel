"""3c Valuation: value per sq m with an 80 % split-conformal interval.

Target: the bank-valued first reserve price per sq m from auction listings.
Hold-out: whole districts the model never saw (geographic hold-out).
"""
from __future__ import annotations

import json

import lightgbm as lgb
import numpy as np
import pandas as pd

from ..config import DEMO, MODELS, rng
from . import common


def train() -> dict:
    L = pd.read_parquet(DEMO / "listings.parquet")
    y = np.log(L.reserve_first / L.area_sqm)
    r = rng("avm-split")
    districts = np.array(sorted(L.district.unique()))
    r.shuffle(districts)
    test_d, cal_d = set(districts[:7]), set(districts[7:13])
    te, ca = L.district.isin(test_d), L.district.isin(cal_d)
    tr = ~te & ~ca
    model = lgb.LGBMRegressor(**common.LGB).fit(common.design(L[tr]), y[tr])
    q = float(np.quantile(np.abs(y[ca] - model.predict(common.design(L[ca]))), 0.8))   # split conformal, log scale
    pred = model.predict(common.design(L[te]))
    ape = np.abs(np.exp(pred) / np.exp(y[te]) - 1)
    cover = float(((y[te] >= pred - q) & (y[te] <= pred + q)).mean())
    jr = (np.exp(pred) / L.jantri_rate_sqm[te]).median()
    model.booster_.save_model(str(MODELS / "avm.txt"))
    (MODELS / "avm_conformal.json").write_text(json.dumps({"q_log_80": q}))
    by_type = {t: {"mape": float(ape[L.asset_type[te].to_numpy() == t].mean()), "n": int((L.asset_type[te] == t).sum())}
               for t in sorted(L.asset_type.unique())}
    m = {"n_train": int(tr.sum()), "n_calibration": int(ca.sum()), "n_test": int(te.sum()),
         "split": f"geographic hold-out: {len(test_d)} whole districts unseen in training", "test_districts": sorted(test_d),
         "mape": float(ape.mean()), "median_ape": float(np.median(ape)), "interval_80_coverage": cover,
         "interval_80_width_factor": float(np.exp(q)), "median_value_vs_jantri": float(jr), "by_asset_type": by_type}
    common.save_metrics("avm", m)
    common.card("avm", "Valuation range (3c)",
                purpose="Estimate a value per sq m as a median and an 80 % interval, and compare it with the jantri rate.",
                data=f"{len(L):,} auction listings (first reserve price per sq m, set by a bank valuer). "
                     f"Train {int(tr.sum()):,}, calibration {int(ca.sum()):,}, test {int(te.sum()):,} listings in 7 unseen districts.",
                method="LightGBM on log price per sq m; split-conformal interval from calibration-district residuals (implemented directly).",
                metrics={"MAPE": m["mape"], "Median APE": m["median_ape"], "80 % interval coverage": cover,
                         "Interval half-width (x/÷)": m["interval_80_width_factor"], "Median value / jantri": m["median_value_vs_jantri"]},
                limits=["Reserve prices are bank valuations of distressed assets, not sale prices of ordinary transactions.",
                        "Conformal coverage assumes test data resemble calibration data; across districts it can drift.",
                        "Rural intervals are wide by design; the product reports a range, never a point.",
                        "Jantri is a feature, not a target, because registered values are understated."],
                fairness="No demographic variables are used. Error by asset type is in metrics.json (by_asset_type).")
    return m


class AVM:
    def __init__(self):
        self.model = lgb.Booster(model_file=str(MODELS / "avm.txt"))
        self.q = json.loads((MODELS / "avm_conformal.json").read_text())["q_log_80"]

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        mid = np.exp(self.model.predict(common.design(df)))
        return pd.DataFrame({"value_sqm_low": mid / np.exp(self.q), "value_sqm_mid": mid, "value_sqm_high": mid * np.exp(self.q)})
