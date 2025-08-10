#!/usr/bin/env python3
"""
Example CLI to compute the distance between two points either:
- As pixel coordinates on a static satellite image rendered for a bbox, or
- As lat/lon coordinates directly.

Usage (pixels):
  python compute_distance_example.py \
    --south 47.6006395 --west -122.139536 --north 47.6008162 --east -122.1392861 \
    --width 1024 --height 1024 \
    --x1 512 --y1 512 --x2 522 --y2 512

Usage (latlon):
  python compute_distance_example.py \
    --lat1 47.6007247 --lon1 -122.139411 \
    --lat2 47.6007247 --lon2 -122.139300
"""

import argparse
from geo_distance import (
    distance_between_image_pixels_m,
    distance_between_latlon_m,
)


def main() -> int:
    p = argparse.ArgumentParser(description="Compute distance between two points")
    # Pixel-based mode
    p.add_argument("--south", type=float, help="BBOX south (min lat)")
    p.add_argument("--west", type=float, help="BBOX west (min lon)")
    p.add_argument("--north", type=float, help="BBOX north (max lat)")
    p.add_argument("--east", type=float, help="BBOX east (max lon)")
    p.add_argument("--width", type=int, help="Image width in pixels")
    p.add_argument("--height", type=int, help="Image height in pixels")
    p.add_argument("--x1", type=float, help="First point x (px)")
    p.add_argument("--y1", type=float, help="First point y (px)")
    p.add_argument("--x2", type=float, help="Second point x (px)")
    p.add_argument("--y2", type=float, help="Second point y (px)")

    # Lat/Lon mode
    p.add_argument("--lat1", type=float, help="First point latitude")
    p.add_argument("--lon1", type=float, help="First point longitude")
    p.add_argument("--lat2", type=float, help="Second point latitude")
    p.add_argument("--lon2", type=float, help="Second point longitude")

    args = p.parse_args()

    # Prefer lat/lon mode if fully provided
    if args.lat1 is not None and args.lon1 is not None and args.lat2 is not None and args.lon2 is not None:
        d = distance_between_latlon_m(args.lat1, args.lon1, args.lat2, args.lon2)
        print(f"Distance (lat/lon): {d:.3f} m")
        return 0

    # Otherwise require pixel + bbox + image size
    required = [args.south, args.west, args.north, args.east, args.width, args.height, args.x1, args.y1, args.x2, args.y2]
    if any(v is None for v in required):
        p.error("Provide either full lat/lon inputs OR pixel + bbox + size inputs")

    d = distance_between_image_pixels_m(
        args.x1,
        args.y1,
        args.x2,
        args.y2,
        args.width,
        args.height,
        args.south,
        args.west,
        args.north,
        args.east,
    )
    print(f"Distance (pixels on bbox image): {d:.3f} m")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

