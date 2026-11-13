"""BhoomiPulse demo app (Streamlit). DEMO_MODE reads only the small committed demo data:
no Earth Engine project, API key or internet data source is needed.

Run:  streamlit run app/main.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import pandas as pd
import streamlit as st

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
try:  # hosted secrets -> environment
    for k in ("ANTHROPIC_API_KEY", "GEE_PROJECT"):
        if k in st.secrets and not os.environ.get(k):
            os.environ[k] = st.secrets[k]
except Exception:
    pass

from bhoomipulse import chat, geo, sources, viz  # noqa: E402
from bhoomipulse.config import ASSET_LABEL, ASSET_TYPES, CFG, DEMO, MODELS, REPORTS  # noqa: E402
from bhoomipulse.models import predict  # noqa: E402
from bhoomipulse.nbfc import lab  # noqa: E402
from bhoomipulse.report.build import inr, pct  # noqa: E402
from bhoomipulse.site import assets  # noqa: E402
from bhoomipulse.site.build import fmap  # noqa: E402

st.set_page_config(page_title="BhoomiPulse", layout="wide")
st.warning("**SYNTHETIC DEMO.** Only the district and village boundaries are real. Every score, value, auction and loan shown here "
           "is generated stand-in data. It shows how the product works, not what any property is worth.")
st.title("BhoomiPulse")
st.caption("Collateral recovery intelligence for lenders: value range, realisable value after a forced sale, title and hazard checks, monthly Pulse.")


@st.cache_data
def load(name: str) -> pd.DataFrame:
    return pd.read_parquet(DEMO / name)


@st.cache_data
def district_map_html() -> str:
    D = geo.load_districts().merge(load("scores_district.parquet")[["district", "score", "drivers"]], on="district")
    return fmap(D, "district", ["district", "score", "drivers"], ["District", "Score", "Top drivers"], 7)


@st.cache_data
def village_map_html() -> str:
    V = geo.load_villages().merge(load("scores_village.parquet")[["village_id", "score", "drivers"]], on="village_id")
    return fmap(V, "village", ["village", "score", "drivers"], ["Village", "Score", "Adjustment vs district"], 11, markers=True)


tabs = st.tabs(["Gujarat districts", "Sanand villages", "Plot report", "Pulse", "NBFC lab", "Data & model cards", "Ask"])

with tabs[0]:
    st.subheader("Collateral-quality score by district")
    st.caption(CFG["district_note"])
    st.components.v1.html(district_map_html(), height=560)
    d = load("scores_district.parquet")[["district", "score", "drivers"]].sort_values("score", ascending=False)
    st.dataframe(d.rename(columns={"district": "District", "score": "Score", "drivers": "Top drivers"}), hide_index=True, use_container_width=True)

with tabs[1]:
    st.subheader("Sanand taluka: village drill-down")
    st.caption("Village score = Ahmadabad district score, shifted by road access, flood history, night-light growth and built-up growth. Pins are the three placeholder plots.")
    st.components.v1.html(village_map_html(), height=560)
    v = load("scores_village.parquet")[["village", "score", "drivers", "road_access_km", "flood_occurrence_pct", "ntl_trend_pct_yr"]]
    st.dataframe(v.sort_values("score", ascending=False).round(2), hide_index=True, use_container_width=True)
    st.caption(f"H3 grid: {len(load('features_h3.parquet')):,} cells at resolution {CFG['h3_resolution']} carry the same features and score.")

with tabs[2]:
    st.subheader("Plot-level collateral report")
    pid = st.radio("Plot", [p["id"] for p in CFG["plots"]], horizontal=True,
                   format_func=lambda i: next(p["label"] for p in CFG["plots"] if p["id"] == i))
    r = json.loads((REPORTS / "plots" / f"{pid}.json").read_text())
    c = st.columns(4)
    c[0].metric("Value, central estimate", inr(r["valuation"]["value_mid"]))
    c[0].caption(f"80% range: {inr(r['valuation']['value_low'])} to {inr(r['valuation']['value_high'])}")
    c[1].metric("Realisable value", inr(r["recovery"]["realisable_value"]))
    c[2].metric("Suggested LTV band", f"{pct(r['loss']['ltv_band_low'])} – {pct(r['loss']['ltv_band_high'])}")
    c[3].metric("Activity Index", f"{r['pulse']['activity_index']:.0f} / 100")
    if r["red_flags"]:
        st.error("**Red flags**\n\n" + "\n".join(f"- {f}" for f in r["red_flags"]))
    else:
        st.success("No red flags.")
    for head, key in [("Valuation vs jantri", "valuation"), ("Liquidity and realisable value", "liquidity"), ("Expected loss and LTV", "loss"),
                      ("Hazards", "hazards"), ("Access and repossession", "access")]:
        st.markdown(f"**{head}.** {r['prose'][key]}")
    b = r["title"]["boundary"]
    st.markdown(f"**Title and boundary.** {r['title']['record']['_status']} Boundary check: {b['area_gap_pct']}% area gap, overlap IoU {b['iou']} "
                f"({'FLAG' if b['flag'] else 'within tolerance'}; synthetic). Court disputes and registered charges were not checked.")
    pdf = REPORTS / "plots" / f"{pid}.pdf"
    if pdf.exists():
        st.download_button("Download the PDF report", pdf.read_bytes(), file_name=f"bhoomipulse_{pid}.pdf", mime="application/pdf")
    st.caption(r["footer"])
    with st.expander("Assess another location (synthetic features)"):
        f = st.columns(5)
        lat = f[0].number_input("Latitude", 20.2, 24.6, 22.99, format="%.4f")
        lon = f[1].number_input("Longitude", 68.5, 74.4, 72.38, format="%.4f")
        at = f[2].selectbox("Asset type", ASSET_TYPES, format_func=ASSET_LABEL.get)
        area = f[3].number_input("Area (sq m)", 20.0, 500000.0, 200.0)
        loan = f[4].number_input("Loan (Rs)", 1e5, 1e9, 2e6, step=1e5)
        if st.button("Assess"):
            a = predict.assess(lat, lon, at, area, loan)
            days = "over half unsold in the observed window" if pd.isna(a["median_days_to_sale"]) else f"{a['median_days_to_sale']:.0f} days"
            st.write(f"Value {inr(a['value_low'])} to {inr(a['value_high'])}; jantri {inr(a['jantri_value'])}. "
                     f"Sold within 180 days: {pct(a['p_sold_180d'])}; haircut {pct(a['haircut'])}; median time to sale {days}. "
                     f"Realisable {inr(a['realisable_mid'])}. LTV band {pct(a['ltv_band_low'])} to {pct(a['ltv_band_high'])}; "
                     f"requested LTV {pct(a['ltv_requested'])}; expected loss {100 * a['el_rate']:.2f}% of the loan.")

with tabs[3]:
    st.subheader("Pulse: monthly monitoring after disbursal")
    st.caption("10 m imagery cannot count trucks: the factory signal is night lights plus roof and yard change. High-resolution imagery is a paid upgrade.")
    pulse = json.loads((DEMO / "pulse_plots.json").read_text())
    for p in CFG["plots"]:
        res = pulse[p["id"]]
        left, right = st.columns([1, 2])
        left.metric(p["label"], f"{res['activity_index']:.0f} / 100")
        for fl in res["flags"]:
            left.error(fl)
        if not res["flags"]:
            left.success("No anomaly this month.")
        left.caption(res["scenario_note"])
        right.pyplot(assets.pulse_chart(p["id"]))

with tabs[4]:
    st.subheader("NBFC lab: champion vs challenger")
    st.caption("Upload a loan file (CSV or Excel, layout in schemas/nbfc_loan.json) or use the synthetic 20,000-loan book. Loan ids are "
               "pseudonymised on ingest and nothing leaves this app's server process.")
    up = st.file_uploader("Loan book", type=["csv", "xlsx"])
    st.download_button("Download a sample file in the right layout", (DEMO / "nbfc_book_sample_upload.csv").read_bytes(), "sample_loan_book.csv")
    if up is not None:
        book = pd.read_excel(up) if up.name.endswith("xlsx") else pd.read_csv(up)
        errs = lab.validate(book)
        if errs:
            st.error("The file does not match the layout:\n\n" + "\n".join(f"- {e}" for e in errs))
            st.stop()
        if len(book) < 2000 or book.default_12m.sum() < 50:
            st.warning("Small book: under 2,000 loans or 50 defaults. Results will be unstable.")
        with st.spinner("Attaching collateral features and training the challenger"):
            R, scored = lab.run_lab(book)
    else:
        R, scored = json.loads((DEMO / "nbfc_results.json").read_text()), load("nbfc_scored_test.parquet")
    if R["synthetic"]:
        st.info("**Synthetic book.** Collateral conditions were written into its default formula, so the challenger's lift is an assumption, not a finding.")
    m = R["models"]
    c = st.columns(4)
    c[0].metric("Champion Gini", f"{m['champion']['gini']:.3f}")
    c[1].metric("Refit, lender fields only", f"{m['refit']['gini']:.3f}")
    c[2].metric("Challenger, + collateral", f"{m['challenger']['gini']:.3f}", f"{m['challenger']['gini'] - m['champion']['gini']:+.3f} vs champion")
    c[3].metric("Approval at same default rate", f"{R['challenger_approval_at_same_default_rate']:.0%}", f"from {R['approve_share']:.0%}")
    st.caption(R["split"] + f" · {R['n_train']:,} train, {R['n_test']:,} test")
    a, b = st.columns(2)
    a.markdown("**Data-quality report**")
    a.dataframe(pd.DataFrame([{"Check": k.replace("_", " "), "Result": f"{v:.1%}" if isinstance(v, float) and v <= 1 else str(v)}
                              for k, v in R["quality"].items() if v is not None]), hide_index=True, use_container_width=True)
    b.markdown(f"**Swap set at {R['approve_share']:.0%} approval**")
    b.dataframe(pd.DataFrame([{"Group": k, "Loans": v["loans"], "Default rate": None if v["default_rate"] is None else f"{v['default_rate']:.1%}"}
                              for k, v in R["swap_set"].items()]), hide_index=True, use_container_width=True)
    a, b = st.columns(2)
    a.markdown("**Calibration by decile (challenger)**")
    a.dataframe(pd.DataFrame(R["calibration"]).rename(columns={"predicted": "Predicted PD", "actual": "Actual default rate"}), use_container_width=True)
    if R["lgd"]:
        b.markdown("**Loss given default**")
        b.write(f"{R['lgd']['resolved_defaults_test']} resolved defaults in the test window. Mean absolute error: "
                f"{R['lgd']['mae_flat_lgd']:.3f} with a flat LGD, {R['lgd']['mae_collateral_lgd']:.3f} with the collateral-based estimate.")
    b.markdown("**What drives the challenger**")
    b.dataframe(pd.DataFrame({"Driver": list(R["top_drivers"]), "Mean impact": [round(x, 3) for x in R["top_drivers"].values()]}), hide_index=True, use_container_width=True)
    if R["ltv_grid"]:
        st.markdown("**Risk-adjusted LTV grid** (median conservative LTV by district and asset type)")
        st.dataframe(pd.DataFrame(R["ltv_grid"]), hide_index=True, use_container_width=True)
    st.markdown("**Collections priority: open defaults ranked by recoverable value**")
    st.dataframe(pd.DataFrame(R["collections"]).head(20), hide_index=True, use_container_width=True)
    st.markdown("**Per-loan explanations** (test loans, highest challenger PD first)")
    st.dataframe(scored.sort_values("pd_challenger", ascending=False).head(200).round(3), hide_index=True, use_container_width=True)
    if R["fairness_by_region"]:
        st.markdown("**Outcomes by region** (no demographic variables are used)")
        st.dataframe(pd.DataFrame(R["fairness_by_region"]), hide_index=True, use_container_width=True)
    st.download_button("Download the model card (mapped to RBI FREE-AI)", lab.free_ai_card(R), "model_card_nbfc_challenger.md")

with tabs[5]:
    st.subheader("Data sources")
    reg = sources.load()
    st.dataframe(pd.DataFrame([{"Source": k, "Status": v["mode"].upper() if v["mode"] == "synthetic" else v["mode"], "Rows": v["rows"],
                                "Licence": v["licence"], "Used for": v["use"], "Note": v["note"]} for k, v in sorted(reg.items())]),
                 hide_index=True, use_container_width=True)
    if not os.environ.get("GEE_PROJECT"):
        st.caption("Earth Engine layers (Open Buildings, AlphaEarth embeddings, night lights, terrain, rainfall) are skipped: no GEE_PROJECT set.")
    st.subheader("Metrics")
    st.dataframe(assets.metrics_table(), hide_index=True, use_container_width=True)
    st.pyplot(assets.liquidity_chart())
    st.subheader("Model cards")
    for f in sorted((MODELS / "cards").glob("*.md")):
        with st.expander(f.stem.replace("_", " ").title()):
            st.markdown(f.read_text())
    with st.expander("Validation and honesty report"):
        st.markdown((REPORTS / "validation.md").read_text())

with tabs[6]:
    st.subheader("Ask the feature store")
    st.caption("Answers come from tool functions over the data, not free text. Try: “which districts in my book have weak collateral?”")
    q = st.chat_input("Ask about districts, villages, the loan book or how fast assets sell")
    if q:
        st.chat_message("user").write(q)
        st.chat_message("assistant").markdown(chat.answer(q))

_ = viz  # charts use the shared style
