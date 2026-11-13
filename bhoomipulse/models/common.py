"""Shared helpers: feature matrices, LightGBM settings, metrics, model cards."""
from __future__ import annotations

import json

import numpy as np
import pandas as pd

from ..config import ASSET_TYPES, CFG, MODELS
from ..features.build import FEATURES

LGB = dict(n_estimators=300, learning_rate=0.05, num_leaves=15, min_child_samples=30, subsample=0.8,
           subsample_freq=1, colsample_bytree=0.8, random_state=CFG["seed"] % 10000, n_jobs=2, verbose=-1)
X_COLS = FEATURES + ["asset_code", "log_area"]

# Variables that must never be model features (fairness rule). Checked by a test.
FORBIDDEN = ["caste", "religion", "community", "tribe", "sc_share", "st_share", "muslim", "hindu", "gender", "language"]

REGION = {
    "Kachchh": "Kutch", "Banas Kantha": "North", "Patan": "North", "Mahesana": "North", "Sabar Kantha": "North",
    "Aravali": "North", "Gandhinagar": "North", "Ahmadabad": "Central", "Anand": "Central", "Kheda": "Central",
    "Vadodara": "Central", "Chhota Udaipur": "Central", "Panch Mahals": "Central", "Mahisagar": "Central", "Dohad": "Central",
    "Bharuch": "South", "Narmada": "South", "Surat": "South", "Tapi": "South", "Navsari": "South", "Valsad": "South",
    "The Dangs": "South",
}


def region(district: pd.Series) -> pd.Series:
    return district.map(REGION).fillna("Saurashtra")


def design(df: pd.DataFrame) -> pd.DataFrame:
    X = df[FEATURES].copy()
    X["asset_code"] = df["asset_type"].map({a: i for i, a in enumerate(ASSET_TYPES)}).astype(int)
    X["log_area"] = np.log(df["area_sqm"].astype(float))
    return X[X_COLS]


def gini(y, p) -> float:
    from sklearn.metrics import roc_auc_score
    return float(2 * roc_auc_score(y, p) - 1)


def ks(y, p) -> float:
    from scipy.stats import ks_2samp
    y = np.asarray(y).astype(bool)
    return float(ks_2samp(np.asarray(p)[y], np.asarray(p)[~y]).statistic)


def save_metrics(name: str, m: dict) -> None:
    f = MODELS / "metrics.json"
    allm = json.loads(f.read_text()) if f.exists() else {}
    allm[name] = m
    f.write_text(json.dumps(allm, indent=2, default=float))


def load_metrics() -> dict:
    f = MODELS / "metrics.json"
    return json.loads(f.read_text()) if f.exists() else {}


def card(name: str, title: str, *, purpose: str, data: str, method: str, metrics: dict, limits: list[str],
         fairness: str, synthetic: bool = True) -> None:
    (MODELS / "cards").mkdir(parents=True, exist_ok=True)
    badge = ("> **SYNTHETIC DATA.** This model was trained on generated data. The metrics show that the pipeline "
             "runs and can recover a signal that was built into the generator. They say nothing about accuracy on real "
             "Indian collateral.\n\n") if synthetic else ""
    rows = "\n".join(f"| {k} | {v:.3f} |" if isinstance(v, float) else f"| {k} | {v} |" for k, v in metrics.items())
    md = (f"# Model card: {title}\n\n{badge}**Purpose.** {purpose}\n\n**Training data.** {data}\n\n**Method.** {method}\n\n"
          f"## Metrics (hold-out)\n\n| Metric | Value |\n| --- | --- |\n{rows}\n\n## Known limits\n\n"
          + "\n".join(f"- {x}" for x in limits) + f"\n\n## Fairness\n\n{fairness}\n")
    (MODELS / "cards" / f"{name}.md").write_text(md)
