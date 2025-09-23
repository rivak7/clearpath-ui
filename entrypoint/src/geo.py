import math

TILE_SIZE = 256


def _n(z: int) -> float:
    return 2.0 ** z


def lon_to_xtile(lon: float, z: int) -> float:
    return (lon + 180.0) / 360.0 * _n(z)


def lat_to_ytile(lat: float, z: int) -> float:
    lat_rad = math.radians(lat)
    return (1.0 - math.log(math.tan(lat_rad) + 1.0 / math.cos(lat_rad)) / math.pi) / 2.0 * _n(z)


def tile_to_lon(x_tile: float, z: int) -> float:
    return x_tile / _n(z) * 360.0 - 180.0


def tile_to_lat(y_tile: float, z: int) -> float:
    n = math.pi - 2.0 * math.pi * y_tile / _n(z)
    return math.degrees(math.atan(math.sinh(n)))


def latlon_to_pixel_xy_in_image(
    lat: float,
    lon: float,
    center_lat: float,
    center_lon: float,
    z: int,
    img_size_px: int,
    tile_size: int = TILE_SIZE,
):
    # Convert to fractional tile coordinates
    x = lon_to_xtile(lon, z)
    y = lat_to_ytile(lat, z)
    cx = lon_to_xtile(center_lon, z)
    cy = lat_to_ytile(center_lat, z)

    # Delta in tiles relative to image center
    dx_tiles = x - cx
    dy_tiles = y - cy

    # Pixels from center
    px = img_size_px / 2.0 + dx_tiles * tile_size
    py = img_size_px / 2.0 + dy_tiles * tile_size
    return px, py


def pixel_xy_to_latlon_in_image(
    px: float,
    py: float,
    center_lat: float,
    center_lon: float,
    z: int,
    img_size_px: int,
    tile_size: int = TILE_SIZE,
):
    cx = lon_to_xtile(center_lon, z)
    cy = lat_to_ytile(center_lat, z)

    dx_tiles = (px - img_size_px / 2.0) / tile_size
    dy_tiles = (py - img_size_px / 2.0) / tile_size

    x = cx + dx_tiles
    y = cy + dy_tiles

    lon = tile_to_lon(x, z)
    lat = tile_to_lat(y, z)
    return lat, lon


def meters_per_pixel(lat: float, z: int, tile_size: int = TILE_SIZE) -> float:
    # Web Mercator ground sampling distance at latitude
    return 156543.03392 * math.cos(math.radians(lat)) / (2 ** z)
