"""LIVE road access from OpenStreetMap via osmnx. NOT exercised in the build environment."""
from __future__ import annotations

import numpy as np
import pandas as pd

from .. import geo


def road_access(grid):
    import osmnx as ox

    minx, miny, maxx, maxy = grid.total_bounds
    g = ox.graph_from_bbox(bbox=(minx - 0.05, miny - 0.05, maxx + 0.05, maxy + 0.05), network_type="drive")
    g = ox.add_edge_travel_times(ox.add_edge_speeds(g))
    nodes, dist = ox.distance.nearest_nodes(g, grid.lon.to_numpy(), grid.lat.to_numpy(), return_dist=True)
    import networkx as nx

    hub = ox.distance.nearest_nodes(g, geo.SANAND_TOWN[1], geo.SANAND_TOWN[0])
    secs = nx.single_source_dijkstra_path_length(g, hub, weight="travel_time")
    to_town = np.array([secs.get(n, np.nan) for n in nodes]) / 60.0
    ahm = geo.dist_km(geo.SANAND_TOWN[0], geo.SANAND_TOWN[1], geo.CITIES["Ahmedabad"])[0] * 1.5
    return pd.DataFrame({"h3": grid.h3, "road_access_km": np.asarray(dist) / 1000.0,
                         "drive_time_city_min": to_town + ahm}), None
