"""satdist: Satellite bbox utilities.

Modules:
- distance: geodesic and pixel-to-geography conversions.
- fetch: static image fetching for a bbox via ArcGIS endpoints.
- map: helpers to build interactive Folium maps with measurement.
"""

from .distance import (
    EARTH_RADIUS_M,
    haversine_m,
    pixel_to_lonlat,
    distance_between_image_pixels_m,
    distance_between_latlon_m,
    meters_per_pixel_at_center,
)

__all__ = [
    "EARTH_RADIUS_M",
    "haversine_m",
    "pixel_to_lonlat",
    "distance_between_image_pixels_m",
    "distance_between_latlon_m",
    "meters_per_pixel_at_center",
]

