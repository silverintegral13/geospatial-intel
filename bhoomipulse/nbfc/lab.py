"""M6 NBFC lab: ingest a loan book, add collateral features, run champion vs challenger.

Three models are compared on an out-of-time hold-out:
  champion    the lender's existing score, as supplied
  refit       LightGBM on the lender's own fields only (no collateral features)
  challenger  LightGBM on the lender's fields + BhoomiPulse collateral features
The refit separates "a newer algorithm" from "better collateral data".
"""
from __future__ import annotations

import hashlib
import json
import secrets

import lightgbm as lgb
import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

from ..config import ASSET_TYPES, CFG, DEMO, ROOT
from ..features.build import DESCRIPTIONS
from ..models import common, predict
from ..models import expected_loss as el

SCHEMA = json.loads((ROOT / "schemas" / "nbfc_loan.json").read_text())
LENDER = ["bureau_score", "ltv_orig", "income_code", "product_code", "tenure_months", "interest_rate", "log_sanction"]
COLLATERAL = ["ltv_ai", "valuer_gap", "p_sold_180d", "haircut", "f_road_access_km", "f_flood_occurrence_pct", "f_ntl_trend_pct_yr",
              "f_built_up_share", "f_built_growth_2016_2023", "f_dist_major_city_km", "f_rain_cv", "f_cropping_intensity", "asset_code"]
PLAIN = {"bureau_score": "bureau score", "ltv_orig": "stated loan-to-value", "income_code": "income band", "product_code": "product",
         "tenure_months": "tenure", "interest_rate": "interest rate", "log_sanction": "loan size", "ltv_ai": "loan vs AI collateral value",
         "valuer_gap": "valuer value above AI value", "p_sold_180d": "chance the collateral sells within 180 days",
         "haircut": "expected forced-sale discount", "asset_code": "collateral type"}
PLAIN.update({"f_" + k: v.split(" (")[0].lower() for k, v in DESCRIPTIONS.items()})


def validate(df: pd.DataFrame) -> list[str]:
    errs = [f"missing column: {c}" for c in SCHEMA["required"] if c not in df.columns]
    if errs:
        return errs
    for col, allowed in SCHEMA["enums"].items():
        if col in df.columns:
            bad = set(df[col].dropna().unique()) - set(allowed)
            if bad:
                errs.append(f"{col}: unexpected values {sorted(bad)[:5]}")
    if not df.default_12m.isin([0, 1]).all():
        errs.append("default_12m must be 0 or 1")
    if (df.sanctioned_amount <= 0).any() or (df.area_sqm <= 0).any():
        errs.append("sanctioned_amount and area_sqm must be positive")
    return errs


def pseudonymise(df: pd.DataFrame) -> pd.DataFrame:
    """Replace loan ids with salted hashes; the salt lives only in memory for this run."""
    salt = secrets.token_hex(8)
    df = df.copy()
    df["loan_id"] = [hashlib.sha256((salt + str(x)).encode()).hexdigest()[:12] for x in df.loan_id]
    return df.drop(columns=[c for c in df.columns if c.lower() in {"name", "borrower_name", "phone", "mobile", "pan", "aadhaar", "email"}])


def enrich(df: pd.DataFrame) -> pd.DataFrame:
    a = predict.assess_frame(pd.DataFrame({"lat": df.lat, "lon": df.lon, "asset_type": df.collateral_type,
                                           "area_sqm": df.area_sqm, "loan_amount": df.sanctioned_amount}))
    df = pd.concat([df.reset_index(drop=True), a.drop(columns=["loan_amount"])], axis=1)
    df["ltv_ai"] = df.sanctioned_amount / df.value_mid
    df["valuer_gap"] = np.log(df.valuer_value / df.value_mid)
    df["asset_code"] = df.collateral_type.map({t: i for i, t in enumerate(ASSET_TYPES)})
    df["product_code"] = df["product"].map({"LAP": 0, "secured_msme": 1, "agri": 2})
    df["income_code"] = df["income_band"].map({"<3L": 0, "3-6L": 1, "6-12L": 2, ">12L": 3}) if "income_band" in df else 0
    for c, default in [("tenure_months", 60), ("interest_rate", 16.0)]:
        if c not in df:
            df[c] = default
    df["log_sanction"] = np.log(df.sanctioned_amount)
    df["origination_date"] = pd.to_datetime(df.origination_date)
    return df


