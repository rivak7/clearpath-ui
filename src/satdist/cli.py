from __future__ import annotations

import argparse
import sys

from .distance import distance_between_image_pixels_m, distance_between_latlon_m
from .fetch import save_satellite_bbox
from .map import save_map_html


def cmd_fetch(args: argparse.Namespace) -> int:
    path = save_satellite_bbox(
        south=args.south,
        west=args.west,
        north=args.north,
        east=args.east,
        width=args.width,
        height=args.height,
        out=args.out,
    )
    print(path)
    return 0


def cmd_distance(args: argparse.Namespace) -> int:
    if args.lat1 is not None and args.lon1 is not None and args.lat2 is not None and args.lon2 is not None:
        d = distance_between_latlon_m(args.lat1, args.lon1, args.lat2, args.lon2)
        print(f"{d:.3f}")
        return 0

    required = [args.south, args.west, args.north, args.east, args.width, args.height, args.x1, args.y1, args.x2, args.y2]
    if any(v is None for v in required):
        print("Provide either lat/lon pairs OR pixel + bbox + size inputs", file=sys.stderr)
        return 2

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
    print(f"{d:.3f}")
    return 0


def cmd_map(args: argparse.Namespace) -> int:
    center_lat = args.center_lat if args.center_lat is not None else (args.south + args.north) / 2.0
    center_lon = args.center_lon if args.center_lon is not None else (args.west + args.east) / 2.0
    path = save_map_html(center_lat, center_lon, args.south, args.west, args.north, args.east, out_html=args.out_html, zoom_start=args.zoom)
    print(path)
    return 0


def build_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="satdist", description="Satellite bbox utilities")
    sub = p.add_subparsers(dest="command", required=True)

    pf = sub.add_parser("fetch", help="Fetch satellite image for bbox")
    pf.add_argument("--south", type=float, required=True)
    pf.add_argument("--west", type=float, required=True)
    pf.add_argument("--north", type=float, required=True)
    pf.add_argument("--east", type=float, required=True)
    pf.add_argument("--width", type=int, default=1024)
    pf.add_argument("--height", type=int, default=1024)
    pf.add_argument("--out", type=str, default=None)
    pf.set_defaults(func=cmd_fetch)

    pd = sub.add_parser("distance", help="Compute distance between two points")
    pd.add_argument("--lat1", type=float)
    pd.add_argument("--lon1", type=float)
    pd.add_argument("--lat2", type=float)
    pd.add_argument("--lon2", type=float)
    pd.add_argument("--south", type=float)
    pd.add_argument("--west", type=float)
    pd.add_argument("--north", type=float)
    pd.add_argument("--east", type=float)
    pd.add_argument("--width", type=int)
    pd.add_argument("--height", type=int)
    pd.add_argument("--x1", type=float)
    pd.add_argument("--y1", type=float)
    pd.add_argument("--x2", type=float)
    pd.add_argument("--y2", type=float)
    pd.set_defaults(func=cmd_distance)

    pm = sub.add_parser("map", help="Create interactive Folium map with measure tool")
    pm.add_argument("--south", type=float, required=True)
    pm.add_argument("--west", type=float, required=True)
    pm.add_argument("--north", type=float, required=True)
    pm.add_argument("--east", type=float, required=True)
    pm.add_argument("--center-lat", dest="center_lat", type=float)
    pm.add_argument("--center-lon", dest="center_lon", type=float)
    pm.add_argument("--zoom", type=int, default=19)
    pm.add_argument("--out-html", dest="out_html", type=str, default="building_bbox.html")
    pm.set_defaults(func=cmd_map)

    return p


def main(argv: list[str] | None = None) -> int:
    p = build_parser()
    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())

