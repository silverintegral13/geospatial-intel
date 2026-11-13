"""Fast tests on the committed demo data (no network, no credentials)."""
import importlib.util
import json
from pathlib import Path

import pandas as pd
import pytest
import yaml

from bhoomipulse import chat, geo
from bhoomipulse.config import CFG, DEMO, MODELS, REPORTS, ROOT
from bhoomipulse.features.build import FEATURES
from bhoomipulse.models import common, predict
from bhoomipulse.models import expected_loss as el
from bhoomipulse.nbfc import lab
from bhoomipulse.pulse import pulse
from bhoomipulse.report.build import FOOTER, numbers_supported
from bhoomipulse.title.boundary import compare


def test_no_demographic_features():
    used = FEATURES + common.X_COLS + lab.LENDER + lab.COLLATERAL
    assert not [c for c in used if any(f in c.lower() for f in common.FORBIDDEN)]


def test_expected_loss_math():
    r = el.realisable_value(100.0, haircut=0.2, years_to_sale=1.0, r=0.10, recovery_cost=0.05)
    assert r == pytest.approx(100 * 0.8 * 0.95 / 1.1)
    assert el.lgd(100.0, 60.0) == pytest.approx(0.4)
    assert el.lgd(50.0, 60.0) == 0.0
    loan = el.max_loan(60.0, pd_=0.05, threshold=0.02)        # PD x LGD == threshold at the limit
    assert 0.05 * el.lgd(loan, 60.0) == pytest.approx(0.02)
    lo, hi = el.ltv_band(80.0, 100.0, 0.2, 1.5, 0.06)
    assert 0 < lo <= hi <= 0.75


def test_assessment_is_ordered_and_bounded():
    a = predict.assess_frame(pd.read_parquet(DEMO / "features_plot.parquet"))
    assert (a.value_low < a.value_mid).all() and (a.value_mid < a.value_high).all()
    assert a.p_sold_180d.between(0, 1).all() and a.haircut.between(0, 0.9).all()
    assert (a.realisable_mid < a.value_mid).all()


def test_report_numbers_come_from_json():
    for p in CFG["plots"]:
        rep = json.loads((REPORTS / "plots" / f"{p['id']}.json").read_text())
        assert numbers_supported(" ".join(rep["prose"].values()), rep) == []
        assert rep["footer"] == FOOTER
        assert numbers_supported("The value is Rs 987.65 crore.", rep) == ["987.65"]     # an invented number is caught


def test_synthetic_data_is_labelled():
    assert pd.read_parquet(DEMO / "listings.parquet").synthetic.all()
    assert pd.read_parquet(DEMO / "nbfc_book_synthetic.parquet").synthetic.all()
    reg = yaml.safe_load((ROOT / "data" / "sources.yaml").read_text())
    assert all(v["mode"] in {"live", "manual", "synthetic", "template"} for v in reg.values())
    assert all(v["url"] and v["licence"] and v["access_date"] for v in reg.values())
    for card in ("liquidity", "avm", "area_score", "pd_demo", "nbfc_challenger"):
        assert "SYNTHETIC" in (MODELS / "cards" / f"{card}.md").read_text()


def test_boundaries_are_real_and_complete():
    assert len(geo.load_districts()) == 33
    v = geo.load_villages()
    assert len(v) == 67 and "Sanand" in set(v.village)
    assert len(pd.read_parquet(DEMO / "features_h3.parquet")) > 1000


def test_boundary_check_flags_mismatch():
    a = geo.square(22.99, 72.38, 10000)
    assert not compare(a, a)["flag"]
    assert compare(a, geo.square(22.9905, 72.3805, 10000))["flag"]


def test_pulse_flags_the_scripted_factory_slowdown():
    res, _ = pulse.plot_pulse(next(p for p in CFG["plots"] if p["kind"] == "factory"))
    assert res["flags"] and res["synthetic"]


def test_nbfc_lab_validates_and_runs():
    book = pd.read_parquet(DEMO / "nbfc_book_synthetic.parquet")
    assert lab.validate(book.drop(columns=["bureau_score"])) == ["missing column: bureau_score"]
    res, scored = lab.run_lab(book.sample(6000, random_state=1))
    assert set(res["models"]) == {"champion", "refit", "challenger"}
    assert not scored.loan_id.str.startswith("SYNL").any()        # ids are pseudonymised
    assert res["forbidden_features_used"] == []


