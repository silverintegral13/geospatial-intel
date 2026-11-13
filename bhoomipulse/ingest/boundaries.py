"""Real boundaries: Gujarat districts (geoBoundaries) and Sanand villages (DataMeet)."""
from __future__ import annotations

import geopandas as gpd
import requests

from .. import sources
from ..config import CFG, DEMO, RAW

ADM2_URL = ("https://media.githubusercontent.com/media/wmgeolab/geoBoundaries/main/releaseData/"
            "gbOpen/IND/ADM2/geoBoundaries-IND-ADM2_simplified.geojson")
VILLAGE_URL = "https://raw.githubusercontent.com/datameet/indian_village_boundaries/master/gj/gj.geojson"


def _download(url: str, name: str):
    path = RAW / "boundaries" / name
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        r = requests.get(url, timeout=300)
        r.raise_for_status()
        path.write_bytes(r.content)
    return path


def run() -> None:
    try:
        v = gpd.read_file(_download(VILLAGE_URL, "gj_villages.geojson"))
        d = gpd.read_file(_download(ADM2_URL, "ind_adm2.geojson"))
    except Exception as e:  # keep the committed demo boundaries if the download fails
        if (DEMO / "districts.geojson").exists():
            print(f"boundaries: download failed ({e}); keeping committed demo boundaries")
            return
        raise
    v["geometry"] = v.geometry.buffer(0)
    gj = v.geometry.union_all()
    d = d[d.representative_point().within(gj)][["shapeName", "geometry"]].rename(columns={"shapeName": "district"})
    d = d.sort_values("district").reset_index(drop=True)
    d["geometry"] = d.geometry.simplify(0.003).buffer(0)
    d.to_file(DEMO / "districts.geojson", driver="GeoJSON")
    s = v[v.SUB_DISTRICT == CFG["taluka"]].copy()
    s = s.rename(columns={"NAME": "village", "TYPE": "type"})[["village", "type", "geometry"]]
    s = s.sort_values("village").reset_index(drop=True)
    s.insert(0, "village_id", [f"V{i:03d}" for i in range(len(s))])
    s["geometry"] = s.geometry.simplify(0.0003).buffer(0)
    s.to_file(DEMO / "villages_sanand.geojson", driver="GeoJSON")
    sources.record("geoBoundaries India ADM2 (districts)", url=ADM2_URL, licence="CC BY 4.0 (geoBoundaries gbOpen)",
                   rows=len(d), mode="live", use="Gujarat district map (33 pre-2025 districts)",
                   note=CFG["district_note"])
    sources.record("DataMeet Indian village boundaries (Gujarat)", url=VILLAGE_URL, licence="ODbL 1.0",
                   rows=len(s), mode="live", use="Sanand taluka village polygons",
                   note="Census 2001 village boundaries; 18,797 Gujarat polygons downloaded, Sanand subset kept.")
    print(f"boundaries: {len(d)} districts, {len(s)} Sanand villages (live)")


if __name__ == "__main__":
    run()
    sources.save()
