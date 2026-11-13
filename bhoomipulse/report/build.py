"""M7 Collateral report: JSON first, then prose written ONLY from the JSON, then HTML and PDF.

Every number in the prose must exist in the JSON; `numbers_supported` enforces it.
With ANTHROPIC_API_KEY set, an LLM may rewrite the prose; if its text fails the
number check, the template text is used instead.
"""
from __future__ import annotations

import json
import os
import re

import pandas as pd
from jinja2 import Template

from .. import sources, viz
from ..config import ASSET_LABEL, CFG, DEMO, REPORTS, ROOT, ensure_dirs
from ..models import predict
from ..models.common import load_metrics
from ..pulse import pulse
from ..title.boundary import title_health

FOOTER = "AI-assisted second opinion; does not replace a registered valuer."
OUT = REPORTS / "plots"


def inr(x: float) -> str:
    if x >= 1e7:
        return f"Rs {x / 1e7:.2f} crore"
    if x >= 1e5:
        return f"Rs {x / 1e5:.1f} lakh"
    return f"Rs {x:,.0f}"


def pct(x: float) -> str:
    return f"{100 * x:.0f}%"


def band(v: float, cuts: tuple[float, float]) -> str:
    return "low" if v < cuts[0] else "moderate" if v < cuts[1] else "high"


def build_json(plot: dict) -> dict:
    P = pd.read_parquet(DEMO / "features_plot.parquet")
    row = P[P.id == plot["id"]]
    a = predict.assess_frame(row).iloc[0]
    f = {k[2:]: float(v) for k, v in a.items() if k.startswith("f_")}
    vm = pd.read_parquet(DEMO / "village_monthly.parquet")
    V = pd.read_parquet(DEMO / "scores_village.parquet")
    vrow = V[V.village == row.village.iloc[0]]
    pres, series = pulse.plot_pulse(plot, vm[vm.village_id == vrow.village_id.iloc[0]] if len(vrow) else None)
    D = pd.read_parquet(DEMO / "scores_district.parquet")
    title = title_health(plot)
    days = None if pd.isna(a.median_days_to_sale) else int(a.median_days_to_sale)
    flags = []
    if a.value_mid < a.jantri_value:
        flags.append("AI value is below the jantri (government floor) value; check the land use and area on record.")
    if a.ltv_requested > a.ltv_band_low:
        flags.append(f"Requested loan is {pct(a.ltv_requested)} of the AI value, above the conservative limit of {pct(a.ltv_band_low)}.")
    if a.p_sold_180d < 0.4:
        flags.append(f"Hard to sell: {pct(a.p_sold_180d)} chance of sale within 180 days of listing.")
    if f["flood_occurrence_pct"] >= 10:
        flags.append("High surface-water history at this location.")
    if title["boundary"]["flag"]:
        flags.append("Boundary on record does not match the observed boundary.")
    flags += pres["flags"]
    reg = sources.load()
    rep = {
        "plot": {**{k: plot[k] for k in ["id", "label", "kind", "asset_type", "lat", "lon", "area_sqm", "survey_number", "loan_amount"]},
                 "asset_label": ASSET_LABEL[plot["asset_type"]], "village": row.village.iloc[0], "taluka": CFG["taluka"],
                 "placeholder": True},
        "as_of": CFG["as_of"],
        "valuation": {"value_low": round(a.value_low, -3), "value_mid": round(a.value_mid, -3), "value_high": round(a.value_high, -3),
                      "value_per_sqm": round(a.value_sqm_mid, 0), "jantri_value": round(a.jantri_value, -3),
                      "value_to_jantri": round(a.value_mid / a.jantri_value, 2), "interval": "80% split-conformal"},
        "liquidity": {"p_sold_180d": round(a.p_sold_180d, 2), "expected_haircut": round(a.haircut, 2), "median_days_to_sale": days,
                      "years_to_cash_assumed": round(a.years_to_sale, 1)},
        "recovery": {"realisable_value": round(a.realisable_mid, -3), "realisable_value_stressed": round(a.realisable_low, -3),
                     "cost_of_funds": CFG["lender"]["cost_of_funds"], "recovery_cost": 0.05},
        "loss": {"loan_amount": plot["loan_amount"], "ltv_requested": round(a.ltv_requested, 2), "pd_12m_assumed": a.pd_12m,
                 "lgd": round(a.lgd, 2), "lgd_stressed": round(a.lgd_stressed, 2), "expected_loss_rate": round(a.el_rate, 4),
                 "expected_loss_amount": round(a.el_amount, -2), "ltv_band_low": round(a.ltv_band_low, 2),
                 "ltv_band_high": round(a.ltv_band_high, 2), "el_threshold": CFG["lender"]["el_threshold"]},
        "title": title,
        "hazards": {"flood_occurrence_pct": round(f["flood_occurrence_pct"], 1), "flood_band": band(f["flood_occurrence_pct"], (2, 10)),
                    "heat_days_per_year": round(f["heat_days"]), "heat_band": band(f["heat_days"], (45, 70)),
                    "rainfall_variability": round(f["rain_cv"], 2), "rain_band": band(f["rain_cv"], (0.28, 0.38)),
                    "slope_deg": round(f["slope_deg"], 1)},
        "access": {"road_access_km": round(f["road_access_km"], 1), "drive_time_city_min": round(f["drive_time_city_min"]),
                   "dist_sanand_town_km": round(f["dist_sanand_town_km"], 1), "dist_ahmedabad_km": round(f["dist_ahmedabad_km"], 1),
                   "repossession": band(f["road_access_km"], (0.5, 1.5)).replace("low", "easy").replace("high", "difficult")},
        "area": {"village_score": None if not len(vrow) else float(vrow.score.iloc[0]),
                 "village_drivers": None if not len(vrow) else vrow.drivers.iloc[0],
                 "district": "Ahmadabad", "district_score": float(D.loc[D.district == "Ahmadabad", "score"].iloc[0])},
        "pulse": pres,
        "pulse_series": [{"month": str(m.date()), "ndvi": round(n, 3), "ntl": round(t, 2), "built_index": round(b, 3)}
                         for m, n, t, b in zip(series.month, series.ndvi, series.ntl, series.built_index)],
        "red_flags": flags,
        "data_sources": [{"name": k, "mode": v["mode"], "access_date": v["access_date"]} for k, v in sorted(reg.items())
                         if v["mode"] != "template"],
        "limitations": [
            "SYNTHETIC DEMO: only the district and village boundaries are real. Satellite layers, auction listings, jantri "
            "rates and credit data are generated stand-ins, so every figure here illustrates the report, not the property.",
            "The plot location is a placeholder point, not a surveyed parcel.",
            "Default probability is a lender-set assumption until a partner loan book is used.",
            "Time to cash adds an assumed one year from default to first auction.",
            "No land-record document, court search or CERSAI search was run."],
        "definitions": {"heat_threshold_c": 40, "sale_window_days": 180, "activity_index_max": 100, "value_interval_pct": 80,
                        "pd_horizon_months": 12},
        "footer": FOOTER,
    }
    rep["prose"] = template_prose(rep)
    return rep


