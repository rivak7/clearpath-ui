from __future__ import annotations

import math
import os
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from typing import Optional, Tuple


ARCGIS_EXPORT_URLS = [
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export",
    "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export",
]

ARCGIS_TILE_URLS = [
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
]


def build_export_url(base_url: str, south: float, west: float, north: float, east: float, width: int, height: int) -> str:
    bbox = f"{west},{south},{east},{north}"
    params = {
        "bbox": bbox,
        "bboxSR": "4326",
        "size": f"{width},{height}",
        "imageSR": "3857",
        "dpi": "96",
        "format": "png",
        "transparent": "false",
        "f": "image",
    }
    return base_url + "?" + urllib.parse.urlencode(params)


def lonlat_to_global_px(lon: float, lat: float, z: int) -> Tuple[float, float]:
    lat = max(min(lat, 85.05112878), -85.05112878)
    n = 2 ** z
    x = (lon + 180.0) / 360.0
    lat_rad = math.radians(lat)
    y = (1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2
    return x * n * 256.0, y * n * 256.0


def pick_zoom_for_bbox(south: float, west: float, north: float, east: float, target_px: int) -> int:
    lat = (south + north) / 2.0
    cos_lat = math.cos(math.radians(lat))
    width_m = max(1e-6, (east - west) * 111320.0 * cos_lat)
    mpp_target = max(0.01, width_m / float(target_px))
    z_float = math.log2(max(1e-9, 156543.03392 * cos_lat / mpp_target))
    return int(min(19, max(0, round(z_float))))


def try_arcgis_export(south: float, west: float, north: float, east: float, width: int, height: int) -> Optional[bytes]:
    for base in ARCGIS_EXPORT_URLS:
        url = build_export_url(base, south, west, north, east, width, height)
        req = urllib.request.Request(url, headers={"User-Agent": "satdist/1.0"})
        try:
            with urllib.request.urlopen(req, timeout=20) as resp:
                ctype = resp.headers.get("Content-Type", "")
                if "image" not in ctype:
                    _ = resp.read(128)
                    continue
                return resp.read()
        except Exception:
            continue
    return None


def stitch_tiles(south: float, west: float, north: float, east: float, width: int, height: int) -> bytes:
    import io
    from PIL import Image
    import requests

    z = pick_zoom_for_bbox(south, west, north, east, max(width, height))

    def lon_to_xtile(lon: float, z: int) -> float:
        return (lon + 180.0) / 360.0 * (2 ** z)

    def lat_to_ytile(lat: float, z: int) -> float:
        lat = max(min(lat, 85.05112878), -85.05112878)
        lat_rad = math.radians(lat)
        return (1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2 * (2 ** z)

    x_min_f = lon_to_xtile(west, z)
    x_max_f = lon_to_xtile(east, z)
    y_min_f = lat_to_ytile(north, z)
    y_max_f = lat_to_ytile(south, z)

    x_min = int(math.floor(x_min_f))
    x_max = int(math.floor(x_max_f))
    y_min = int(math.floor(y_min_f))
    y_max = int(math.floor(y_max_f))

    tiles_x = x_max - x_min + 1
    tiles_y = y_max - y_min + 1

    composite = Image.new("RGB", (tiles_x * 256, tiles_y * 256))

    session = requests.Session()
    session.headers.update({"User-Agent": "satdist/1.0"})

    def fetch_tile(x: int, y: int, z: int) -> "Image.Image":
        last_exc = None
        for tmpl in ARCGIS_TILE_URLS:
            url = tmpl.format(z=z, x=x, y=y)
            try:
                r = session.get(url, timeout=15)
                if r.status_code == 200 and r.headers.get("Content-Type", "").startswith("image/"):
                    return Image.open(io.BytesIO(r.content)).convert("RGB")
            except Exception as e:  # noqa: BLE001
                last_exc = e
                continue
        if last_exc:
            raise last_exc
        raise RuntimeError("Failed to fetch tile")

    for ty in range(y_min, y_max + 1):
        for tx in range(x_min, x_max + 1):
            img = fetch_tile(tx, ty, z)
            px = (tx - x_min) * 256
            py = (ty - y_min) * 256
            composite.paste(img, (px, py))

    west_px, north_px = lonlat_to_global_px(west, north, z)
    east_px, south_px = lonlat_to_global_px(east, south, z)
    left = int(round(west_px - x_min * 256))
    top = int(round(north_px - y_min * 256))
    right = int(round(east_px - x_min * 256))
    bottom = int(round(south_px - y_min * 256))

    left = max(0, min(composite.width - 1, left))
    top = max(0, min(composite.height - 1, top))
    right = max(left + 1, min(composite.width, right))
    bottom = max(top + 1, min(composite.height, bottom))

    cropped = composite.crop((left, top, right, bottom))
    if cropped.width != width or cropped.height != height:
        cropped = cropped.resize((width, height), Image.BILINEAR)

    out_io = io.BytesIO()
    cropped.save(out_io, format="PNG")
    return out_io.getvalue()


def fetch_satellite_bbox(
    south: float,
    west: float,
    north: float,
    east: float,
    width: int = 1024,
    height: int = 1024,
) -> bytes:
    data = try_arcgis_export(south, west, north, east, width, height)
    if data is None:
        data = stitch_tiles(south, west, north, east, width, height)
    return data


def save_satellite_bbox(
    south: float,
    west: float,
    north: float,
    east: float,
    width: int = 1024,
    height: int = 1024,
    out: Optional[str] = None,
) -> str:
    if out is None:
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        bbox_part = f"{south:.6f}_{west:.6f}_{north:.6f}_{east:.6f}"
        bbox_part = "".join(c for c in bbox_part if c.isalnum() or c in ("_", "-", "."))
        out_dir = os.path.join("config", "cache")
        os.makedirs(out_dir, exist_ok=True)
        out = os.path.join(out_dir, f"sat_{bbox_part}_{ts}.png")

    data = fetch_satellite_bbox(south, west, north, east, width, height)
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    with open(out, "wb") as f:
        f.write(data)
    return out

