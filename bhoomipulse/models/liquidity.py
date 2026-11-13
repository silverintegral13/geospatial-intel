"""3b Liquidity and haircut: will distressed collateral sell, at what discount, how fast.

Three models on auction listings, evaluated on a later-time hold-out:
  - P(sold within 180 days of listing)         LightGBM classifier
  - expected cut from first reserve to final   LightGBM regressor
  - days to sale (unsold = censored)           Cox proportional hazards
"""
from __future__ import annotations

import json

import lightgbm as lgb
import numpy as np
import pandas as pd
from lifelines import CoxPHFitter
from lifelines.utils import concordance_index
from sklearn.metrics import mean_absolute_error, roc_auc_score

from ..config import AS_OF, DEMO, MODELS
from . import common

COX_COLS = ["dist_major_city_km", "road_access_km", "built_up_share", "built_growth_2016_2023", "ntl_trend_pct_yr",
            "flood_occurrence_pct", "log_area", "log_price_vs_jantri"]
TYPES = ["agri_land", "residential", "commercial", "industrial", "plot_na"]


def _x(df: pd.DataFrame) -> pd.DataFrame:
    X = common.design(df)
    # how ambitious the bank's reserve is relative to the government floor value
    X["log_price_vs_jantri"] = np.log(df.reserve_first / df.area_sqm / df.jantri_rate_sqm)
    return X


def _cox_frame(df: pd.DataFrame, mu=None, sd=None):
    X = _x(df)[COX_COLS].copy()
    X[["dist_major_city_km", "road_access_km"]] = np.log1p(X[["dist_major_city_km", "road_access_km"]])
    mu = X.mean() if mu is None else mu
    sd = X.std() if sd is None else sd
    Z = (X - mu) / sd
    for t in TYPES[1:]:
        Z[f"type_{t}"] = (df.asset_type.to_numpy() == t).astype(float)
    return Z, mu, sd