def template_prose(r: dict) -> dict:
    v, q, rc, ls, hz, ac, p = r["valuation"], r["liquidity"], r["recovery"], r["loss"], r["hazards"], r["access"], r["pulse"]
    days = f"a median of {q['median_days_to_sale']} days from listing" if q["median_days_to_sale"] else "more than half unsold in the observed window"
    out = {
        "summary": f"{r['plot']['asset_label']} of {r['plot']['area_sqm']:,} sq m in {r['plot']['village']}, {r['plot']['taluka']} taluka. "
                   f"Estimated value {inr(v['value_low'])} to {inr(v['value_high'])}. After a forced sale the lender would net about "
                   f"{inr(rc['realisable_value'])}. Suggested loan-to-value {pct(ls['ltv_band_low'])} to {pct(ls['ltv_band_high'])}.",
        "valuation": f"Central estimate {inr(v['value_mid'])} ({inr(v['value_per_sqm'])} per sq m), with an 80% range of {inr(v['value_low'])} to "
                     f"{inr(v['value_high'])}. The jantri value is {inr(v['jantri_value'])}, so the estimate is {v['value_to_jantri']} times jantri.",
        "liquidity": f"Chance of sale within 180 days of a bank auction listing: {pct(q['p_sold_180d'])}. Expected cut from the first reserve "
                     f"price: {pct(q['expected_haircut'])}. Time to sale: {days}. Allowing {q['years_to_cash_assumed']} years to cash, a "
                     f"{pct(rc['recovery_cost'])} recovery cost and {pct(rc['cost_of_funds'])} cost of funds, realisable value is "
                     f"{inr(rc['realisable_value'])}, or {inr(rc['realisable_value_stressed'])} at the low end of the value range.",
        "loss": f"Requested loan {inr(ls['loan_amount'])}, which is {pct(ls['ltv_requested'])} of the central value. With an assumed 12-month default "
                f"probability of {100 * ls['pd_12m_assumed']:.1f}%, loss given default is {pct(ls['lgd'])} ({pct(ls['lgd_stressed'])} stressed) and "
                f"expected loss is {100 * ls['expected_loss_rate']:.2f}% of the loan. The LTV band keeps expected loss under {pct(ls['el_threshold'])}.",
        "hazards": f"Flood history is {hz['flood_band']} (surface water in {hz['flood_occurrence_pct']}% of observed months). Extreme heat is "
                   f"{hz['heat_band']} ({hz['heat_days_per_year']} days a year above 40 C). Rainfall variability is {hz['rain_band']} ({hz['rainfall_variability']}).",
        "access": f"Nearest drivable road is {ac['road_access_km']} km away; Sanand town is {ac['dist_sanand_town_km']} km and Ahmedabad "
                  f"{ac['dist_ahmedabad_km']} km in a straight line. Repossession access looks {ac['repossession']}.",
        "pulse": f"Activity Index {p['activity_index']:.0f} out of 100. " + (" ".join(p["flags"]) if p["flags"] else "No anomaly this month."),
    }
    return out


