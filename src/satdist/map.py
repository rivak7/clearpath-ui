from __future__ import annotations

import folium
from folium.plugins import MeasureControl


# The Esri World Imagery tiles return "Map data not available" beyond this zoom.
MAX_SATELLITE_ZOOM = 18


def create_map_with_bbox(
    center_lat: float,
    center_lon: float,
    south: float,
    west: float,
    north: float,
    east: float,
    zoom_start: int = 19,
    show_bbox: bool = True,
) -> folium.Map:
    zoom = min(zoom_start, MAX_SATELLITE_ZOOM)
    m = folium.Map(location=[center_lat, center_lon], zoom_start=zoom, tiles=None, max_zoom=MAX_SATELLITE_ZOOM)
    folium.TileLayer(
        tiles="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        attr="Esri, Maxar, Earthstar Geographics, and the GIS User Community",
        name="Esri World Imagery",
        control=False,
        overlay=False,
        show=True,
        max_zoom=MAX_SATELLITE_ZOOM,
    ).add_to(m)

    folium.Marker([center_lat, center_lon], popup="Center", icon=folium.Icon(color="red")).add_to(m)

    if show_bbox:
        folium.Rectangle(bounds=[[south, west], [north, east]], color="blue", weight=2, fill=True, fill_opacity=0.2).add_to(m)

    # Add measurement tool (users can click to measure distances/areas)
    m.add_child(MeasureControl(primary_length_unit="meters", secondary_length_unit="kilometers"))

    return m


def save_map_html(
    center_lat: float,
    center_lon: float,
    south: float,
    west: float,
    north: float,
    east: float,
    out_html: str = "building_bbox.html",
    zoom_start: int = MAX_SATELLITE_ZOOM,
) -> str:
    m = create_map_with_bbox(center_lat, center_lon, south, west, north, east, zoom_start=zoom_start, show_bbox=True)
    m.save(out_html)
    return out_html
