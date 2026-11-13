"""Tabular sources: auctions (BAANKNET), jantri, district credit stress, IBBI, NABARD, RERA.

Each has a hand-fill CSV template. If a filled CSV exists in data/manual/ it is
used (mode=manual); otherwise a labelled SYNTHETIC fallback is generated.
"""
from __future__ import annotations

import pandas as pd

from .. import geo, sources, synth
from ..config import ASSET_TYPES, INTERIM, MANUAL, TEMPLATES

TEMPLATE_COLS = {
    "baanknet_listings": ["listing_id", "bank", "asset_type", "district", "locality", "address_text", "lat", "lon",
                          "geocode_confidence", "area_sqm", "reserve_first", "reserve_last", "emd", "listed_date",
                          "last_auction_date", "n_rounds", "sold", "final_price"],
    "jantri": ["village", "survey_number_or_zone", "land_use", "rate_rs_per_sqm", "effective_date"],
    "district_credit": ["district", "fy", "npa_ratio_pct", "agri_share_credit", "source_document"],
    "nabard_plp": ["district", "fy", "sector", "credit_potential_rs_crore"],
    "rera_projects": ["rera_id", "project", "district", "lat", "lon", "status", "quarter", "percent_complete"],
    "ecourts_cases": ["village", "survey_number", "case_type", "filing_year", "status"],
    "validation": ["plot_id", "source", "value_rs", "date", "note"],
}
URLS = {
    "baanknet_listings": "https://baanknet.com", "jantri": "https://garvi.gujarat.gov.in",
    "district_credit": "https://slbcgujarat.in", "nabard_plp": "https://www.nabard.org",
    "rera_projects": "https://gujrera.gujarat.gov.in", "ecourts_cases": "https://ecourts.gov.in",
}


def write_templates() -> None:
    TEMPLATES.mkdir(parents=True, exist_ok=True)
    for name, cols in TEMPLATE_COLS.items():
        (TEMPLATES / f"{name}.template.csv").write_text(",".join(cols) + "\n")


def _manual(name: str) -> pd.DataFrame | None:
    f = MANUAL / f"{name}.csv"
    if f.exists():
        df = pd.read_csv(f)
        if len(df):
            return df
    return None


def run() -> None:
    write_templates()
    districts, villages = geo.load_districts(), geo.load_villages()

    # --- auctions
    m = _manual("baanknet_listings")
    if m is not None:
        m["synthetic"] = False
        m.to_parquet(INTERIM / "listings.parquet")
        sources.record("BAANKNET e-auction listings", url=URLS["baanknet_listings"], licence="Public portal; terms apply",
                       rows=len(m), mode="manual", use="Liquidity, haircut and valuation labels")
    else:
        L, R = synth.generate_listings(districts)
        L.to_parquet(INTERIM / "listings.parquet")
        R.to_parquet(INTERIM / "listing_rounds.parquet")
        sources.record("BAANKNET e-auction listings", url=URLS["baanknet_listings"], licence="Public portal; terms apply",
                       rows=len(L), mode="synthetic", use="Liquidity, haircut and valuation labels",
                       note="Portal unreachable from the build environment. SYNTHETIC listings generated; "
                            "fill data/manual/baanknet_listings.csv from the template to replace them.")

    # --- jantri
    m = _manual("jantri")
    if m is not None:
        m["synthetic"] = False
        m.to_parquet(INTERIM / "jantri.parquet")
        sources.record("Jantri rates (Garvi Gujarat)", url=URLS["jantri"], licence="Public portal; terms apply",
                       rows=len(m), mode="manual", use="Government floor value")
    else:
        c = villages.geometry.representative_point()
        d = synth.static_fields(c.y.to_numpy(), c.x.to_numpy())
        rows = []
        for at, lu in zip(ASSET_TYPES, ["agriculture", "residential", "commercial", "industrial", "open_plot"]):
            rate = synth.latent_value_sqm(d, at) * synth.jantri_ratio(d)
            rows.append(pd.DataFrame({"village_id": villages.village_id, "village": villages.village,
                                      "asset_type": at, "land_use": lu, "rate_rs_per_sqm": rate.round(-1)}))
        J = pd.concat(rows, ignore_index=True)
        J["synthetic"] = True
        J.to_parquet(INTERIM / "jantri.parquet")
        sources.record("Jantri rates (Garvi Gujarat)", url=URLS["jantri"], licence="Public portal; terms apply",
                       rows=len(J), mode="synthetic", use="Government floor value",
                       note="SYNTHETIC rates (30-80 % of the synthetic market value). Fill data/manual/jantri.csv.")

    # --- district credit stress
    m = _manual("district_credit")
    P = synth.generate_district_panel(districts)
    if m is not None:
        P = P.drop(columns=["npa_ratio_pct", "agri_share_credit"]).merge(m, on=["district", "fy"])
        P["synthetic"] = False
    P.to_parquet(INTERIM / "district_panel.parquet")
    sources.record("SLBC Gujarat / RBI BSR district credit and NPA tables", url=URLS["district_credit"],
                   licence="Public documents", rows=len(P), mode="manual" if m is not None else "synthetic",
                   use="Target for the area collateral score",
                   note="" if m is not None else "SYNTHETIC district-year NPA ratios. Transcribe SLBC booklets into "
                                                 "data/manual/district_credit.csv to replace them.")

    # --- IBBI (real, hand-transcribed)
    f = MANUAL / "ibbi_recovery.csv"
    if f.exists():
        ib = pd.read_csv(f)
        ib.to_parquet(INTERIM / "ibbi_recovery.parquet")
        sources.record("IBBI quarterly newsletter: CIRP recoveries", url="https://ibbi.gov.in/en/publication",
                       licence="Public document", rows=len(ib), mode="manual", use="Corporate / MSME recovery prior",
                       note="REAL figures, transcribed from press reports of the IBBI newsletter; verify against the PDF.")

    for name, use in [("nabard_plp", "District credit potential"), ("rera_projects", "Property Pulse ground truth"),
                      ("ecourts_cases", "Dispute risk")]:
        m = _manual(name)
        if m is not None:
            m.to_parquet(INTERIM / f"{name}.parquet")
        sources.record({"nabard_plp": "NABARD Potential Linked Credit Plans", "rera_projects": "Gujarat RERA projects",
                        "ecourts_cases": "eCourts case metadata"}[name], url=URLS[name], licence="Public portal / document",
                       rows=0 if m is None else len(m), mode="template" if m is None else "manual", use=use,
                       note="Not collected. Empty template in data/templates/; fields that depend on it are left blank."
                       if m is None else "")
    print("tables: done")
