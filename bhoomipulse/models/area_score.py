"""3a Area collateral-quality score for districts, villages and H3 cells.

District: ridge regression of the district NPA ratio on land, infrastructure,
hazard and activity features; score = 100 for the lowest predicted stress.
Village / cell: district score shifted by a documented, monotone rule.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
from sklearn.linear_model import Ridge
from sklearn.model_selection import GroupKFold

from ..config import DEMO
from . import common

COLS = ["rain_cv", "flood_occurrence_pct", "ntl_trend_pct_yr", "road_access_km", "built_up_share",
        "cropping_intensity", "heat_days", "agri_share_credit"]
LABEL = {"rain_cv": "rainfall variability", "flood_occurrence_pct": "flood history", "ntl_trend_pct_yr": "night-light growth",
         "road_access_km": "distance to roads", "built_up_share": "built-up share", "cropping_intensity": "cropping intensity",
         "heat_days": "extreme-heat days", "agri_share_credit": "farm share of credit", "built_growth_2016_2023": "built-up growth"}
# village / cell adjustment in score points per standard deviation (sign = direction of "better collateral")
RULE = {"road_access_km": -8.0, "flood_occurrence_pct": -6.0, "ntl_trend_pct_yr": 6.0, "built_growth_2016_2023": 4.0}


def _z(P: pd.DataFrame, mu=None, sd=None):
    mu = P[COLS].mean() if mu is None else mu
    sd = P[COLS].std() if sd is None else sd
    return (P[COLS] - mu) / sd, mu, sd


def train() -> dict:
    P = pd.read_parquet(DEMO / "district_panel.parquet")
    Z, mu, sd = _z(P)
    yc = P.npa_ratio_pct - P.groupby("fy").npa_ratio_pct.transform("mean")     # remove the state-wide year effect
    pred = np.zeros(len(P))
    for tr, te in GroupKFold(5).split(Z, yc, P.district):                       # districts never seen in training
        pred[te] = Ridge(alpha=5.0).fit(Z.iloc[tr], yc.iloc[tr]).predict(Z.iloc[te])
    last = P.fy == P.fy.max()                                                   # and the last year held out in time
    t_pred = Ridge(alpha=5.0).fit(Z[~last], yc[~last]).predict(Z[last])
    model = Ridge(alpha=5.0).fit(Z, yc)
    D = P[last].reset_index(drop=True)
    stress = model.predict(Z[last])
    D["predicted_stress"] = stress
    D["score"] = (100 * (stress.max() - stress) / (stress.max() - stress.min())).round(1)
    contrib = Z[last].reset_index(drop=True) * model.coef_
    D["drivers"] = [", ".join(f"{LABEL[c]} ({'raises' if v > 0 else 'lowers'} risk)"
                              for c, v in row.abs().sort_values(ascending=False).head(3).index.map(lambda c: (c, row[c])))
                    for _, row in contrib.iterrows()]
    D[["district", "score", "predicted_stress", "drivers", "npa_ratio_pct", "synthetic"] + COLS].to_parquet(DEMO / "scores_district.parquet", index=False)

    base = float(D.loc[D.district == "Ahmadabad", "score"].iloc[0])
    for level, fname in [("village", "features_village.parquet"), ("h3", "features_h3.parquet")]:
        F = pd.read_parquet(DEMO / fname)
        adj, why = np.zeros(len(F)), [[] for _ in range(len(F))]
        V = pd.read_parquet(DEMO / "features_village.parquet")                 # z-scores always against villages
        for c, w in RULE.items():
            z = ((F[c] - V[c].mean()) / V[c].std()).clip(-2, 2)
            adj += w * z
            for i, val in enumerate(w * z):
                why[i].append((abs(val), f"{LABEL[c]} ({'+' if val > 0 else '-'}{abs(val):.0f})"))
        F["score"] = np.clip(base + adj, 0, 100).round(1)
        F["drivers"] = [", ".join(t for _, t in sorted(w_, reverse=True)[:2]) for w_ in why]
        F.to_parquet(DEMO / f"scores_{level}.parquet", index=False)

    m = {"n_districts": int(P.district.nunique()), "n_years": int(P.fy.nunique()), "rows": len(P),
         "split": "5-fold with whole districts held out; plus last year held out",
         "r2_district_holdout": float(1 - ((yc - pred) ** 2).sum() / ((yc - yc.mean()) ** 2).sum()),
         "spearman_district_holdout": float(spearmanr(yc, pred).statistic),
         "mae_district_holdout_pct_points": float(np.abs(yc - pred).mean()),
         "spearman_last_year_holdout": float(spearmanr(yc[last], t_pred).statistic),
         "coefficients_per_sd": dict(zip(COLS, model.coef_.round(3))), "village_rule_points_per_sd": RULE,
         "base_district_for_villages": "Ahmadabad", "base_score": base}
    common.save_metrics("area_score", m)
    common.card("area_score", "Area collateral-quality score (3a)",
                purpose="Rank districts, villages and H3 cells by how well collateral there is likely to hold up.",
                data=f"District-year panel, {m['n_districts']} districts x {m['n_years']} years of NPA ratios "
                     "(stand-in for SLBC Gujarat / RBI BSR tables).",
                method="Ridge regression on standardised features after removing the state-wide year effect. Village and cell "
                       "scores are the Ahmadabad district score shifted by fixed points per standard deviation of four features.",
                metrics={"R2, districts held out": m["r2_district_holdout"], "Spearman, districts held out": m["spearman_district_holdout"],
                         "MAE (NPA % points)": m["mae_district_holdout_pct_points"], "Spearman, last year held out": m["spearman_last_year_holdout"]},
                limits=["Small sample: 33 districts. Treat the district score as a prior, not a prediction.",
                        "An all-India district panel would be needed for a stable model.",
                        "The village rule is a documented judgement, not a fitted model; fit it on auction outcomes once real listings exist.",
                        "Gujarat has 34 districts since 2025; Vav-Tharad is still inside Banas Kantha here."],
                fairness="Features are land, infrastructure, hazard and activity only. No population or demographic field enters the score.")
    return m
