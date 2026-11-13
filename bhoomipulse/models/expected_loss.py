"""Expected loss = PD x LGD x EAD, realisable value and the suggested LTV band."""
from __future__ import annotations

from ..config import CFG


def realisable_value(value: float, haircut: float, years_to_sale: float, r: float | None = None,
                     recovery_cost: float = 0.05) -> float:
    """What the lender nets after a forced sale: value x (1-haircut) x (1-cost), discounted for the wait."""
    r = CFG["lender"]["cost_of_funds"] if r is None else r
    return value * (1 - haircut) * (1 - recovery_cost) / (1 + r) ** years_to_sale


def lgd(ead: float, realisable: float) -> float:
    return float(min(1.0, max(0.0, 1 - realisable / ead))) if ead > 0 else 0.0


def expected_loss(pd_: float, ead: float, realisable: float) -> dict:
    l_ = lgd(ead, realisable)
    return {"pd": pd_, "lgd": l_, "ead": ead, "el": pd_ * l_ * ead, "el_rate": pd_ * l_}


def max_loan(realisable: float, pd_: float, threshold: float | None = None) -> float:
    """Largest loan with PD x LGD <= threshold.  LGD = 1 - R/L  =>  L <= R / (1 - threshold/PD)."""
    threshold = CFG["lender"]["el_threshold"] if threshold is None else threshold
    if pd_ <= threshold:
        return float("inf")
    return realisable / (1 - threshold / pd_)


def ltv_band(value_low: float, value_mid: float, haircut: float, years_to_sale: float, pd_: float,
             cap: float = 0.75) -> tuple[float, float]:
    """(conservative, central) LTV against the central value, capped at `cap`."""
    lo = max_loan(realisable_value(value_low, haircut, years_to_sale), pd_) / value_mid
    mid = max_loan(realisable_value(value_mid, haircut, years_to_sale), pd_) / value_mid
    return round(min(lo, cap), 3), round(min(mid, cap), 3)