def quality_report(df: pd.DataFrame) -> dict:
    inside = df.lat.between(20.0, 24.8) & df.lon.between(68.0, 74.6)
    out_range = (df.valuer_value < df.value_low) | (df.valuer_value > df.value_high)
    return {"loans": len(df), "geocode_hit_rate": float(inside.mean()),
            "valuer_value_outside_ai_range": float(out_range.mean()),
            "valuer_above_ai_range": float((df.valuer_value > df.value_high).mean()),
            "median_valuer_to_ai_value": float((df.valuer_value / df.value_mid).median()),
            "title_flags": None, "title_flags_reason": "Title checks need land-record documents or a ULI connection; not run on the book.",
            "default_rate_12m": float(df.default_12m.mean())}


def _psi(a, b, bins: int = 10) -> float:
    q = np.quantile(a, np.linspace(0, 1, bins + 1))[1:-1]
    pa = np.bincount(np.searchsorted(q, a), minlength=bins) / len(a) + 1e-6
    pb = np.bincount(np.searchsorted(q, b), minlength=bins) / len(b) + 1e-6
    return float(((pa - pb) * np.log(pa / pb)).sum())


def run_lab(book: pd.DataFrame, approve_share: float = 0.8) -> tuple[dict, pd.DataFrame]:
    errs = validate(book)
    if errs:
        raise ValueError("; ".join(errs))
    df = enrich(pseudonymise(book))
    cut = df.origination_date.quantile(0.75)
    tr, te = df[df.origination_date < cut], df[df.origination_date >= cut].copy()
    y_tr, y_te = tr.default_12m, te.default_12m
    champ = LogisticRegression().fit(tr[["champion_score"]] / 100.0, y_tr)
    te["pd_champion"] = champ.predict_proba(te[["champion_score"]] / 100.0)[:, 1]
    params = {**common.LGB, "n_estimators": 250, "min_child_samples": 60}
    refit = lgb.LGBMClassifier(**params).fit(tr[LENDER], y_tr)
    chal = lgb.LGBMClassifier(**params).fit(tr[LENDER + COLLATERAL], y_tr)
    te["pd_refit"] = refit.predict_proba(te[LENDER])[:, 1]
    te["pd_challenger"] = chal.predict_proba(te[LENDER + COLLATERAL])[:, 1]
    models = {}
    for k in ["champion", "refit", "challenger"]:
        models[k] = {"gini": common.gini(y_te, te[f"pd_{k}"]), "ks": common.ks(y_te, te[f"pd_{k}"])}

    # calibration by decile of challenger PD
    dec = pd.qcut(te.pd_challenger, 10, labels=False, duplicates="drop")
    calib = te.groupby(dec).agg(predicted=("pd_challenger", "mean"), actual=("default_12m", "mean")).round(4)

    # swap set at the same approval rate, and approval at constant loss
    n_ok = int(approve_share * len(te))
    ok_c = te.pd_champion.rank(method="first") <= n_ok
    ok_n = te.pd_challenger.rank(method="first") <= n_ok
    def grp(m): return {"loans": int(m.sum()), "default_rate": float(te.default_12m[m].mean()) if m.any() else None}
    swap = {"approved_by_both": grp(ok_c & ok_n), "swap_in (new approves, old rejects)": grp(~ok_c & ok_n),
            "swap_out (old approves, new rejects)": grp(ok_c & ~ok_n), "rejected_by_both": grp(~ok_c & ~ok_n)}
    target = float(te.default_12m[ok_c].mean())
    s = te.sort_values("pd_challenger")
    cum = s.default_12m.expanding().mean().to_numpy()
    okk = np.nonzero(cum <= target)[0]
    approval_const_loss = float((okk.max() + 1) / len(te)) if len(okk) else 0.0

    # LGD on resolved defaults: flat champion assumption vs collateral-based estimate
    def lgd_actual(d):
        yrs = (pd.to_datetime(d.recovery_date) - pd.to_datetime(d.default_date)).dt.days / 365.0
        return (1 - d.recovery_amount / (1 + CFG["lender"]["cost_of_funds"]) ** yrs / d.ead_at_default).clip(0, 1)
    lgd_m = None
    if {"recovery_amount", "ead_at_default", "default_date", "recovery_date"} <= set(df.columns):
        r_tr, r_te = tr[tr.recovery_amount.notna()], te[te.recovery_amount.notna()]
        if len(r_tr) > 30 and len(r_te) > 30:
            a_te = lgd_actual(r_te)
            flat = float(lgd_actual(r_tr).mean())
            ours = np.array([el.lgd(e, r) for e, r in zip(r_te.ead_at_default, r_te.realisable_mid)])
            lgd_m = {"resolved_defaults_test": len(r_te), "actual_mean_lgd": float(a_te.mean()),
                     "mae_flat_lgd": float(np.abs(a_te - flat).mean()), "mae_collateral_lgd": float(np.abs(a_te - ours).mean())}

    # per-loan explanation: top three drivers, in plain words
    contrib = chal.booster_.predict(te[LENDER + COLLATERAL], pred_contrib=True)[:, :-1]
    cols = np.array(LENDER + COLLATERAL)
    top = np.argsort(-np.abs(contrib), axis=1)[:, :3]
    te["drivers"] = ["; ".join(f"{PLAIN.get(cols[j], cols[j])} {'raises' if contrib[i, j] > 0 else 'lowers'} risk" for j in top[i])
                     for i in range(len(te))]
    imp = pd.Series(np.abs(contrib).mean(0), index=cols).sort_values(ascending=False)

    # LTV grid, collections list, fairness by region
    big = te.district.value_counts().head(8).index if "district" in te else []
    grid = (te[te.district.isin(big)].pivot_table(index="district", columns="collateral_type", values="ltv_band_low", aggfunc="median").round(2)
            if len(big) else pd.DataFrame())
    open_ = df[(df.default_12m == 1) & df.get("recovery_amount", pd.Series(np.nan, index=df.index)).isna()].copy()
    open_["recoverable_value"] = np.minimum(open_.realisable_mid, open_.get("ead_at_default", open_.sanctioned_amount))
    coll = open_.sort_values("recoverable_value", ascending=False).head(50)[
        ["loan_id", "product", "collateral_type", "district", "recoverable_value", "p_sold_180d", "haircut", "median_days_to_sale"]]
    fair = None
    if "district" in te:
        g = te.assign(region=common.region(te.district), approved=ok_n).groupby("region")
        fair = g.agg(loans=("approved", "size"), approval_rate=("approved", "mean"), default_rate=("default_12m", "mean"),
                     median_ltv_band=("ltv_band_low", "median")).round(3)
        fair["approval_ratio_vs_best"] = (fair.approval_rate / fair.approval_rate.max()).round(3)

    res = {"synthetic": bool(book.get("synthetic", pd.Series([False])).all()), "quality": quality_report(df),
           "split": f"out-of-time: trained on loans originated before {cut:%Y-%m-%d}, tested after",
           "n_train": len(tr), "n_test": len(te), "models": models, "calibration": calib.reset_index(drop=True).to_dict("records"),
           "approve_share": approve_share, "swap_set": swap, "champion_default_rate_at_approval": target,
           "challenger_approval_at_same_default_rate": approval_const_loss, "lgd": lgd_m,
           "top_drivers": {PLAIN.get(k, k): float(v) for k, v in imp.head(8).items()},
           "psi_challenger_train_vs_test": _psi(chal.predict_proba(tr[LENDER + COLLATERAL])[:, 1], te.pd_challenger.to_numpy()),
           "ltv_grid": grid.reset_index().to_dict("records") if len(grid) else [],
           "collections": coll.round(3).to_dict("records"),
           "fairness_by_region": fair.reset_index().to_dict("records") if fair is not None else None,
           "forbidden_features_used": [c for c in LENDER + COLLATERAL if any(f in c.lower() for f in common.FORBIDDEN)]}
    keep = ["loan_id", "product", "collateral_type", "district", "sanctioned_amount", "valuer_value", "value_low", "value_mid", "value_high",
            "ltv_orig", "ltv_ai", "ltv_band_low", "ltv_band_high", "p_sold_180d", "haircut", "pd_champion", "pd_refit", "pd_challenger",
            "default_12m", "drivers"]
    return res, te[[c for c in keep if c in te.columns]]