def train() -> dict:
    L = pd.read_parquet(DEMO / "listings.parquet")
    split = pd.Timestamp("2025-10-01")
    full = (pd.Timestamp(str(AS_OF)) - L.listed_date).dt.days >= 180      # 180 days fully observed
    tr, te = L[(L.listed_date < split) & full], L[(L.listed_date >= split) & full]
    clf = lgb.LGBMClassifier(**common.LGB).fit(_x(tr), tr.sold_180d.astype(int))
    p = clf.predict_proba(_x(te))[:, 1]
    reg = lgb.LGBMRegressor(**common.LGB).fit(_x(tr), tr.haircut_pct)
    h = reg.predict(_x(te))
    clf.booster_.save_model(str(MODELS / "liquidity_sold180.txt"))
    reg.booster_.save_model(str(MODELS / "liquidity_haircut.txt"))

    # survival: all listings, later-time hold-out, unsold listings censored at the cut-off
    s_tr, s_te = L[L.listed_date < split], L[L.listed_date >= split]
    Z, mu, sd = _cox_frame(s_tr)
    Z["duration"], Z["event"] = s_tr.duration_days.clip(lower=1).to_numpy(), s_tr.sold.astype(int).to_numpy()
    cox = CoxPHFitter(penalizer=0.05).fit(Z, "duration", "event")
    Zt, _, _ = _cox_frame(s_te, mu, sd)
    c = concordance_index(s_te.duration_days, -cox.predict_partial_hazard(Zt), s_te.sold.astype(int))
    H0 = cox.baseline_cumulative_hazard_.iloc[:, 0]
    (MODELS / "liquidity_cox.json").write_text(json.dumps({
        "columns": list(Zt.columns), "mean": mu.to_dict(), "sd": sd.to_dict(), "beta": cox.params_.to_dict(),
        "center": float((cox.params_ * Z[cox.params_.index].mean()).sum()),
        "t": [float(x) for x in H0.index], "H0": [float(x) for x in H0.values]}))

    by_type = {t: {"n_test": int((te.asset_type == t).sum()), "sold_180d_actual": float(te.sold_180d[te.asset_type == t].mean()),
                   "sold_180d_predicted": float(p[te.asset_type.to_numpy() == t].mean()),
                   "haircut_actual": float(te.haircut_pct[te.asset_type == t].mean()),
                   "haircut_predicted": float(h[te.asset_type.to_numpy() == t].mean())} for t in TYPES}
    reg_tab = pd.DataFrame({"region": common.region(te.district).to_numpy(), "p": p, "h": h}).groupby("region").mean().round(3)
    m = {"n_train": len(tr), "n_test": len(te), "split": "listed before / after 2025-10-01 (time hold-out)",
         "sold_180d_base_rate_test": float(te.sold_180d.mean()), "auc_sold_180d": float(roc_auc_score(te.sold_180d, p)),
         "haircut_mae": float(mean_absolute_error(te.haircut_pct, h)),
         "haircut_mae_naive_mean": float(mean_absolute_error(te.haircut_pct, np.full(len(te), tr.haircut_pct.mean()))),
         "c_index_days_to_sale": float(c), "n_survival_train": len(s_tr), "n_survival_test": len(s_te),
         "by_asset_type": by_type, "by_region": reg_tab.to_dict("index")}
    common.save_metrics("liquidity", m)
    common.card("liquidity", "Liquidity and haircut (3b)",
                purpose="For a pledged asset, estimate the chance it sells within 180 days of a bank auction listing, "
                        "the expected cut from the first reserve price, and the days to sale.",
                data=f"{len(L):,} auction listings in Gujarat with re-listing history (stand-in for BAANKNET). "
                     f"Train: listed before 2025-10-01. Test: listed after.",
                method="LightGBM classifier and regressor; Cox proportional-hazards model with unsold listings censored at the cut-off.",
                metrics={"AUC, sold within 180 days": m["auc_sold_180d"], "Base rate, sold within 180 days": m["sold_180d_base_rate_test"],
                         "Haircut MAE": m["haircut_mae"], "Haircut MAE, naive mean": m["haircut_mae_naive_mean"],
                         "C-index, days to sale": m["c_index_days_to_sale"], "Test listings": m["n_test"]},
                limits=["Selection bias: auctions contain only assets that defaulted and that a bank chose to sell.",
                        "Haircut is measured against the bank's first reserve price, not an independent market value.",
                        "Unsold listings have a haircut 'so far', which understates their final discount.",
                        "Plant and machinery is excluded (not tied to a location).",
                        "Synthetic listings follow a formula the model can partly recover; real data will be noisier."],
                fairness="No demographic variables are used. Mean predictions by region are reported in metrics.json "
                         "(by_region) so large regional gaps can be reviewed before use.")
    return m


class Liquidity:
    def __init__(self):
        self.clf = lgb.Booster(model_file=str(MODELS / "liquidity_sold180.txt"))
        self.reg = lgb.Booster(model_file=str(MODELS / "liquidity_haircut.txt"))
        self.cox = json.loads((MODELS / "liquidity_cox.json").read_text())

    def predict(self, df: pd.DataFrame) -> pd.DataFrame:
        """df needs FEATURES, asset_type, area_sqm, reserve_first (the valuation being tested)."""
        X = _x(df)
        c = self.cox
        Z, _, _ = _cox_frame(df, pd.Series(c["mean"]), pd.Series(c["sd"]))
        ph = np.exp(Z[c["columns"]].to_numpy() @ np.array([c["beta"][k] for k in c["columns"]]) - c["center"])
        t, H0 = np.array(c["t"]), np.array(c["H0"])
        med = []
        for x in ph:
            hit = np.nonzero(np.exp(-H0 * x) <= 0.5)[0]
            med.append(float(t[hit[0]]) if len(hit) else float("nan"))   # nan: under half sell in the observed window
        return pd.DataFrame({"p_sold_180d": self.clf.predict(X), "haircut": np.clip(self.reg.predict(X), 0, 0.9),
                             "median_days_to_sale": med, "max_observed_days": float(t.max())})
