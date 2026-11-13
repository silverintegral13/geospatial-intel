"""SYNTHETIC NBFC loan book: 20,000 secured loans in Gujarat. No real borrower exists in it.

ASSUMPTIONS (documented so they can be challenged):
  - 12-month default rate lands near 5-6 %, a plausible level for small-ticket
    secured MSME / LAP; replace with a partner's actual book.
  - Default is driven by bureau score, true LTV, and collateral-area conditions
    (road access, flood history, local growth), plus rainfall risk for farm loans.
  - The lender's existing "champion" score sees bureau score and stated LTV only.
  - Valuer values are inflated by about 10 % on average with 20 % noise.
BECAUSE collateral conditions are built into the default formula, a challenger
model that sees them WILL beat the champion. The lab shows the tooling works;
the size of the lift is an assumption, not a finding.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .. import geo, synth
from ..config import AS_OF, DEMO, rng

PRODUCT_ASSETS = {"LAP": (["residential", "commercial"], [0.7, 0.3]),
                  "secured_msme": (["industrial", "commercial", "plot_na"], [0.45, 0.3, 0.25]),
                  "agri": (["agri_land"], [1.0])}
AREA_MU = {"agri_land": 9000, "residential": 95, "commercial": 60, "industrial": 2500, "plot_na": 300}


def generate(n: int = 20000) -> pd.DataFrame:
    r = rng("nbfc-book")
    D = geo.load_districts()
    w = np.ones(len(D))
    for name, wt in {"Ahmadabad": 7, "Surat": 5, "Vadodara": 4, "Rajkot": 4, "Mahesana": 2, "Anand": 2}.items():
        w[D.district.to_numpy() == name] = wt
    idx = r.choice(len(D), size=n, p=w / w.sum())
    lat, lon = np.zeros(n), np.zeros(n)
    for i in np.unique(idx):
        m = idx == i
        pts = synth.random_points(D.geometry.iloc[i], int(m.sum()), r)
        lat[m], lon[m] = pts[:, 0], pts[:, 1]
    product = r.choice(["LAP", "secured_msme", "agri"], size=n, p=[0.5, 0.3, 0.2])
    at = np.array([r.choice(PRODUCT_ASSETS[p][0], p=PRODUCT_ASSETS[p][1]) for p in product])
    d = synth.static_fields(lat, lon)
    area = np.exp(np.log([AREA_MU[a] for a in at]) + r.normal(0, 0.5, n))
    true_val = synth.latent_value_sqm(d, at) * area
    over = r.normal(0.10, 0.20, n)
    valuer = true_val * np.exp(over)
    ltv = np.clip(r.normal(0.55, 0.12, n), 0.2, 0.85)
    sanction = ltv * valuer
    bureau = np.clip(r.normal(720, 55, n), 300, 900)
    z = lambda s: (np.asarray(s) - np.mean(s)) / (np.std(s) + 1e-9)
    area_stress = z(0.5 * z(np.log1p(d.road_access_km)) + 0.5 * z(d.flood_occurrence_pct) - 0.5 * z(d.ntl_trend_pct_yr))
    logit = (-3.35 - 0.8 * z(bureau) + 0.5 * z(sanction / true_val) + 0.45 * area_stress
             + 0.35 * (product == "agri") * z(d.rain_cv) + 0.25 * (product == "secured_msme") + r.normal(0, 0.3, n))
    default = r.uniform(size=n) < 1 / (1 + np.exp(-logit))
    champion = np.clip(720 + 48 * z(bureau) - 18 * z(ltv) + r.normal(0, 28, n), 300, 900)
    start, end = np.datetime64("2021-01-01"), np.datetime64("2025-06-30")
    orig = start + (r.uniform(0, 1, n) * (end - start).astype(int)).astype("timedelta64[D]")
    d_month = r.integers(3, 13, n)
    default_date = np.where(default, orig + (d_month * 30).astype("timedelta64[D]"), np.datetime64("NaT"))
    hist = []
    for i in range(n):
        h = np.where(r.uniform(size=24) < 0.04, 1, 0)
        if default[i]:
            k = d_month[i]
            h[max(k - 3, 0):k] = [1, 2, 3][-min(k, 3):]
            h[k:] = 4
        hist.append("".join(map(str, h)))
    ead = np.where(default, sanction * r.uniform(0.85, 0.98, n), np.nan)
    route = np.where(default, r.choice(["settlement", "sarfaesi_auction", "court"], size=n, p=[0.4, 0.45, 0.15]), None)
    dem = synth.demand_index(d, at, over)
    haircut = np.clip(0.14 + 0.12 * (-z(dem)) + r.normal(0, 0.08, n), 0, 0.7)
    years = np.select([route == "settlement", route == "sarfaesi_auction"], [0.7, 1.6], 3.2) * np.exp(r.normal(0, 0.2, n))
    rec_date = default_date + (years * 365).astype("timedelta64[D]")
    resolved = default & (rec_date <= AS_OF)
    rec_amt = np.where(resolved, np.minimum(ead * 1.05, true_val * (1 - haircut) * 0.95), np.nan)
    B = pd.DataFrame({
        "loan_id": [f"SYNL-{i:06d}" for i in range(n)], "product": product, "collateral_type": at,
        "district": D.district.to_numpy()[idx], "lat": lat.round(5), "lon": lon.round(5), "area_sqm": area.round(1),
        "origination_date": orig, "sanctioned_amount": sanction.round(-3), "tenure_months": r.choice([36, 60, 84, 120, 180], size=n),
        "interest_rate": np.clip(r.normal(16, 2.5, n), 10.5, 24).round(2), "declared_value": (valuer * np.exp(r.normal(0.05, 0.1, n))).round(-3),
        "valuer_value": valuer.round(-3), "ltv_orig": ltv.round(3), "bureau_score": bureau.round(0),
        "income_band": r.choice(["<3L", "3-6L", "6-12L", ">12L"], size=n, p=[0.25, 0.4, 0.25, 0.1]),
        "champion_score": champion.round(0), "dpd_history": hist, "default_12m": default.astype(int),
        "default_date": default_date, "ead_at_default": np.round(ead, -3), "recovery_route": route,
        "recovery_amount": np.round(rec_amt, -3), "recovery_date": np.where(resolved, rec_date, np.datetime64("NaT")),
        "synthetic": True})
    return B


def main() -> pd.DataFrame:
    B = generate()
    B.to_parquet(DEMO / "nbfc_book_synthetic.parquet", index=False)
    B.head(200).to_csv(DEMO / "nbfc_book_sample_upload.csv", index=False)
    print(f"nbfc book: {len(B)} loans, default_12m {B.default_12m.mean():.3f}, resolved {B.recovery_amount.notna().sum()}")
    return B


if __name__ == "__main__":
    main()
