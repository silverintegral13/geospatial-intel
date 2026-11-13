"""make features: feature store at four levels (H3 cell, village, district, plot)
plus point features for auction listings. Writes small parquet files to data/demo/."""
from __future__ import annotations

import pandas as pd

from .. import geo, synth
from ..config import CFG, DEMO, INTERIM, ensure_dirs

GEOM_COLS = ["dist_major_city_km", "dist_ahmedabad_km", "dist_sanand_town_km", "dist_gidc_km", "dist_highway_km"]
FEATURES = GEOM_COLS + synth.SYNTH_COLS + ["jantri_rate_sqm"]

DESCRIPTIONS = {
    "dist_major_city_km": "Straight-line distance to the nearest of 10 large Gujarat cities",
    "dist_ahmedabad_km": "Straight-line distance to Ahmedabad centre",
    "dist_sanand_town_km": "Straight-line distance to Sanand town",
    "dist_gidc_km": "Straight-line distance to the Sanand GIDC villages",
    "dist_highway_km": "Distance to a rough trace of the Sarkhej-Sanand-Viramgam highway",
    "road_access_km": "Distance to the nearest drivable road (OSM)",
    "drive_time_city_min": "Drive time to the nearest city (OSM)",
    "built_up_share": "Share of the cell covered by buildings (Open Buildings 2.5D, 2023)",
    "built_growth_2016_2023": "Change in built-up share 2016-2023 (Open Buildings 2.5D)",
    "building_height_m": "Mean building height (Open Buildings 2.5D)",
    "ntl_radiance": "Mean night-light radiance, last 12 months (VIIRS)",
    "ntl_trend_pct_yr": "Night-light growth per year (VIIRS)",
    "ndvi_amplitude": "Seasonal NDVI swing (Sentinel-2)",
    "cropping_intensity": "Crops per year (Sentinel-2)",
    "flood_occurrence_pct": "Share of months with surface water, 1984-present (JRC)",
    "slope_deg": "Terrain slope (Copernicus DEM)",
    "rain_cv": "Year-to-year rainfall variability (CHIRPS)",
    "heat_days": "Days above 40 C per year (ERA5-Land)",
    "jantri_rate_sqm": "Government jantri rate for the asset's land use, Rs per sq m",
}
DESCRIPTIONS.update({f"emb_pc{i:02d}": "AlphaEarth embedding, principal component" for i in range(1, 17)})


def point_features(lat, lon, asset_type) -> pd.DataFrame:
    """Features for arbitrary points in Gujarat (auction listings, loans, plots).

    Geometry columns are real. Every other column is SYNTHETIC in this build:
    state-wide live sampling (Earth Engine at points) is not wired in yet.
    """
    d = synth.static_fields(lat, lon)
    d["jantri_rate_sqm"] = (synth.latent_value_sqm(d, asset_type) * synth.jantri_ratio(d)).round(-1)
    return d[FEATURES].reset_index(drop=True)


