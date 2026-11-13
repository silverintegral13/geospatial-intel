"""M5 Pulse: monthly activity monitoring for farms, properties and factories.

Rules are simple and documented so a credit officer can audit them.
10 m imagery cannot count trucks or read signage: the factory signal is
night-light and roof/yard change only. High-resolution imagery is a paid upgrade.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .. import synth
from ..config import AS_OF, CFG, DEMO

SCENARIO = {"farm": None, "property": "construction", "factory": "factory_slowdown"}
SCENARIO_NOTE = {None: "No scripted event.", "construction": "Scripted demo event: a building goes up over the last 18 months.",
                 "factory_slowdown": "Scripted demo event: activity fades by about a third over the last six months."}


def farm_pulse(s: pd.DataFrame, village: pd.DataFrame | None) -> dict:
    yr = pd.Timestamp(str(AS_OF)).year
    k = s[(s.month.dt.year == yr) & s.month.dt.month.isin([6, 7, 8, 9, 10])]
    june, peak = float(k.ndvi.iloc[0]), float(k.ndvi.max())
    sown = (peak - june) >= 0.15
    base = None
    if village is not None:
        v = village[village.month.dt.month.isin([7, 8, 9, 10]) & (village.month.dt.year < yr)]
        base = float(v.groupby(v.month.dt.year).ndvi.max().median())
    idx = 50 + 50 * np.clip((peak - (base if base is not None else peak)) / 0.2, -1, 1)
    idx = float(idx if sown else min(idx, 20))
    flags = [] if sown else [f"Kharif {yr}: no green-up after the sowing window (NDVI rose {peak - june:.2f}, needs 0.15). Plot looks unsown."]
    if sown and base is not None and peak < base - 0.1:
        flags.append(f"Crop vigour is below the village norm (peak NDVI {peak:.2f} vs {base:.2f}).")
    return {"kind": "farm", "activity_index": round(idx, 0), "sown_this_season": bool(sown), "season": f"Kharif {yr}",
            "peak_ndvi": round(peak, 2), "village_median_peak_ndvi": None if base is None else round(base, 2), "flags": flags}


def property_pulse(s: pd.DataFrame) -> dict:
    b = s.built_index.to_numpy()
    now, d6, d12 = float(b[-3:].mean()), float(b[-3:].mean() - b[-9:-6].mean()), float(b[-3:].mean() - b[-15:-12].mean())
    stage = "complete" if now >= 0.8 else "finishing" if now >= 0.5 else "structure" if now >= 0.2 else "foundation or vacant"
    flags = []
    if stage != "complete" and d6 < 0.02:
        flags.append(f"Construction looks stalled: built-up index moved {d6:+.2f} in six months at the '{stage}' stage.")
    return {"kind": "property", "activity_index": round(100 * min(now, 1.0), 0), "construction_stage": stage,
            "built_index": round(now, 2), "change_6m": round(d6, 2), "change_12m": round(d12, 2), "flags": flags}


def factory_pulse(s: pd.DataFrame) -> dict:
    n = s.ntl.to_numpy()
    ratio = float(n[-3:].mean() / n[-15:-3].mean())
    flags = [f"Night-time activity is {100 * (1 - ratio):.0f}% below the previous 12-month average."] if ratio < 0.85 else []
    return {"kind": "factory", "activity_index": round(float(np.clip(80 * ratio, 0, 100)), 0), "ntl_last3m_vs_prev12m": round(ratio, 2),
            "flags": flags, "note": "10 m imagery cannot count trucks; signal is night lights plus roof and yard change."}


def plot_pulse(plot: dict, village_monthly: pd.DataFrame | None = None) -> tuple[dict, pd.DataFrame]:
    scen = SCENARIO[plot["kind"]]
    s = synth.monthly_series(plot["lat"], plot["lon"], f"plot:{plot['id']}", scen)
    res = {"farm": lambda: farm_pulse(s, village_monthly), "property": lambda: property_pulse(s),
           "factory": lambda: factory_pulse(s)}[plot["kind"]]()
    res.update({"as_of": str(AS_OF), "synthetic": True, "scenario_note": SCENARIO_NOTE[scen]})
    return res, s


def main() -> dict:
    plots = pd.read_parquet(DEMO / "features_plot.parquet")
    vm = pd.read_parquet(DEMO / "village_monthly.parquet")
    villages = pd.read_parquet(DEMO / "features_village.parquet").set_index("village").village_id
    out, series = {}, []
    for p in CFG["plots"]:
        vname = plots.loc[plots.id == p["id"], "village"].iloc[0]
        v = vm[vm.village_id == villages.get(vname)] if vname in villages.index else None
        res, s = plot_pulse(p, v)
        out[p["id"]] = res
        series.append(s.assign(plot_id=p["id"]))
    pd.concat(series).to_parquet(DEMO / "plot_monthly.parquet", index=False)
    return out


if __name__ == "__main__":
    print(main())
