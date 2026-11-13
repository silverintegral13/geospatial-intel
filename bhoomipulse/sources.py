"""Registry of every data source: URL, licence, access date, row count, mode.

mode is one of:
  live       fetched from the source in this run
  synthetic  source unreachable; a labelled SYNTHETIC fallback was generated
  manual     transcribed by hand from a public document
  template   empty CSV template waiting for hand-collected records
"""
from __future__ import annotations

from datetime import date

import yaml

from .config import SOURCES_YAML

_REG: dict[str, dict] = {}


def record(name: str, *, url: str, licence: str, rows: int, mode: str, use: str,
           note: str = "", prototype_only: bool = False) -> None:
    _REG[name] = {
        "url": url, "licence": licence, "access_date": date.today().isoformat(),
        "rows": int(rows), "mode": mode, "use": use,
        "prototype_only": bool(prototype_only), "note": note,
    }


def save() -> None:
    old = yaml.safe_load(SOURCES_YAML.read_text()) if SOURCES_YAML.exists() else {}
    old = old or {}
    old.update(_REG)
    SOURCES_YAML.write_text(yaml.safe_dump(old, sort_keys=True, allow_unicode=True))


def load() -> dict:
    return yaml.safe_load(SOURCES_YAML.read_text()) if SOURCES_YAML.exists() else {}
