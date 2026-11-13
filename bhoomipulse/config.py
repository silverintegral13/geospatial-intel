"""Paths, configuration and seeded random generators."""
from __future__ import annotations

import os
import zlib
from pathlib import Path

import numpy as np
import yaml

ROOT = Path(__file__).resolve().parents[1]
CFG = yaml.safe_load((ROOT / "config.yaml").read_text())

RAW = ROOT / "data" / "raw"
INTERIM = ROOT / "data" / "interim"
DEMO = ROOT / "data" / "demo"          # small derived data, committed
MANUAL = ROOT / "data" / "manual"
TEMPLATES = ROOT / "data" / "templates"
MODELS = ROOT / "models"
REPORTS = ROOT / "reports"
ASSETS = ROOT / "deck_assets"
SITE = ROOT / "site"
SOURCES_YAML = ROOT / "data" / "sources.yaml"

DEMO_MODE = os.environ.get("DEMO_MODE", "1") == "1"
AS_OF = np.datetime64(CFG["as_of"])

ASSET_TYPES = ["agri_land", "residential", "commercial", "industrial", "plot_na"]
ASSET_LABEL = {
    "agri_land": "Agricultural land",
    "residential": "Residential property",
    "commercial": "Commercial property",
    "industrial": "Industrial land and building",
    "plot_na": "Non-agricultural plot",
}


def rng(tag: str) -> np.random.Generator:
    """Deterministic generator per tag, so every run reproduces the same data."""
    return np.random.default_rng(CFG["seed"] + zlib.crc32(tag.encode()))


def ensure_dirs() -> None:
    for p in (RAW, INTERIM, DEMO, MANUAL, TEMPLATES, MODELS, REPORTS, ASSETS):
        p.mkdir(parents=True, exist_ok=True)
