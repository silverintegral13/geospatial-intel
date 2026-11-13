"""Static demo site for GitHub Pages, built only from committed demo data."""
from __future__ import annotations

import json
import os
import shutil

import folium
import markdown
import pandas as pd

from .. import geo, sources, viz
from ..config import CFG, DEMO, MODELS, REPORTS, ROOT, SITE
from . import assets

REPO = "https://github.com/silverintegral13/geospatial-intel"
APP_URL = os.environ.get("APP_URL", "")
RAMP = ["#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#0d366b"]
CSS = """
:root{--ink:#0b0b0b;--ink2:#52514e;--line:#e6e5e0;--bg:#f9f9f7;--card:#fcfcfb;--blue:#1c5cab}
*{box-sizing:border-box}body{margin:0;font:15px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif;color:var(--ink);background:var(--bg)}
header{background:var(--card);border-bottom:1px solid var(--line)}.wrap{max-width:1040px;margin:0 auto;padding:0 20px}
nav{display:flex;gap:18px;flex-wrap:wrap;align-items:center;padding:12px 0}nav a{color:var(--ink2);text-decoration:none;font-size:14px}
nav a:hover,nav a.on{color:var(--blue)}nav .brand{font-weight:700;color:var(--ink);font-size:16px;margin-right:8px}
.banner{background:#fff4d6;border-bottom:1px solid #c98500;color:#5c3d00;font-size:13.5px;padding:8px 0}
h1{font-size:28px;line-height:1.2;margin:28px 0 8px}h2{font-size:19px;margin:28px 0 8px}p.lead{font-size:17px;color:var(--ink2);max-width:760px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px;margin:16px 0}
.card{background:var(--card);border:1px solid var(--line);border-radius:8px;padding:14px 16px}.card b.n{display:block;font-size:24px}
.card span{color:var(--ink2);font-size:13px}.card a{color:var(--blue);font-weight:600;text-decoration:none}
table{border-collapse:collapse;width:100%;background:var(--card);font-size:13.5px}th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--ink2);font-weight:600}.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:8px}
img.chart{max-width:100%;border:1px solid var(--line);border-radius:8px;background:var(--card)}
iframe.map{width:100%;height:620px;border:1px solid var(--line);border-radius:8px}
.tag{display:inline-block;font-size:11.5px;padding:1px 7px;border-radius:10px;border:1px solid var(--line);color:var(--ink2)}
.tag.synthetic{background:#fff4d6;border-color:#c98500;color:#5c3d00}.tag.live,.tag.manual{background:#e3f4e3;border-color:#0ca30c;color:#0a5c0a}
footer{color:var(--ink2);font-size:13px;margin:36px 0 28px}blockquote{margin:12px 0;padding:8px 14px;border-left:3px solid #c98500;background:#fff9e8}
a{color:var(--blue)}code{background:#efeeea;padding:1px 4px;border-radius:3px;font-size:13px}
"""
NAV = [("index.html", "Overview"), ("district.html", "Districts"), ("village.html", "Sanand villages"), ("reports.html", "Plot reports"),
       ("pulse.html", "Pulse"), ("nbfc.html", "NBFC lab"), ("metrics.html", "Metrics"), ("cards.html", "Model cards"), ("sources.html", "Data sources")]


def page(name: str, title: str, body: str) -> None:
    nav = "".join(f'<a href="{h}"{" class=on" if h == name else ""}>{t}</a>' for h, t in NAV)
    html = f"""<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title} · BhoomiPulse</title><style>{CSS}</style></head><body>
<div class="banner"><div class="wrap"><b>SYNTHETIC DEMO.</b> Only the district and village boundaries are real. Every score, value, auction and loan on this site is generated stand-in data.</div></div>
<header><div class="wrap"><nav><a class="brand" href="index.html">BhoomiPulse</a>{nav}<a href="{REPO}">GitHub</a></nav></div></header>
<main class="wrap">{body}</main>
<footer class="wrap">Prototype for a course project. AI-assisted second opinion; does not replace a registered valuer. Code: MIT. Each dataset keeps its own licence.</footer>
</body></html>"""
    (SITE / name).write_text(html)