def free_ai_card(res: dict) -> str:
    m = res["models"]
    syn = ("> **SYNTHETIC BOOK.** Collateral conditions were built into the default formula of the generated book, so the "
           "challenger's lift is an assumption of the generator, not evidence.\n\n") if res["synthetic"] else ""
    return f"""# Model card: NBFC challenger PD and collateral LGD

{syn}| | Gini | KS |
| --- | --- | --- |
| Champion (existing score) | {m['champion']['gini']:.3f} | {m['champion']['ks']:.3f} |
| Refit on lender fields only | {m['refit']['gini']:.3f} | {m['refit']['ks']:.3f} |
| Challenger (+ collateral features) | {m['challenger']['gini']:.3f} | {m['challenger']['ks']:.3f} |

Hold-out: {res['split']} ({res['n_train']:,} train, {res['n_test']:,} test).

## Mapping to RBI FREE-AI expectations

| Expectation | What this prototype provides | What the lender must add |
| --- | --- | --- |
| Board-approved AI policy | This card, the validation report and the data-source register as inputs | The policy itself and its approval |
| Model risk management | Out-of-time hold-out, champion-challenger comparison, calibration table, documented assumptions | Independent validation, periodic re-validation, model inventory entry |
| Explainability | Top three drivers per loan in plain words; global driver ranking | Adverse-action wording reviewed by compliance |
| Bias testing | No demographic variables; approval rate, default rate and LTV by region (approval ratio vs best region reported) | Tests on protected attributes the lender holds, under legal guidance |
| Drift monitoring | Population stability index, train vs test: {res['psi_challenger_train_vs_test']:.3f} (under 0.10 is stable) | Monthly monitoring in production with alert thresholds |
| Human oversight | Scores are a second opinion; flagged cases go to a registered valuer and a credit officer | Escalation rules and sign-off limits |
| Data protection (DPDP Act) | Runs locally; loan ids pseudonymised on ingest; name and ID columns dropped | Consent records, retention policy, processor agreement |
"""


def main() -> dict:
    from . import synth_book

    f = DEMO / "nbfc_book_synthetic.parquet"
    book = pd.read_parquet(f) if f.exists() else synth_book.main()
    res, scored = run_lab(book)
    (DEMO / "nbfc_results.json").write_text(json.dumps(res, indent=1, default=float))
    scored.to_parquet(DEMO / "nbfc_scored_test.parquet", index=False)
    (ROOT / "models" / "cards").mkdir(parents=True, exist_ok=True)
    (ROOT / "models" / "cards" / "nbfc_challenger.md").write_text(free_ai_card(res))
    common.save_metrics("nbfc_lab", {k: res[k] for k in ["synthetic", "split", "n_train", "n_test", "models", "swap_set",
                                                         "champion_default_rate_at_approval", "challenger_approval_at_same_default_rate",
                                                         "lgd", "psi_challenger_train_vs_test"]})
    return res


if __name__ == "__main__":
    r = main()
    print(json.dumps({k: r[k] for k in ["quality", "models", "swap_set", "champion_default_rate_at_approval",
                                         "challenger_approval_at_same_default_rate", "lgd", "top_drivers", "fairness_by_region"]}, indent=1, default=float))