def numbers_supported(text: str, report: dict) -> list[str]:
    """Numbers in `text` that cannot be traced to the report JSON (prose excluded). Empty list = pass."""
    facts = {k: v for k, v in report.items() if k != "prose"}
    raw = json.dumps(facts, default=str)
    allowed = set(re.findall(r"\d+(?:\.\d+)?", raw.replace(",", "")))
    vals = [float(x) for x in allowed]
    bad = []
    for tok in re.findall(r"\d+(?:\.\d+)?", text.replace(",", "")):
        t = float(tok)
        ok = tok in allowed or any(abs(t - s * v) <= tol * max(abs(t), 1e-9) for v in vals
                                   for s, tol in ((1, 0.006), (100, 0.006), (1e-5, 0.06), (1e-7, 0.006)))
        if not ok:
            bad.append(tok)
    return bad


def llm_prose(rep: dict) -> dict | None:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return None
    try:
        import anthropic

        facts = {k: v for k, v in rep.items() if k not in ("prose", "pulse_series", "data_sources")}
        msg = anthropic.Anthropic(api_key=key).messages.create(
            model=os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5"), max_tokens=1500,
            messages=[{"role": "user", "content": "Write a plain-language collateral report for a credit officer. Use ONLY numbers present in "
                       "this JSON; do not compute new ones. Return JSON with keys " + ", ".join(rep["prose"]) + ", each two or three sentences.\n"
                       + json.dumps(facts, default=str)}])
        raw = msg.content[0].text
        out = json.loads(raw[raw.index("{"): raw.rindex("}") + 1])
        if set(out) == set(rep["prose"]) and not numbers_supported(" ".join(out.values()), rep):
            return out
    except Exception as e:
        print("llm prose skipped:", e)
    return None


def render(rep: dict) -> tuple[str, bytes]:
    series = pd.DataFrame(rep["pulse_series"])
    series["month"] = pd.to_datetime(series.month)
    village = None
    if rep["plot"]["kind"] == "farm":
        vm = pd.read_parquet(DEMO / "village_monthly.parquet")
        V = pd.read_parquet(DEMO / "scores_village.parquet")
        vid = V.loc[V.village == rep["plot"]["village"], "village_id"]
        village = vm[vm.village_id == vid.iloc[0]] if len(vid) else None
    chart = viz.b64(viz.pulse_chart(series, rep["plot"]["kind"], village))
    html = Template((ROOT / "bhoomipulse" / "report" / "template.html").read_text()).render(
        r=rep, chart=chart, inr=inr, pct=pct, metrics=load_metrics())
    from weasyprint import HTML

    return html, HTML(string=html).write_pdf()


def main() -> None:
    ensure_dirs()
    OUT.mkdir(parents=True, exist_ok=True)
    for plot in CFG["plots"]:
        rep = build_json(plot)
        bad = numbers_supported(" ".join(rep["prose"].values()), rep)
        assert not bad, f"prose numbers not in JSON: {bad}"
        better = llm_prose(rep)
        if better:
            rep["prose"], rep["prose_author"] = better, "LLM (numbers checked against JSON)"
        else:
            rep["prose_author"] = "template"
        (OUT / f"{plot['id']}.json").write_text(json.dumps(rep, indent=1, default=str))
        html, pdf = render(rep)
        (OUT / f"{plot['id']}.html").write_text(html)
        (OUT / f"{plot['id']}.pdf").write_bytes(pdf)
        print(f"report {plot['id']}: value {inr(rep['valuation']['value_mid'])}, flags {len(rep['red_flags'])}")
    from . import validation

    validation.main()


if __name__ == "__main__":
    main()
