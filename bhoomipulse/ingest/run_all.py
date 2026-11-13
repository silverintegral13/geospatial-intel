"""make data: ingest every source, write data/sources.yaml."""
from __future__ import annotations

from .. import sources
from ..config import ensure_dirs
from . import boundaries, layers, tables


def main() -> None:
    ensure_dirs()
    boundaries.run()
    layers.run()
    tables.run()
    sources.save()
    reg = sources.load()
    n = {m: sum(1 for v in reg.values() if v["mode"] == m) for m in ("live", "manual", "synthetic", "template")}
    print(f"sources.yaml: {len(reg)} sources -> {n}")


if __name__ == "__main__":
    main()
