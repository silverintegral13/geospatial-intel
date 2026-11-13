"""M9 Validation and honesty report: reports/validation.md, generated from metrics.json."""
from __future__ import annotations

import json

import pandas as pd

from .. import sources
from ..config import DEMO, MANUAL, REPORTS
from ..models.common import load_metrics


def main() -> None:
    m = load_metrics()
    reg = sources.load()
    li, av, ar, nb = m["liquidity"], m["avm"], m["area_score"], m["nbfc_lab"]
    n = {k: sum(1 for v in reg.values() if v["mode"] == k) for k in ("live", "manual", "synthetic", "template")}
    lines = [
        "# Validation and honesty report", "",
        "> **Read this first.** In this build only the district and village boundaries (and one IBBI figure) are real. "
        f"{n['synthetic']} of {len(reg)} sources fell back to SYNTHETIC data because their hosts could not be reached from the build "
        "environment. The models below were trained and tested on that synthetic data. The metrics prove the pipeline runs end to end "
        "and that the evaluation design is sound. They are **not** evidence of accuracy on real Indian collateral.", "",
        "## Data status", "", "| Mode | Sources |", "| --- | --- |",
        f"| Live (real) | {n['live']} |", f"| Manual (real, hand-transcribed) | {n['manual']} |",
        f"| Synthetic fallback | {n['synthetic']} |", f"| Template only (not collected) | {n['template']} |", "",
        "## Metrics", "", "| Model | Hold-out design | Metric | Value | Reading |", "| --- | --- | --- | --- | --- |",
        f"| Liquidity: sold within 180 days | {li['split']} | AUC | {li['auc_sold_180d']:.3f} | Modest ranking power; base rate {li['sold_180d_base_rate_test']:.0%} |",
        f"| Liquidity: haircut | same | MAE | {li['haircut_mae']:.3f} | **Weak**: no better than predicting the mean ({li['haircut_mae_naive_mean']:.3f}) |",
        f"| Liquidity: days to sale | same | C-index | {li['c_index_days_to_sale']:.3f} | Modest (0.5 = chance) |",
        f"| Valuation | {av['split']} | MAPE | {av['mape']:.1%} | Median error {av['median_ape']:.1%} |",
        f"| Valuation interval | same | 80% interval coverage | {av['interval_80_coverage']:.1%} | Range is x/÷ {av['interval_80_width_factor']:.2f} around the median |",
        f"| Area score | {ar['split']} | Spearman | {ar['spearman_district_holdout']:.2f} | Flattering: the synthetic target follows a simple formula; only {ar['n_districts']} districts |",
        f"| NBFC PD: champion | {nb['split']} | Gini | {nb['models']['champion']['gini']:.3f} | Existing score |",
        f"| NBFC PD: refit, lender fields only | same | Gini | {nb['models']['refit']['gini']:.3f} | Newer algorithm, same data |",
        f"| NBFC PD: challenger | same | Gini | {nb['models']['challenger']['gini']:.3f} | Lift is built into the synthetic book |",
    ]
    if nb.get("lgd"):
        lines.append(f"| NBFC LGD | resolved defaults in test | MAE | {nb['lgd']['mae_collateral_lgd']:.3f} | vs {nb['lgd']['mae_flat_lgd']:.3f} for a flat LGD |")
    lines += ["", "## Known biases and how a pilot would handle them", "",
              "- **Circularity of synthetic data.** Outcomes were generated from the same kinds of features the models see. Real data will be noisier and may show no signal for some features.",
              "- **Auction selection bias.** Auction listings contain only assets that defaulted and that a bank chose to sell. Pilot fix: weight by the lender's full collateral population and track a sample of rejected applications.",
              "- **Understated jantri.** Registered and jantri values run below market, so jantri is used as a feature and a floor, never as the target.",
              "- **Bank valuations as labels.** The valuation model learns first reserve prices, which are valuer opinions on distressed assets.",
              "- **Small district sample.** 33 districts cannot support a stable model; an all-India district panel is needed.",
              "- **Censoring.** Unsold listings show a haircut 'so far'. The time-to-sale model handles censoring; the haircut model does not yet.",
              "- **Assumed default probabilities** per asset type drive expected loss and the LTV band until a partner book replaces them.",
              "- **Placeholder plots.** The three plots are points inside real villages, not surveyed parcels.", "",
              "## Fairness", "",
              "- No caste, religion, community or other demographic variable is a model feature; a unit test enforces the list.",
              f"- Forbidden features found in the NBFC challenger: {json.loads((DEMO / 'nbfc_results.json').read_text())['forbidden_features_used'] or 'none'}.",
              "- Approval rate, default rate and LTV band by region (NBFC lab, challenger at 80% approval):", ""]
    fair = pd.DataFrame(json.loads((DEMO / "nbfc_results.json").read_text())["fairness_by_region"])
    lines += ["| Region | Loans | Approval rate | Default rate | Median LTV band | Approval ratio vs best |", "| --- | --- | --- | --- | --- | --- |"]
    lines += [f"| {r.region} | {r.loans:,} | {r.approval_rate:.1%} | {r.default_rate:.1%} | {r.median_ltv_band:.2f} | {r.approval_ratio_vs_best:.2f} |" for r in fair.itertuples()]
    lines += ["", "Region is a coarse proxy. A lender must repeat this on the protected attributes it holds, under legal guidance.", "",
              "## Plot valuations vs outside evidence", ""]
    f = MANUAL / "validation.csv"
    if f.exists() and len(pd.read_csv(f)):
        v = pd.read_csv(f)
        lines += ["| Plot | Source | Outside value | AI range | Inside range? |", "| --- | --- | --- | --- | --- |"]
        for r in v.itertuples():
            rep = json.loads((REPORTS / "plots" / f"{r.plot_id}.json").read_text())["valuation"]
            ok = rep["value_low"] <= r.value_rs <= rep["value_high"]
            lines.append(f"| {r.plot_id} | {r.source} | Rs {r.value_rs:,.0f} | Rs {rep['value_low']:,.0f} – {rep['value_high']:,.0f} | {'yes' if ok else 'no'} |")
    else:
        lines.append("No outside values supplied. Add listings or site-visit numbers to `data/manual/validation.csv` (template in `data/templates/`).")
    lines += ["", "## What a real pilot would change", "",
              "1. Replace synthetic auction listings with real BAANKNET and SARFAESI records (hand-collected or via a data agreement).",
              "2. Train the default model on the partner's loan book with an out-of-time hold-out, then run a threshold or randomised pilot to measure recovery lift, not just accuracy.",
              "3. Connect land records through a lender's ULI access, with borrower consent, instead of portal lookups.",
              "4. Have a registered valuer review a sample each month and feed disagreements back as labels.", ""]
    (REPORTS / "validation.md").write_text("\n".join(lines))
    print("validation report written")
