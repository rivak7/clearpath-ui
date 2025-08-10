"""Backwards-compatible shim that re-exports distance utilities from the satdist package.

Prefer importing from `satdist.distance`. This module remains for compatibility.
"""

from satdist.distance import (
    EARTH_RADIUS_M,
    distance_between_image_pixels_m,
    distance_between_latlon_m,
    haversine_m,
    meters_per_pixel_at_center,
    pixel_to_lonlat,
)

__all__ = [
    "EARTH_RADIUS_M",
    "haversine_m",
    "pixel_to_lonlat",
    "distance_between_image_pixels_m",
    "distance_between_latlon_m",
    "meters_per_pixel_at_center",
]

