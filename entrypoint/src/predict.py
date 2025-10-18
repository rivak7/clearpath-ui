import argparse

import torch
from PIL import Image
import torchvision.transforms as T

from .geo import pixel_xy_to_latlon_in_image
from .model import EntranceRegressor


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--weights", type=str, default="checkpoints/best.pt")
    p.add_argument("--image_path", type=str, required=True)
    p.add_argument("--center_lat", type=float, required=True)
    p.add_argument("--center_lon", type=float, required=True)
    p.add_argument("--zoom", type=int, default=19)
    p.add_argument("--img_size_px", type=int, default=512)
    args = p.parse_args()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")

    model = EntranceRegressor(pretrained=False).to(device)
    ckpt = torch.load(args.weights, map_location=device)
    model.load_state_dict(ckpt["model"])
    model.eval()

    img = Image.open(args.image_path).convert("RGB")
    if img.size != (args.img_size_px, args.img_size_px):
        img = img.resize((args.img_size_px, args.img_size_px))
    tfm = T.Compose(
        [
            T.ToTensor(),
            T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
        ]
    )
    x = tfm(img).unsqueeze(0).to(device)
    with torch.no_grad():
        y = model(x).cpu().numpy()[0]

    x_norm, y_norm = float(y[0]), float(y[1])
    px = x_norm * args.img_size_px
    py = y_norm * args.img_size_px

    lat_pred, lon_pred = pixel_xy_to_latlon_in_image(
        px, py, args.center_lat, args.center_lon, args.zoom, args.img_size_px
    )
    print(f"Pred normalized: ({x_norm:.4f}, {y_norm:.4f})")
    print(f"Pred entrance lat,lon: {lat_pred:.8f}, {lon_pred:.8f}")


if __name__ == "__main__":
    main()
