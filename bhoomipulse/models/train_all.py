"""make train: all models, Pulse, NBFC lab, metrics.json and model cards."""
from __future__ import annotations

import json

from ..config import DEMO, MODELS, ensure_dirs
from ..nbfc import lab, synth_book
from ..pulse import pulse
from . import area_score, avm, liquidity, pd_demo


def main() -> None:
    ensure_dirs()
    if (MODELS / "metrics.json").exists():
        (MODELS / "metrics.json").unlink()
    for mod in (liquidity, avm, area_score):
        m = mod.train()
        print(mod.__name__.split(".")[-1], {k: round(v, 3) for k, v in m.items() if isinstance(v, float)})
    (DEMO / "pulse_plots.json").write_text(json.dumps(pulse.main(), indent=1, default=float))
    synth_book.main()
    print("pd_demo gini", round(pd_demo.train()["gini_logistic_scorecard"], 3))
    r = lab.main()
    print("nbfc lab", {k: round(v["gini"], 3) for k, v in r["models"].items()})


if __name__ == "__main__":
    main()
