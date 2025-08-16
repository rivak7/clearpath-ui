#!/usr/bin/env python3
"""
Batch satellite image fetcher for building footprints.

Given a list of addresses, this script will:
- Geocode each address via a Nominatim-compatible API, requesting the building polygon.
- Compute the minimal bounding rectangle around the polygon and add 10% padding.
- Fetch a static satellite image for that padded bbox using satdist's fetcher.
- Save one PNG per address to an output directory.

Usage examples:

  # From repo root, using default OSM Nominatim and saving images to ./building_images
  python addresses_to_satellite.py --input addresses.txt --width 1024 --height 1024

  # Custom output dir and geocoder base URL
  python addresses_to_satellite.py --input addresses.txt --out-dir out/images \
      --geocoder-base-url https://nominatim.openstreetmap.org

Notes:
- Respect Nominatim usage policy. The script throttles queries by default (1.1s between requests).
- For some addresses, the provider may not return a building polygon. In such cases, the provider
  bounding box is used as a fallback and padded by 10%.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from dataclasses import dataclass
from typing import Any, Iterable, List, Optional, Sequence, Tuple

import requests

from satdist.fetch import save_satellite_bbox


@dataclass
class GeocodeResult:
    address: str
    center_lat: float
    center_lon: float
    bbox: Tuple[float, float, float, float]  # south, west, north, east
    source: str
    raw: dict


def read_addresses(path: str) -> List[str]:
    with open(path, "r", encoding="utf-8") as f:
        items = [line.strip() for line in f]
    return [x for x in items if x and not x.lstrip().startswith("#")]


def sanitize_filename(text: str, max_length: int = 120) -> str:
    value = text.strip().lower()
    value = value.replace("/", " ").replace("\\", " ")
    value = re.sub(r"\s+", "_", value)
    value = re.sub(r"[^a-z0-9_.\-]", "", value)
    value = value[:max_length].strip("._-")
    return value or "address"


def _iter_geojson_points(obj: Any) -> Iterable[Tuple[float, float]]:
    """
    Iterate lon/lat pairs from a GeoJSON coordinates structure.
    GeoJSON order is [lon, lat, (alt?)]
    """
    if isinstance(obj, (list, tuple)):
        if len(obj) >= 2 and all(isinstance(x, (int, float)) for x in obj[:2]):
            yield (float(obj[0]), float(obj[1]))
        else:
            for child in obj:
                yield from _iter_geojson_points(child)


def bbox_from_geojson(geojson_obj: dict) -> Optional[Tuple[float, float, float, float]]:
    try:
        coords = list(_iter_geojson_points(geojson_obj.get("coordinates")))
        if not coords:
            return None
        xs = [p[0] for p in coords]
        ys = [p[1] for p in coords]
        west = min(xs)
        east = max(xs)
        south = min(ys)
        north = max(ys)
        return (south, west, north, east)
    except Exception:
        return None


def normalize_bbox(south: float, west: float, north: float, east: float) -> Tuple[float, float, float, float]:
    s = min(south, north)
    n = max(south, north)
    w = min(west, east)
    e = max(west, east)
    return (s, w, n, e)


def pad_bbox(south: float, west: float, north: float, east: float, pad_ratio: float = 0.30) -> Tuple[float, float, float, float]:
    s, w, n, e = normalize_bbox(south, west, north, east)
    width = max(1e-8, e - w)
    height = max(1e-8, n - s)
    pad_x = width * pad_ratio
    pad_y = height * pad_ratio
    return (
        max(-90.0, s - pad_y),
        max(-180.0, w - pad_x),
        min(90.0, n + pad_y),
        min(180.0, e + pad_x),
    )


def geocode_address(
    address: str,
    base_url: str = "https://nominatim.openstreetmap.org",
    email: Optional[str] = None,
    user_agent: str = "satdist/1.0 (+https://example.local)",
    timeout: float = 20.0,
) -> GeocodeResult:
    params = {
        "q": address,
        "format": "jsonv2",
        "limit": 1,
        "polygon_geojson": 1,
        "addressdetails": 0,
        "dedupe": 1,
        "extratags": 0,
    }
    if email:
        params["email"] = email

    headers = {
        "User-Agent": user_agent,
        "Accept": "application/json",
    }
    url = base_url.rstrip("/") + "/search"
    r = requests.get(url, params=params, headers=headers, timeout=timeout)
    if r.status_code != 200:
        raise RuntimeError(f"Geocoder HTTP {r.status_code}: {r.text[:200]}")
    items = r.json()
    if not items:
        raise ValueError("No results")
    item = items[0]

    center_lat = float(item["lat"])  # type: ignore[arg-type]
    center_lon = float(item["lon"])  # type: ignore[arg-type]

    bbox: Optional[Tuple[float, float, float, float]] = None

    # Prefer GeoJSON polygon bounds
    geojson_obj = item.get("geojson") or item.get("polygon_geojson")
    if isinstance(geojson_obj, dict):
        bbox = bbox_from_geojson(geojson_obj)

    # Fallback to provider-provided bbox [south, north, west, east]
    if bbox is None and isinstance(item.get("boundingbox"), (list, tuple)) and len(item["boundingbox"]) == 4:
        bb = item["boundingbox"]
        try:
            s = float(bb[0])
            n = float(bb[1])
            w = float(bb[2])
            e = float(bb[3])
            bbox = normalize_bbox(s, w, n, e)
        except Exception:
            bbox = None

    if bbox is None:
        # Last resort: tiny box around the center
        eps = 0.0005
        bbox = (center_lat - eps, center_lon - eps, center_lat + eps, center_lon + eps)

    return GeocodeResult(
        address=address,
        center_lat=center_lat,
        center_lon=center_lon,
        bbox=bbox,
        source=base_url,
        raw=item,
    )


def save_image_for_address(
    geo: GeocodeResult,
    out_dir: str,
    width: int,
    height: int,
    pad_ratio: float,
    index: int,
) -> Tuple[str, Tuple[float, float, float, float]]:
    s, w, n, e = geo.bbox
    ps, pw, pn, pe = pad_bbox(s, w, n, e, pad_ratio=pad_ratio)

    os.makedirs(out_dir, exist_ok=True)

    base_name = f"{index:03d}_" + sanitize_filename(geo.address)
    out_png = os.path.join(out_dir, base_name + ".png")
    out_json = os.path.join(out_dir, base_name + ".json")

    # Fetch and save image
    save_satellite_bbox(ps, pw, pn, pe, width=width, height=height, out=out_png)

    # Optional post-upscale using OpenCV dnn_superres if available
    try:
        import cv2  # type: ignore
        import numpy as np  # type: ignore
        from cv2 import dnn_superres  # type: ignore

        # Pick a model if found locally; otherwise fall back gracefully
        # You can place EDSR_x2.pb or ESPCN_x2.pb in the repo root or config/cache
        model_search_paths = [
            os.path.join(os.getcwd(), "EDSR_x2.pb"),
            os.path.join(os.getcwd(), "ESPCN_x2.pb"),
            os.path.join("config", "cache", "EDSR_x2.pb"),
            os.path.join("config", "cache", "ESPCN_x2.pb"),
        ]
        model_path = next((p for p in model_search_paths if os.path.exists(p)), None)
        if model_path is not None:
            sr = dnn_superres.DnnSuperResImpl_create()
            if model_path.endswith("EDSR_x2.pb"):
                sr.readModel(model_path)
                sr.setModel("edsr", 2)
            else:
                sr.readModel(model_path)
                sr.setModel("espcn", 2)

            # Load image and upscale 2x, then downscale back to requested size with Lanczos
            img = cv2.imread(out_png, cv2.IMREAD_COLOR)
            if img is not None:
                up = sr.upsample(img)
                # Downscale to target size to sharpen details
                down = cv2.resize(up, (width, height), interpolation=cv2.INTER_LANCZOS4)
                cv2.imwrite(out_png, down)
    except Exception:
        # If OpenCV or model not available, keep the original image
        pass

    # Save metadata
    meta = {
        "address": geo.address,
        "center": {"lat": geo.center_lat, "lon": geo.center_lon},
        "bbox": {"south": s, "west": w, "north": n, "east": e},
        "bbox_padded": {"south": ps, "west": pw, "north": pn, "east": pe},
        "width": width,
        "height": height,
        "geocoder": geo.source,
    }
    with open(out_json, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)

    return out_png, (ps, pw, pn, pe)


def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description="Fetch satellite images for building bboxes given addresses")
    p.add_argument("addresses", nargs="*", help="Addresses to process (alternative to --input)")
    p.add_argument("--input", dest="input_file", type=str, help="Path to file with one address per line")
    p.add_argument("--out-dir", dest="out_dir", type=str, default="/Volumes/T9/entrypoint-maps/building_images", help="Output directory for images and metadata")
    p.add_argument("--geocoder-base-url", dest="geocoder_base_url", type=str, default="https://nominatim.openstreetmap.org", help="Nominatim-compatible base URL")
    p.add_argument("--geocoder-email", dest="geocoder_email", type=str, default=None, help="Contact email for geocoder User-Agent (recommended)")
    p.add_argument("--width", type=int, default=1024, help="Output image width in pixels")
    p.add_argument("--height", type=int, default=1024, help="Output image height in pixels")
    p.add_argument("--pad", dest="pad_ratio", type=float, default=0.30, help="Padding ratio around building bbox (default 0.30 = 30%)")
    p.add_argument("--delay", dest="delay_s", type=float, default=1.1, help="Seconds to sleep between geocoding requests (respect provider policy)")
    p.add_argument("--skip-existing", dest="skip_existing", action="store_true", default=True, help="Skip addresses if output PNG already exists")
    return p


def main(argv: Optional[Sequence[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)

    addresses: List[str] = []
    if args.input_file:
        addresses.extend(read_addresses(args.input_file))
    if args.addresses:
        addresses.extend(args.addresses)
    addresses = [a for a in [a.strip() for a in addresses] if a]

    if not addresses:
        print("Provide addresses via positional args or --input file", file=sys.stderr)
        return 2

    ua_email = f"; {args.geocoder_email}" if args.geocoder_email else ""
    user_agent = f"entrypoint-maps/addresses_to_satellite (+local script){ua_email}".strip()

    os.makedirs(args.out_dir, exist_ok=True)

    successes = 0
    for idx, addr in enumerate(addresses, start=1):
        base_name = f"{idx:03d}_" + sanitize_filename(addr)
        out_png = os.path.join(args.out_dir, base_name + ".png")
        if args.skip_existing and os.path.exists(out_png):
            print(f"[skip] {addr} -> {out_png}")
            continue

        try:
            print(f"[geocode] {addr}")
            geo = geocode_address(
                addr,
                base_url=args.geocoder_base_url,
                email=args.geocoder_email,
                user_agent=user_agent,
            )
        except Exception as e:
            print(f"[error] Geocoding failed for '{addr}': {e}", file=sys.stderr)
            continue

        try:
            img_path, padded = save_image_for_address(
                geo,
                out_dir=args.out_dir,
                width=max(1, min(4096, int(args.width))),
                height=max(1, min(4096, int(args.height))),
                pad_ratio=float(args.pad_ratio),
                index=idx,
            )
            print(f"[ok] {addr} -> {img_path}  bbox={padded}")
            successes += 1
        except Exception as e:
            print(f"[error] Saving satellite image failed for '{addr}': {e}", file=sys.stderr)

        # Throttle geocoder requests
        time.sleep(max(0.0, float(args.delay_s)))

    print(f"Done. {successes}/{len(addresses)} succeeded. Output: {args.out_dir}")
    return 0 if successes > 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())


