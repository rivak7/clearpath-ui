"""CLI helper to fetch a satellite tile around a geocoded center and run the CNN entrance regressor."""

from __future__ import annotations

import argparse
import io
import json
import math
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Tuple

import torch
import torchvision.transforms as T
from PIL import Image

from .geo import meters_per_pixel, pixel_xy_to_latlon_in_image
from .model import EntranceRegressor

ARCGIS_EXPORT_BASES = [
    "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export",
    "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export",
]


def compute_bbox(center_lat: float, center_lon: float, zoom: int, img_size_px: int) -> Tuple[float, float, float, float]:
    """Return (south, west, north, east) bounding box covering the square image."""
    mpp = meters_per_pixel(center_lat, zoom)
    half_meters = (img_size_px / 2.0) * mpp
    delta_lat = half_meters / 111_320.0
    cos_lat = math.cos(math.radians(center_lat))
    cos_lat = max(cos_lat, 1e-6)
    delta_lon = half_meters / (111_320.0 * cos_lat)
    south = center_lat - delta_lat
    north = center_lat + delta_lat
    west = center_lon - delta_lon
    east = center_lon + delta_lon
    return south, west, north, east


def fetch_imagery(south: float, west: float, north: float, east: float, size: int, timeout: float) -> bytes:
    params = {
        "bbox": f"{west},{south},{east},{north}",
        "bboxSR": "4326",
        "size": f"{size},{size}",
        "imageSR": "3857",
        "dpi": "96",
        "format": "png",
        "transparent": "false",
        "f": "image",
    }
    last_exc: Exception | None = None
    for base in ARCGIS_EXPORT_BASES:
        url = base + "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={"User-Agent": "entrypoint-cnn/0.1"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                ctype = resp.headers.get("Content-Type", "")
                if "image" not in ctype.lower():
                    # consume body for hygiene, then continue trying
                    _ = resp.read()
                    continue
                return resp.read()
        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            continue
    raise RuntimeError(f"failed to fetch imagery: {last_exc}")


def run_inference(center_lat: float, center_lon: float, zoom: int, img_size_px: int, weights: Path, image_out: Path | None, timeout: float) -> dict:
    if not weights.exists():
        raise FileNotFoundError(f"weights not found: {weights}")

    south, west, north, east = compute_bbox(center_lat, center_lon, zoom, img_size_px)
    raw_img = fetch_imagery(south, west, north, east, img_size_px, timeout)

    pil_img = Image.open(io.BytesIO(raw_img)).convert("RGB")
    if image_out is not None:
        image_out.parent.mkdir(parents=True, exist_ok=True)
        pil_img.save(image_out)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = EntranceRegressor(pretrained=False).to(device)
    ckpt = torch.load(weights, map_location=device)
    if isinstance(ckpt, dict) and "model" in ckpt:
        state_dict = ckpt["model"]
    else:
        state_dict = ckpt
    model.load_state_dict(state_dict)
    model.eval()

    tfm = T.Compose([
        T.ToTensor(),
        T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
    ])
    x = tfm(pil_img).unsqueeze(0).to(device)

    with torch.no_grad():
        preds = model(x)
    x_norm = float(preds[0, 0].item())
    y_norm = float(preds[0, 1].item())
    px = x_norm * img_size_px
    py = y_norm * img_size_px
    lat_pred, lon_pred = pixel_xy_to_latlon_in_image(px, py, center_lat, center_lon, zoom, img_size_px)

    return {
        "center_lat": center_lat,
        "center_lon": center_lon,
        "zoom": zoom,
        "img_size_px": img_size_px,
        "bbox": {"south": south, "west": west, "north": north, "east": east},
        "image_path": str(image_out) if image_out is not None else None,
        "prediction": {
            "x_norm": x_norm,
            "y_norm": y_norm,
            "px": px,
            "py": py,
            "lat": lat_pred,
            "lon": lon_pred,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Run CNN entrance prediction for a geocoded location.")
    default_weights = Path(__file__).resolve().parent.parent / "checkpoints" / "best.pt"
    parser.add_argument("--center_lat", type=float, required=True)
    parser.add_argument("--center_lon", type=float, required=True)
    parser.add_argument("--zoom", type=int, default=19)
    parser.add_argument("--img_size_px", type=int, default=512)
    parser.add_argument("--weights", type=Path, default=default_weights)
    parser.add_argument("--image_out", type=Path, default=None)
    parser.add_argument("--timeout", type=float, default=15.0, help="Imagery fetch timeout in seconds")

    args = parser.parse_args()

    start = time.perf_counter()
    try:
        result = run_inference(
            center_lat=args.center_lat,
            center_lon=args.center_lon,
            zoom=args.zoom,
            img_size_px=args.img_size_px,
            weights=args.weights,
            image_out=args.image_out,
            timeout=args.timeout,
        )
        result["runtime_ms"] = (time.perf_counter() - start) * 1000.0
        print(json.dumps(result))
        return 0
    except Exception as exc:  # noqa: BLE001
        error_payload = {"error": exc.__class__.__name__, "message": str(exc)}
        error_payload["runtime_ms"] = (time.perf_counter() - start) * 1000.0
        print(json.dumps(error_payload))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

