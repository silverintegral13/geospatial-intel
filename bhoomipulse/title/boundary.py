"""M4 Title health, part 2: does the boundary on record match the land as farmed or built?"""
from __future__ import annotations

from shapely import affinity

from .. import geo
from ..config import rng


def compare(record_poly, observed_poly) -> dict:
    a, b = geo.area_sqm(record_poly), geo.area_sqm(observed_poly)
    inter, union = record_poly.intersection(observed_poly), record_poly.union(observed_poly)
    iou = geo.area_sqm(inter) / geo.area_sqm(union) if not union.is_empty else 0.0
    gap = 100 * (b - a) / a
    flag = iou < 0.7 or abs(gap) > 15
    return {"record_area_sqm": round(a), "observed_area_sqm": round(b), "area_gap_pct": round(gap, 1), "iou": round(iou, 2),
            "flag": bool(flag), "rule": "flag if IoU < 0.70 or area gap > 15 %"}


def synthetic_observed(record_poly, tag: str):
    """SYNTHETIC stand-in for a Fields-of-The-World / segmented boundary: the record polygon, shifted and scaled a little."""
    r = rng("boundary:" + tag)
    s = r.uniform(0.9, 1.12)
    side = record_poly.bounds[2] - record_poly.bounds[0]
    return affinity.translate(affinity.scale(record_poly, s, s), r.normal(0, 0.06) * side, r.normal(0, 0.06) * side)


def title_health(plot: dict, document: str | None = None) -> dict:
    from .extract import extract

    rec = geo.square(plot["lat"], plot["lon"], plot["area_sqm"])
    out = {"record": extract(document),
           "boundary": {**compare(rec, synthetic_observed(rec, plot["id"])), "synthetic": True,
                        "note": "Record polygon is a placeholder square; observed polygon is synthetic. "
                                "Live: Bhu-Naksha or a digitised parcel vs Fields of The World."},
           "disputes": {"cases_found": None, "reason": "eCourts data not collected; see data/templates/ecourts_cases.template.csv"},
           "charges": {"cersai_checked": False, "reason": "CERSAI is a paid per-search service; not queried."}}
    return out
