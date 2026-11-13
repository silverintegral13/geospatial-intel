"""3d PD x LGD method demo.

Intended data: the Freddie Mac Single-Family Loan-Level sample (US loan-level
data with LTV, property type and realised losses) or US SBA loans. Neither was
available: no file was supplied and the hosts were unreachable. A Freddie Mac
loader is NOT written yet. The demo therefore runs on the SYNTHETIC NBFC book
and is labelled "method demo, synthetic, not India evidence".
"""
from __future__ import annotations

import pandas as pd
from sklearn.linear_model import LogisticRegression

from ..config import DEMO
from . import common


def train() -> dict:
    B = pd.read_parquet(DEMO / "nbfc_book_synthetic.parquet")
    B["origination_date"] = pd.to_datetime(B.origination_date)
    cut = B.origination_date.quantile(0.75)
    tr, te = B[B.origination_date < cut], B[B.origination_date >= cut]
    X = lambda d: pd.concat([d[["ltv_orig"]], (d[["bureau_score"]] - 700) / 100, pd.get_dummies(d.collateral_type).astype(float)], axis=1)
    m = LogisticRegression(max_iter=500).fit(X(tr), tr.default_12m)
    p = m.predict_proba(X(te))[:, 1]
    band = pd.cut(B.ltv_orig, [0, 0.4, 0.5, 0.6, 0.7, 1.0], labels=["<40%", "40-50%", "50-60%", "60-70%", ">70%"])
    lgd = (1 - B.recovery_amount / B.ead_at_default).clip(0, 1)
    tab = pd.DataFrame({"ltv_band": band, "default_12m": B.default_12m, "lgd": lgd}).groupby("ltv_band", observed=True).agg(
        loans=("default_12m", "size"), pd_12m=("default_12m", "mean"), lgd_resolved=("lgd", "mean")).round(4)
    tab["el_rate"] = (tab.pd_12m * tab.lgd_resolved).round(4)
    tab.reset_index().to_csv(DEMO / "pd_lgd_by_ltv_band.csv", index=False)
    out = {"data": "SYNTHETIC NBFC book (method demo, not India evidence)", "split": f"out-of-time at {cut:%Y-%m-%d}",
           "gini_logistic_scorecard": common.gini(te.default_12m, p), "table": tab.reset_index().astype({"ltv_band": str}).to_dict("records")}
    common.save_metrics("pd_demo", out)
    common.card("pd_demo", "PD x LGD method demo (3d)",
                purpose="Show how default probability and loss severity combine by LTV band and collateral type.",
                data="Synthetic NBFC book of 20,000 loans. The intended Freddie Mac / SBA data were not available.",
                method="Logistic scorecard on LTV, bureau score and collateral type; realised LGD on resolved defaults by LTV band.",
                metrics={"Gini, logistic scorecard": out["gini_logistic_scorecard"]},
                limits=["Not trained on Indian or any real loans.", "Freddie Mac loader is not written; the file cannot be redistributed in any case."],
                fairness="No demographic variables are used.")
    return out
