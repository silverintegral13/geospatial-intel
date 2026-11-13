"""Turn saved portal pages or notices into the manual CSVs that `make data` reads.

  # auction notices: .txt, .html or .pdf files you saved, one notice per file
  python -m bhoomipulse.ingest.parse_saved notices data/manual/saved_notices/

  # or a text file of listing URLs, fetched politely (robots.txt, >= 5 s gap, cached)
  python -m bhoomipulse.ingest.parse_saved notices --urls data/manual/notice_urls.txt

  # a saved page with a table (jantri, rera_projects, district_credit)
  python -m bhoomipulse.ingest.parse_saved table jantri data/manual/saved_pages/jantri_sanand.html

Output goes to data/manual/ (git-ignored). Rows missing a required field are written to
*_needs_review.csv instead of being guessed. Fill `sold` and `final_price` by hand where known.
"""
from __future__ import annotations

import subprocess
import sys
from pathlib import Path

import pandas as pd

from .. import geo
from ..config import MANUAL
from . import parsers


def _read(path: Path) -> str:
    if path.suffix.lower() == ".pdf":
        return subprocess.run(["pdftotext", "-layout", str(path), "-"], check=True, capture_output=True, text=True).stdout
    return path.read_text(errors="ignore")


def gazetteer() -> pd.DataFrame:
    d = geo.load_districts()
    c = d.geometry.representative_point()
    return pd.DataFrame({"district": d.district, "lat": c.y.round(5), "lon": c.x.round(5)})


def notices(args: list[str]) -> None:
    rows = []
    if args and args[0] == "--urls":
        from .portal import polite_get

        for url in Path(args[1]).read_text().split():
            try:
                rows.append(parsers.parse_notice(polite_get(url), source=url))
            except Exception as e:
                print(f"skip {url}: {type(e).__name__}: {e}")
    else:
        for f in sorted(Path(args[0]).iterdir()):
            if f.suffix.lower() in (".txt", ".html", ".htm", ".pdf"):
                rows.append(parsers.parse_notice(_read(f), source=f.name))
    N = pd.DataFrame(rows)
    if N.empty:
        sys.exit("no notices found")
    good, bad = N[N.missing == ""], N[N.missing != ""]
    MANUAL.mkdir(parents=True, exist_ok=True)
    if len(bad):
        bad.to_csv(MANUAL / "baanknet_needs_review.csv", index=False)
    if len(good):
        L, R = parsers.link_relistings(good, gazetteer())
        L.to_csv(MANUAL / "baanknet_listings.csv", index=False)
        R.to_csv(MANUAL / "baanknet_rounds.csv", index=False)
        print(f"{len(good)} notices -> {len(L)} properties ({int((L.n_rounds > 1).sum())} re-listed) in data/manual/baanknet_listings.csv")
    print(f"{len(bad)} notices need review (missing fields) -> data/manual/baanknet_needs_review.csv" if len(bad) else "no notices need review")
    print("Geocoding is district-centre only (confidence 0.5). Add exact lat/lon where you can. Fill `sold` and `final_price` where known.")


def table(args: list[str]) -> None:
    template, path = args[0], Path(args[1])
    df = parsers.parse_html_tables(path.read_text(errors="ignore"), template)
    out = MANUAL / f"{template}.csv"
    df.to_csv(out, index=False)
    print(f"{len(df)} rows -> {out}; empty columns: {[c for c in df if df[c].isna().all()]}")


if __name__ == "__main__":
    {"notices": notices, "table": table}[sys.argv[1]](sys.argv[2:])
