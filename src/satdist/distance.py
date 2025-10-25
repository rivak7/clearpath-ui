from __future__ import annotations

import math
from typing import Tuple

EARTH_RADIUS_M = 6_371_008.8


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = phi2 - phi1
    dlmb = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlmb / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(max(0.0, 1.0 - a)))
    return EARTH_RADIUS_M * c


def pixel_to_lonlat(
    x: float,
    y: float,
    width: int,
    height: int,
    south: float,
    west: float,
    north: float,
    east: float,
) -> Tuple[float, float]:
    if width <= 0 or height <= 0:
        raise ValueError("width and height must be positive")
    if not (south < north and west < east):
        raise ValueError("Invalid bbox: require south < north and west < east")

    u = float(x) / float(width)
    v = float(y) / float(height)
    lon = west + (east - west) * u
    lat = north - (north - south) * v
    return lon, lat


def distance_between_image_pixels_m(
    x1: float,
    y1: float,
    x2: float,
    y2: float,
    width: int,
    height: int,
    south: float,
    west: float,
    north: float,
    east: float,
) -> float:
    lon1, lat1 = pixel_to_lonlat(x1, y1, width, height, south, west, north, east)
    lon2, lat2 = pixel_to_lonlat(x2, y2, width, height, south, west, north, east)
    return haversine_m(lat1, lon1, lat2, lon2)


def meters_per_pixel_at_center(
    width: int,
    height: int,
    south: float,
    west: float,
    north: float,
    east: float,
) -> Tuple[float, float]:
    if width <= 0 or height <= 0:
        raise ValueError("width and height must be positive")
    lat_c = (south + north) / 2.0
    m_per_deg_lat = 111_132.92 - 559.82 * math.cos(2 * math.radians(lat_c)) + 1.175 * math.cos(
        4 * math.radians(lat_c)
    ) - 0.0023 * math.cos(6 * math.radians(lat_c))
    m_per_deg_lon = 111_412.84 * math.cos(math.radians(lat_c)) - 93.5 * math.cos(
        3 * math.radians(lat_c)
    ) + 0.118 * math.cos(5 * math.radians(lat_c))

    dx_deg = (east - west) / float(width)
    dy_deg = (north - south) / float(height)
    return m_per_deg_lon * dx_deg, m_per_deg_lat * dy_deg


def distance_between_latlon_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    return haversine_m(lat1, lon1, lat2, lon2)

