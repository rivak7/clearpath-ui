#!/usr/bin/env python3
"""
Thin wrapper CLI to fetch a satellite image for a bbox using the satdist package.
"""

import argparse
import sys

from satdist.fetch import save_satellite_bbox


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch satellite image for a bounding box and save to file")
    parser.add_argument("--south", required=True, type=float, help="South latitude (minY)")
    parser.add_argument("--west", required=True, type=float, help="West longitude (minX)")
    parser.add_argument("--north", required=True, type=float, help="North latitude (maxY)")
    parser.add_argument("--east", required=True, type=float, help="East longitude (maxX)")
    parser.add_argument("--width", type=int, default=1024, help="Image width in pixels (default 1024)")
    parser.add_argument("--height", type=int, default=1024, help="Image height in pixels (default 1024)")
    parser.add_argument("--out", type=str, default=None, help="Output file path")

    args = parser.parse_args()

    if not (args.south < args.north and args.west < args.east):
        print("Invalid bbox: require south < north and west < east", file=sys.stderr)
        return 2

    width = max(1, min(4096, args.width))
    height = max(1, min(4096, args.height))
    path = save_satellite_bbox(args.south, args.west, args.north, args.east, width=width, height=height, out=args.out)
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

