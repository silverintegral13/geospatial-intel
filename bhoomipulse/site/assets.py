"""M10 Deck assets: maps, charts and tables exported to deck_assets/."""
from __future__ import annotations

import json
import shutil

import pandas as pd

from .. import geo, sources, viz
from ..config import ASSET_LABEL, ASSETS, CFG, DEMO, REPORTS, ensure_dirs
from ..models.common import load_metrics

TYPES = ["residential", "commercial", "plot_na", "industrial", "agri_land"]


def district_map():
    D = geo.load_districts().merge(pd.read_parquet(DEMO / "scores_district.parquet")[["district", "score"]], on="district")
    return viz.choropleth(D, "score", "Collateral-quality score by district, Gujarat (synthetic demo data)",
                          "Score (100 = strongest collateral conditions)", names="district")


def village_map():
    V = geo.load_villages().merge(pd.read_parquet(DEMO / "scores_village.parquet")[["village_id", "score"]], on="village_id")
    return viz.choropleth(V, "score", "Collateral-quality score by village, Sanand taluka (synthetic demo data)",
                          "Score (100 = strongest collateral conditions)", points=pd.DataFrame(CFG["plots"]), figsize=(7.2, 6.6))


def liquidity_chart():
    b = load_metrics()["liquidity"]["by_asset_type"]
    return viz.grouped_bars([ASSET_LABEL[t].replace(" ", "\n", 1) for t in TYPES], [b[t]["sold_180d_actual"] for t in TYPES],
                            [b[t]["sold_180d_predicted"] for t in TYPES], "Actual", "Predicted",
                            "Sold within 180 days, by asset type (synthetic, later listings)", "Share of listings")


def nbfc_chart():
    m = load_metrics()["nbfc_lab"]["models"]
    return viz.simple_bars(["Champion\n(existing score)", "Refit\n(lender fields only)", "Challenger\n(+ collateral features)"],
                           [m["champion"]["gini"], m["refit"]["gini"], m["challenger"]["gini"]],
                           "Default-model Gini on later loans (synthetic book)", "Gini", highlight=2)


def pulse_chart(plot_id: str = "factory"):
    s = pd.read_parquet(DEMO / "plot_monthly.parquet")
    s = s[s.plot_id == plot_id]
    kind = next(p["kind"] for p in CFG["plots"] if p["id"] == plot_id)
    return viz.pulse_chart(s, kind, title=f"Pulse, {plot_id} plot: scripted slowdown in the last six months (synthetic)" if plot_id == "factory" else None)


def metrics_table() -> pd.DataFrame:
    m = load_metrics()
    li, av, ar, nb = m["liquidity"], m["avm"], m["area_score"], m["nbfc_lab"]
    rows = [("Liquidity: sold within 180 days", "AUC", li["auc_sold_180d"], "time hold-out"),
            ("Liquidity: haircut", "MAE", li["haircut_mae"], "time hold-out"),
            ("Liquidity: haircut, naive mean", "MAE", li["haircut_mae_naive_mean"], "time hold-out"),
            ("Liquidity: days to sale", "C-index", li["c_index_days_to_sale"], "time hold-out"),
            ("Valuation", "MAPE", av["mape"], "7 unseen districts"),
            ("Valuation", "80% interval coverage", av["interval_80_coverage"], "7 unseen districts"),
            ("Area score", "Spearman", ar["spearman_district_holdout"], "districts held out"),
            ("NBFC PD: champion", "Gini", nb["models"]["champion"]["gini"], "out-of-time"),
            ("NBFC PD: refit", "Gini", nb["models"]["refit"]["gini"], "out-of-time"),
            ("NBFC PD: challenger", "Gini", nb["models"]["challenger"]["gini"], "out-of-time")]
    if nb.get("lgd"):
        rows += [("NBFC LGD: flat assumption", "MAE", nb["lgd"]["mae_flat_lgd"], "resolved test defaults"),
                 ("NBFC LGD: collateral-based", "MAE", nb["lgd"]["mae_collateral_lgd"], "resolved test defaults")]
    T = pd.DataFrame(rows, columns=["model", "metric", "value", "hold_out"])
    T["value"] = T.value.round(3)
    T["data"] = "SYNTHETIC"
    return T


def source_counts() -> pd.DataFrame:
    reg = sources.load()
    return pd.DataFrame([{"source": k, "mode": v["mode"], "rows": v["rows"], "licence": v["licence"]} for k, v in sorted(reg.items())])


def main() -> None:
    ensure_dirs()
    viz.save(district_map(), ASSETS / "district_map.png")
    viz.save(village_map(), ASSETS / "village_map.png")
    viz.save(liquidity_chart(), ASSETS / "liquidity_by_asset_type.png")
    viz.save(nbfc_chart(), ASSETS / "nbfc_champion_vs_challenger.png")
    viz.save(pulse_chart("factory"), ASSETS / "pulse_factory.png")
    metrics_table().to_csv(ASSETS / "metrics_table.csv", index=False)
    source_counts().to_csv(ASSETS / "data_source_counts.csv", index=False)
    shutil.copy(REPORTS / "plots" / "factory.pdf", ASSETS / "plot_report_factory.pdf")
    n = json.loads((DEMO / "nbfc_results.json").read_text())
    (ASSETS / "README.md").write_text(f"""# Deck assets

Everything here comes from the prototype build. **All figures are from SYNTHETIC demo data** except the map boundaries.
Say so on any slide that uses them.

| File | What it shows |
| --- | --- |
| `district_map.png` | Collateral-quality score for the 33 mapped Gujarat districts (darker = stronger). |
| `village_map.png` | The same score for the 67 villages of Sanand taluka, with the three placeholder plots marked. |
| `plot_report_factory.pdf` | The full collateral report for the factory placeholder plot. |
| `pulse_factory.png` | Monthly night-light activity for the factory plot, with a scripted slowdown that triggers a flag. |
| `liquidity_by_asset_type.png` | Share of auction listings sold within 180 days by asset type, actual vs predicted, on later listings. |
| `nbfc_champion_vs_challenger.png` | Gini of the existing score, a refit on lender fields, and the challenger with collateral features ({n['n_test']:,} later loans). |
| `metrics_table.csv` | Every headline metric with its hold-out design. |
| `data_source_counts.csv` | Every data source with its mode (live, manual, synthetic, template), row count and licence. |
| `screenshot_*.png` | Screens of the Streamlit app and the static site. |
""")
    print("deck assets written")


if __name__ == "__main__":
    main()
