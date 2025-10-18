import argparse
from time import sleep

import pandas as pd
from geopy.geocoders import Nominatim


def _parse_pair(value: str) -> tuple[float, float]:
    lat_str, lon_str = str(value).split(",")
    return float(lat_str.strip()), float(lon_str.strip())


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--in_csv", type=str, default="data/Training Data - Sheet1.csv")
    p.add_argument("--out_csv", type=str, default="data/labels.csv")
    p.add_argument("--zoom", type=int, default=19)
    p.add_argument("--img_size_px", type=int, default=512)
    p.add_argument("--image_root", type=str, default="data/images")
    p.add_argument("--delay_s", type=float, default=1.2)
    args = p.parse_args()

    df = pd.read_csv(args.in_csv)

    geocoder = Nominatim(user_agent="entrypoint_poc")
    rows = []
    for _, r in df.iterrows():
        ent_lat, ent_lon = _parse_pair(r["Entrance (lat, long)"])
        loc = geocoder.geocode(r["Address"])
        if loc is None:
            print(f"Warning: could not geocode '{r['Address']}', skipping")
            continue
        center_lat, center_lon = loc.latitude, loc.longitude
        img_path = f"{args.image_root}/{r['Building'].replace(' ', '_')}.png"
        rows.append(
            {
                "image_path": img_path,
                "center_lat": center_lat,
                "center_lon": center_lon,
                "entrance_lat": ent_lat,
                "entrance_lon": ent_lon,
                "zoom": args.zoom,
                "img_size_px": args.img_size_px,
            }
        )
        sleep(args.delay_s)

    out = pd.DataFrame(rows)
    out.to_csv(args.out_csv, index=False)
    print(f"Wrote {len(out)} rows to {args.out_csv}")


if __name__ == "__main__":
    main()