def color(score: float) -> str:
    return RAMP[min(int(score // 20), 4)]


def legend() -> str:
    cells = "".join(f'<span style="display:inline-block;width:34px;height:10px;background:{c}"></span>' for c in RAMP)
    return (f'<div style="position:fixed;bottom:18px;left:18px;z-index:9999;background:#fcfcfb;border:1px solid #e6e5e0;border-radius:6px;'
            f'padding:8px 10px;font:12px system-ui">Collateral-quality score<br>{cells}<br>'
            f'<span style="display:flex;justify-content:space-between"><span>0 weaker</span><span>100 stronger</span></span></div>')


def fmap(gdf, name_col: str, fields: list[str], aliases: list[str], zoom: int, markers: bool = False) -> str:
    c = gdf.geometry.union_all().centroid
    m = folium.Map(location=[c.y, c.x], zoom_start=zoom, tiles="OpenStreetMap")
    folium.GeoJson(gdf, style_function=lambda f: {"fillColor": color(f["properties"]["score"]), "color": "#fcfcfb", "weight": 1, "fillOpacity": 0.82},
                   highlight_function=lambda f: {"weight": 3, "color": "#0b0b0b"},
                   tooltip=folium.GeoJsonTooltip(fields=fields, aliases=aliases, sticky=True)).add_to(m)
    if markers:
        for p in CFG["plots"]:
            folium.Marker([p["lat"], p["lon"]], tooltip=p["label"], popup=f'<a href="reports/{p["id"]}.html" target="_top">Open report</a>',
                          icon=folium.Icon(color="orange", icon="info-sign")).add_to(m)
    m.get_root().html.add_child(folium.Element(legend()))
    return m.get_root().render()


def table(df: pd.DataFrame) -> str:
    return '<div class="tablewrap">' + df.to_html(index=False, escape=False, border=0) + "</div>"


def main() -> None:
    if SITE.exists():
        shutil.rmtree(SITE)
    (SITE / "reports").mkdir(parents=True)
    (SITE / "img").mkdir()
    (SITE / ".nojekyll").write_text("")
    m = json.loads((MODELS / "metrics.json").read_text())
    reg = sources.load()
    n = {k: sum(1 for v in reg.values() if v["mode"] == k) for k in ("live", "manual", "synthetic", "template")}

    # maps
    D = geo.load_districts().merge(pd.read_parquet(DEMO / "scores_district.parquet")[["district", "score", "drivers"]], on="district")
    (SITE / "map_district.html").write_text(fmap(D, "district", ["district", "score", "drivers"], ["District", "Score", "Top drivers"], 7))
    V = geo.load_villages().merge(pd.read_parquet(DEMO / "scores_village.parquet")[["village_id", "score", "drivers"]], on="village_id")
    (SITE / "map_village.html").write_text(fmap(V, "village", ["village", "score", "drivers"], ["Village", "Score", "Adjustment vs district"], 11, markers=True))

    # charts
    for name, fig in [("district_map", assets.district_map()), ("village_map", assets.village_map()), ("liquidity", assets.liquidity_chart()),
                      ("nbfc", assets.nbfc_chart())]:
        viz.save(fig, SITE / "img" / f"{name}.png")
    for p in CFG["plots"]:
        viz.save(assets.pulse_chart(p["id"]), SITE / "img" / f"pulse_{p['id']}.png")

    # reports (render from committed JSON)
    from ..report.build import inr, pct, render
    cards = ""
    for p in CFG["plots"]:
        rep = json.loads((REPORTS / "plots" / f"{p['id']}.json").read_text())
        html, pdf = render(rep)
        (SITE / "reports" / f"{p['id']}.html").write_text(html)
        (SITE / "reports" / f"{p['id']}.pdf").write_bytes(pdf)
        cards += (f'<div class="card"><span>{rep["plot"]["asset_label"]} · {rep["plot"]["village"]}</span><b class="n">{inr(rep["valuation"]["value_low"])} – {inr(rep["valuation"]["value_high"])}</b>'
                  f'<span>Realisable {inr(rep["recovery"]["realisable_value"])} · LTV band {pct(rep["loss"]["ltv_band_low"])}–{pct(rep["loss"]["ltv_band_high"])} · '
                  f'{len(rep["red_flags"])} red flag(s)</span><br><a href="reports/{p["id"]}.html">Open report</a> · <a href="reports/{p["id"]}.pdf">PDF</a></div>')

    app = f'<a href="{APP_URL}">Open the live app</a>' if APP_URL else "Live app: not deployed yet (see the README for the two-minute deploy steps)."
    nb = m["nbfc_lab"]["models"]
    page("index.html", "Overview", f"""
<h1>What will pledged collateral actually fetch after a default?</h1>
<p class="lead">BhoomiPulse is a prototype of collateral recovery intelligence for Indian lenders: a value range, the realisable value after a forced sale,
title and hazard checks, and a monthly activity Pulse for land, property and factories.</p>
<div class="grid">
<div class="card"><b class="n">33 + 67</b><span>Real boundaries: Gujarat districts and Sanand taluka villages</span></div>
<div class="card"><b class="n">{n['synthetic']} of {len(reg)}</b><span>Data sources on a SYNTHETIC fallback in this build</span></div>
<div class="card"><b class="n">{nb['champion']['gini']:.2f} → {nb['challenger']['gini']:.2f}</b><span>Default-model Gini, existing score vs challenger (synthetic book; lift is built in)</span></div>
<div class="card"><b class="n">3</b><span>Plot-level collateral reports with PDF</span></div></div>
<blockquote>The hosts for satellite imagery, auctions, land records and credit data could not be reached where this was built, so those layers are generated.
The numbers show that the pipeline works end to end. They are not evidence about real property. Run <code>make data</code> on a machine with internet to swap in live layers.</blockquote>
<h2>Explore</h2><div class="grid">
<div class="card"><a href="district.html">District map</a><br><span>Collateral-quality score for Gujarat</span></div>
<div class="card"><a href="village.html">Sanand villages</a><br><span>Village drill-down with the three plots</span></div>
<div class="card"><a href="reports.html">Plot reports</a><br><span>Value range, realisable value, LTV band, red flags</span></div>
<div class="card"><a href="pulse.html">Pulse</a><br><span>Monthly monitoring after disbursal</span></div>
<div class="card"><a href="nbfc.html">NBFC lab</a><br><span>Champion vs challenger on a loan book</span></div>
<div class="card"><a href="metrics.html">Metrics and validation</a><br><span>Hold-out results, weak ones included</span></div></div>
<p>{app}</p>""")
    page("district.html", "Districts", f"""<h1>Collateral-quality score by district</h1>
<p class="lead">Hover a district for its score and top drivers. {CFG['district_note']}</p>
<iframe class="map" src="map_district.html" title="District map"></iframe>
<h2>Table view</h2>{table(D[['district', 'score', 'drivers']].sort_values('score', ascending=False).rename(columns={'district': 'District', 'score': 'Score', 'drivers': 'Top drivers'}))}""")
    page("village.html", "Sanand villages", f"""<h1>Sanand taluka: village drill-down</h1>
<p class="lead">Village score = Ahmadabad district score, shifted by road access, flood history, night-light growth and built-up growth. Orange pins are the three placeholder plots.</p>
<iframe class="map" src="map_village.html" title="Village map"></iframe>
<h2>Table view</h2>{table(V[['village', 'score', 'drivers']].sort_values('score', ascending=False).rename(columns={'village': 'Village', 'score': 'Score', 'drivers': 'Adjustment vs district (points)'}))}""")
    page("reports.html", "Plot reports", f"""<h1>Plot-level collateral reports</h1>
<p class="lead">Each report is built as JSON first; the text is written only from that JSON and every number is checked against it.</p><div class="grid">{cards}</div>""")
    pulse = json.loads((DEMO / "pulse_plots.json").read_text())
    pb = "".join(f'<h2>{p["label"]}</h2><p><b>Activity Index {pulse[p["id"]]["activity_index"]:.0f} / 100.</b> '
                 f'{" ".join(pulse[p["id"]]["flags"]) or "No anomaly this month."} <span class="tag synthetic">{pulse[p["id"]]["scenario_note"]}</span></p>'
                 f'<img class="chart" src="img/pulse_{p["id"]}.png" alt="Pulse chart for {p["id"]}">' for p in CFG["plots"])
    page("pulse.html", "Pulse", f"""<h1>Pulse: monthly monitoring after the loan is given</h1>
<p class="lead">Farm: did the plot green up after the sowing window? Property: is construction moving? Factory: are night lights holding up?
At 10 m resolution, imagery cannot count trucks; that needs paid high-resolution data.</p>{pb}""")
    R = json.loads((DEMO / "nbfc_results.json").read_text())
    swap = pd.DataFrame([{"Group": k, "Loans": v["loans"], "Default rate": f'{v["default_rate"]:.1%}'} for k, v in R["swap_set"].items()])
    grid = pd.DataFrame(R["ltv_grid"]).rename(columns={"district": "District"})
    lg = R["lgd"]
    page("nbfc.html", "NBFC lab", f"""<h1>NBFC lab: does collateral data beat the existing score?</h1>
<p class="lead">A loan book goes in; collateral features are attached to each loan; three models are compared on later loans.</p>
<blockquote><b>Synthetic book.</b> Collateral conditions were written into the default formula of the generated book, so the challenger's lift is an assumption, not a finding.
The lab shows what a lender would receive after sharing a real book.</blockquote>
<img class="chart" src="img/nbfc.png" alt="Gini by model">
<h2>Swap set at the same {R['approve_share']:.0%} approval rate</h2>{table(swap)}
<p>At the champion's default rate among approved loans ({R['champion_default_rate_at_approval']:.1%}), the challenger could approve {R['challenger_approval_at_same_default_rate']:.0%} of applicants instead of {R['approve_share']:.0%}.</p>
<h2>Loss given default on {lg['resolved_defaults_test']} resolved test defaults</h2>
<p>Mean absolute error: {lg['mae_flat_lgd']:.3f} with a flat LGD assumption, {lg['mae_collateral_lgd']:.3f} with the collateral-based estimate.</p>
<h2>Risk-adjusted LTV grid (median conservative LTV)</h2>{table(grid)}
<h2>Data-quality report on the book</h2>{table(pd.DataFrame([{"Check": k.replace('_', ' '), "Result": (f'{v:.1%}' if isinstance(v, float) and v <= 1 else v)} for k, v in R['quality'].items() if v is not None]))}""")
    T = assets.metrics_table().rename(columns=str.title)
    val = markdown.markdown((REPORTS / "validation.md").read_text(), extensions=["tables"])
    page("metrics.html", "Metrics", f"""<h1>Metrics and validation</h1>{table(T)}
<img class="chart" src="img/liquidity.png" alt="Sold within 180 days by asset type"><hr>{val}""")
    cards_html = "".join(f'<div class="card" style="margin:14px 0">{markdown.markdown(f.read_text(), extensions=["tables"])}</div>'
                         for f in sorted((MODELS / "cards").glob("*.md")))
    page("cards.html", "Model cards", f"<h1>Model cards</h1>{cards_html}")
    S = pd.DataFrame([{"Source": f'<a href="{v["url"]}">{k}</a>', "Status": f'<span class="tag {v["mode"]}">{v["mode"]}</span>', "Rows": f'{v["rows"]:,}',
                       "Licence": v["licence"] + (" · prototype-only" if v["prototype_only"] else ""), "Used for": v["use"], "Note": v["note"]}
                      for k, v in sorted(reg.items(), key=lambda kv: ("live manual synthetic template".split().index(kv[1]["mode"]), kv[0]))])
    page("sources.html", "Data sources", f"""<h1>Data sources and licences</h1>
<p class="lead">{n['live']} live, {n['manual']} hand-transcribed, {n['synthetic']} on a synthetic fallback, {n['template']} not collected (template only).</p>{table(S)}
<p>Not used in this build: SHRUG (non-commercial licence) and the Freddie Mac loan-level data (no redistribution). Both would be prototype-only.</p>""")
    print(f"site: {len(list(SITE.rglob('*')))} files in {SITE.relative_to(ROOT)}/")


if __name__ == "__main__":
    main()