def main() -> None:
    ensure_dirs()
    villages = geo.load_villages()
    grid = pd.read_parquet(INTERIM / "h3_grid.parquet")
    static = pd.read_parquet(INTERIM / "h3_static.parquet")
    flags = [c for c in static.columns if c.endswith("__synthetic")]
    prov = {c.replace("__synthetic", ""): ("synthetic" if static[c].all() else "live") for c in flags}
    static = static.drop(columns=flags)
    jantri = pd.read_parquet(INTERIM / "jantri.parquet")
    prov["jantri_rate_sqm"] = "synthetic" if jantri.synthetic.all() else "manual"

    # ---- H3 cells
    h = grid.merge(static, on="h3")
    h = pd.concat([h, geo.geometry_features(h.lat.to_numpy(), h.lon.to_numpy())], axis=1)
    jw = jantri.pivot_table(index="village_id", columns="asset_type", values="rate_rs_per_sqm")
    h["jantri_rate_sqm"] = h.village_id.map(jw["agri_land"])
    h["jantri_residential_sqm"] = h.village_id.map(jw["residential"])
    h.to_parquet(DEMO / "features_h3.parquet", index=False)

    # ---- villages
    num = [c for c in FEATURES if c in h.columns] + ["jantri_residential_sqm"]
    v = h.groupby(["village_id", "village"], as_index=False)[num].mean()
    v["n_cells"] = v.village_id.map(h.groupby("village_id").size())
    v["area_sqkm"] = v.village_id.map(villages.set_index("village_id").to_crs(geo.UTM).area / 1e6)
    v.to_parquet(DEMO / "features_village.parquet", index=False)

    # ---- auction listings with point features
    L = pd.read_parquet(INTERIM / "listings.parquet")
    L = pd.concat([L.reset_index(drop=True), point_features(L.lat.to_numpy(), L.lon.to_numpy(), L.asset_type.to_numpy())], axis=1)
    L.to_parquet(DEMO / "listings.parquet", index=False)
    if (INTERIM / "listing_rounds.parquet").exists():
        pd.read_parquet(INTERIM / "listing_rounds.parquet").to_parquet(DEMO / "listing_rounds.parquet", index=False)

    # ---- districts: panel + auction density and outcomes (training window only, to avoid leakage)
    P = pd.read_parquet(INTERIM / "district_panel.parquet")
    old = L[L.listed_date < L.listed_date.quantile(0.7)]
    a = old.groupby("district").agg(auction_listings=("listing_id", "size"), auction_sold_rate=("sold", "mean"),
                                    auction_mean_haircut=("haircut_pct", "mean")).reset_index()
    dist = geo.load_districts()
    area = (dist.set_index("district").to_crs(geo.UTM).area / 1e6).rename("area_sqkm").reset_index()
    P = P.merge(a, on="district", how="left").merge(area, on="district", how="left")
    P["auction_density_per_1000sqkm"] = 1000 * P.auction_listings.fillna(0) / P.area_sqkm
    P.to_parquet(DEMO / "district_panel.parquet", index=False)
    P[P.fy == P.fy.max()].drop(columns=["fy", "npa_ratio_pct"]).to_parquet(DEMO / "features_district.parquet", index=False)

    # ---- plots
    plots = pd.DataFrame(CFG["plots"])
    pf = point_features(plots.lat.to_numpy(), plots.lon.to_numpy(), plots.asset_type.to_numpy())
    hx = h.set_index("h3")
    import h3 as h3lib
    cells = [h3lib.latlng_to_cell(la, lo, CFG["h3_resolution"]) for la, lo in zip(plots.lat, plots.lon)]
    plots["h3"] = cells
    plots["village"] = [hx.at[c, "village"] if c in hx.index else None for c in cells]
    pd.concat([plots, pf], axis=1).to_parquet(DEMO / "features_plot.parquet", index=False)

    # ---- village monthly series (for Pulse baselines)
    m = pd.read_parquet(INTERIM / "h3_monthly.parquet").merge(grid[["h3", "village_id"]], on="h3")
    vm = m.groupby(["village_id", "month"], as_index=False)[["ndvi", "sar_vv_db", "ntl", "built_index"]].median()
    vm["synthetic"] = bool(m.synthetic.all())
    vm.to_parquet(DEMO / "village_monthly.parquet", index=False)

    # ---- data dictionary with provenance
    rows = [{"column": c, "description": DESCRIPTIONS.get(c, ""),
             "provenance": "real (geometry)" if c in GEOM_COLS else prov.get(c, "synthetic"),
             "levels": "h3, village, district, plot, listing"} for c in FEATURES]
    pd.DataFrame(rows).to_csv(DEMO / "data_dictionary.csv", index=False)
    print(f"features: {len(h)} H3 cells, {len(v)} villages, {P.district.nunique()} districts, {len(plots)} plots, {len(L)} listings")
    print(L.groupby("asset_type").agg(n=("sold", "size"), sold=("sold", "mean"), haircut=("haircut_pct", "mean"), days=("duration_days", "median")).round(2))
    print("per-auction success:", round(L.sold.sum() / L.n_rounds.sum(), 3), "| reserve/sqm median by type:", (L.reserve_first / L.area_sqm).groupby(L.asset_type).median().round(0).to_dict())


if __name__ == "__main__":
    main()
