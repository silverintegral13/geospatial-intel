"""Question answering over the feature store. Answers come from tool functions, never free text.

Without an API key a keyword router picks the tool. With ANTHROPIC_API_KEY set,
Claude picks the tool (tool calling) and phrases the answer from the tool result.
"""
from __future__ import annotations

import json
import os

import pandas as pd

from .config import ASSET_LABEL, DEMO
from .models.common import load_metrics


def _d() -> pd.DataFrame:
    return pd.read_parquet(DEMO / "scores_district.parquet")


def _v() -> pd.DataFrame:
    return pd.read_parquet(DEMO / "scores_village.parquet")


def rank_districts(order: str = "weakest", n: int = 5) -> str:
    """Districts ranked by collateral-quality score. order: weakest or strongest."""
    d = _d().sort_values("score", ascending=order == "weakest").head(int(n))
    return "\n".join(f"- {r.district}: score {r.score:.0f} ({r.drivers})" for r in d.itertuples())


def rank_villages(order: str = "weakest", n: int = 5) -> str:
    """Sanand taluka villages ranked by score. order: weakest or strongest."""
    v = _v().sort_values("score", ascending=order == "weakest").head(int(n))
    return "\n".join(f"- {r.village}: score {r.score:.0f} ({r.drivers})" for r in v.itertuples())


def place_score(name: str) -> str:
    """Score and drivers for one district or one Sanand village, by name."""
    for df, col, kind in ((_d(), "district", "district"), (_v(), "village", "village")):
        hit = df[df[col].str.lower() == name.strip().lower()]
        if len(hit):
            r = hit.iloc[0]
            return f"{r[col]} ({kind}): score {r.score:.0f} out of 100. Drivers: {r.drivers}."
    return f"No district or Sanand village named '{name}' in the feature store."


def book_weak_collateral(threshold: float = 40) -> str:
    """Districts in the loaded loan book where the collateral-quality score is below a threshold, by exposure."""
    b = pd.read_parquet(DEMO / "nbfc_book_synthetic.parquet", columns=["district", "sanctioned_amount", "default_12m"])
    g = b.groupby("district").agg(loans=("district", "size"), exposure=("sanctioned_amount", "sum"), default_rate=("default_12m", "mean")).reset_index()
    g = g.merge(_d()[["district", "score"]], on="district")
    w = g[g.score < threshold].sort_values("exposure", ascending=False)
    if not len(w):
        return f"No district in the book scores below {threshold:.0f}."
    return (f"{len(w)} districts in the book score below {threshold:.0f} (book is SYNTHETIC):\n" + "\n".join(
        f"- {r.district}: score {r.score:.0f}, {r.loans:,} loans, Rs {r.exposure / 1e7:.1f} crore sanctioned, default rate {r.default_rate:.1%}"
        for r in w.head(8).itertuples()))


def liquidity_by_asset() -> str:
    """Share of auction listings sold within 180 days and mean haircut, by asset type (hold-out)."""
    b = load_metrics()["liquidity"]["by_asset_type"]
    return "\n".join(f"- {ASSET_LABEL[t]}: {v['sold_180d_actual']:.0%} sold within 180 days, mean haircut {v['haircut_actual']:.0%}" for t, v in b.items())


TOOLS = {f.__name__: f for f in (rank_districts, rank_villages, place_score, book_weak_collateral, liquidity_by_asset)}
NOTE = "\n\n_All figures come from synthetic demo data._"


def route(q: str) -> str:
    """Keyword router: picks one tool. Used when no LLM key is set."""
    t = q.lower()
    order = "strongest" if any(w in t for w in ("strong", "best", "top", "safest", "highest")) else "weakest"
    if "book" in t or "portfolio" in t or "my loans" in t:
        return book_weak_collateral()
    if any(w in t for w in ("sell", "liquid", "auction", "haircut")):
        return liquidity_by_asset()
    for df, col in ((_d(), "district"), (_v(), "village")):
        for name in df[col]:
            if name.lower() in t:
                return place_score(name)
    if "village" in t or "sanand" in t:
        return rank_villages(order)
    if "district" in t or "gujarat" in t or "where" in t:
        return rank_districts(order)
    return ("I can answer from the feature store: weakest or strongest districts and villages, the score of a named district or village, "
            "weak-collateral districts in the loan book, and how fast each asset type sells.")


def answer(q: str) -> str:
    key = os.environ.get("ANTHROPIC_API_KEY")
    if not key:
        return route(q) + NOTE
    try:
        import anthropic

        specs = [{"name": "rank_districts", "description": rank_districts.__doc__, "input_schema": {"type": "object", "properties": {"order": {"type": "string", "enum": ["weakest", "strongest"]}, "n": {"type": "integer"}}}},
                 {"name": "rank_villages", "description": rank_villages.__doc__, "input_schema": {"type": "object", "properties": {"order": {"type": "string", "enum": ["weakest", "strongest"]}, "n": {"type": "integer"}}}},
                 {"name": "place_score", "description": place_score.__doc__, "input_schema": {"type": "object", "properties": {"name": {"type": "string"}}, "required": ["name"]}},
                 {"name": "book_weak_collateral", "description": book_weak_collateral.__doc__, "input_schema": {"type": "object", "properties": {"threshold": {"type": "number"}}}},
                 {"name": "liquidity_by_asset", "description": liquidity_by_asset.__doc__, "input_schema": {"type": "object", "properties": {}}}]
        client, model = anthropic.Anthropic(api_key=key), os.environ.get("ANTHROPIC_MODEL", "claude-sonnet-5-5")
        system = "Answer only from tool results. If no tool fits, say what you can answer. Never invent numbers."
        msgs = [{"role": "user", "content": q}]
        for _ in range(4):
            r = client.messages.create(model=model, max_tokens=700, system=system, tools=specs, messages=msgs)
            if r.stop_reason != "tool_use":
                return "".join(b.text for b in r.content if b.type == "text") + NOTE
            msgs.append({"role": "assistant", "content": r.content})
            msgs.append({"role": "user", "content": [{"type": "tool_result", "tool_use_id": b.id, "content": TOOLS[b.name](**b.input)}
                                                     for b in r.content if b.type == "tool_use"]})
    except Exception as e:
        return route(q) + NOTE + f"\n\n_(LLM unavailable: {type(e).__name__}; answered by keyword router.)_"
    return route(q) + NOTE


if __name__ == "__main__":
    print(json.dumps({q: answer(q) for q in ["which districts in my book have weak collateral?", "score of Surat", "strongest villages"]}, indent=1))