def test_chat_answers_from_tools():
    assert "score" in chat.route("which districts in my book have weak collateral?")
    assert "Surat" in chat.route("what is the score of Surat")


def test_public_repo_guard_patterns():
    spec = importlib.util.spec_from_file_location("guard", Path(ROOT) / "scripts" / "precommit_guard.py")
    g = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(g)
    assert g.check(".env", b"X=1") and g.check("data/raw/a.parquet", b"") and g.check("x/freddie_sample.txt", b"")
    assert g.check("notes.md", b"key sk-ant-" + b"a" * 30)
    assert g.check(".env.example", b"X=") == [] and g.check("README.md", b"hello") == []


# ------------------------------------------------------------ portal parsers
FIX = Path(__file__).parent / "fixtures"


def test_notice_parser_reads_fields_and_converts_units():
    from bhoomipulse.ingest import parsers

    a = parsers.parse_notice((FIX / "notice_flat.txt").read_text())
    assert (a["bank"], a["asset_type"], a["district"], a["possession"]) == ("Bank of Baroda", "residential", "Ahmadabad", "physical")
    assert a["reserve_price"] == 3610000 and a["emd"] == 361000 and a["bid_increment"] == 25000
    assert a["area_sqm"] == pytest.approx(1198 * 0.092903, abs=0.1) and a["auction_date"] == "2026-01-21" and a["missing"] == ""
    b = parsers.parse_notice((FIX / "notice_shed.txt").read_text())
    assert (b["asset_type"], b["district"], b["area_sqm"]) == ("industrial", "Panch Mahals", 2400.0)
    assert b["reserve_price"] == 1.85e7 and b["emd"] == 18.5e5 and b["auction_date"] == "2026-02-05"


def test_notice_parser_never_guesses():
    from bhoomipulse.ingest import parsers

    c = parsers.parse_notice((FIX / "notice_incomplete.txt").read_text())
    assert c["area_sqm"] is None and c["area_raw"] == "3 Vigha"          # local unit: not converted
    assert c["auction_date"] is None and set(c["missing"].split(",")) == {"area_sqm", "auction_date"}
    assert c["asset_type"] == "agri_land" and c["reserve_price"] == 4200000


def test_relistings_are_linked_into_rounds():
    from bhoomipulse.ingest import parsers

    rows = [parsers.parse_notice((FIX / f).read_text(), source=f) for f in ("notice_flat.txt", "notice_flat_relist.html", "notice_shed.txt")]
    assert rows[1]["reserve_price"] == 3249000                             # HTML stripped; script text ignored
    L, R = parsers.link_relistings(pd.DataFrame(rows))
    flat = L[L.listing_id == "BOBA1234567"].iloc[0]
    assert len(L) == 2 and flat.n_rounds == 2 and flat.reserve_first == 3610000 and flat.reserve_last == 3249000
    assert flat.sold is None and len(R) == 3                               # outcome is never inferred


def test_html_table_parser_maps_headers():
    from bhoomipulse.ingest import parsers

    j = parsers.parse_html_tables((FIX / "jantri_page.html").read_text(), "jantri")
    assert list(j.village) == ["Bol", "Bol"] and list(j.rate_rs_per_sqm) == [1250.0, 6400.0]
    assert list(j.survey_number_or_zone) == ["101", "Zone 3"] and j.effective_date.isna().all()
    with pytest.raises(ValueError):
        parsers.parse_html_tables("<table><tr><th>a</th></tr><tr><td>1</td></tr></table>", "jantri")


def test_parsed_listings_flow_into_model_columns():
    from bhoomipulse.ingest import parsers, tables

    rows = [parsers.parse_notice((FIX / f).read_text(), source=f) for f in ("notice_flat.txt", "notice_flat_relist.html", "notice_shed.txt")]
    gz = pd.DataFrame({"district": ["Ahmadabad", "Panch Mahals"], "lat": [22.7, 22.7], "lon": [72.3, 73.6]})
    L, _ = parsers.link_relistings(pd.DataFrame(rows), gz)
    assert not L.listing_id.astype(str).str.contains("nan").any()
    m = tables.normalise_listings(L)
    assert len(m) == 2 and not m.sold.any() and not m.synthetic.any()
    flat = m[m.listing_id == "BOBA1234567"].iloc[0]
    assert flat.haircut_pct == pytest.approx(1 - 3249000 / 3610000) and flat.final_price == 3249000 and flat.duration_days > 180
