import pandas as pd
from PIL import Image
import torch
from torch.utils.data import Dataset
import torchvision.transforms as T

from .geo import latlon_to_pixel_xy_in_image


class EntranceDataset(Dataset):
    def __init__(self, csv_path, transforms=None):
        self.df = pd.read_csv(csv_path)
        needed = [
            "image_path",
            "center_lat",
            "center_lon",
            "entrance_lat",
            "entrance_lon",
            "zoom",
            "img_size_px",
        ]
        missing = [c for c in needed if c not in self.df.columns]
        if missing:
            raise ValueError(f"labels.csv missing columns: {missing}")
        self.transforms = transforms

    def __len__(self):
        return len(self.df)

    def __getitem__(self, idx):
        row = self.df.iloc[idx]
        img = Image.open(row["image_path"]).convert("RGB")

        # Enforce expected size
        img_size = int(row["img_size_px"])
        if img.size != (img_size, img_size):
            img = img.resize((img_size, img_size), Image.BILINEAR)

        # Compute pixel label then normalize to [0,1]
        px, py = latlon_to_pixel_xy_in_image(
            row["entrance_lat"],
            row["entrance_lon"],
            row["center_lat"],
            row["center_lon"],
            int(row["zoom"]),
            img_size_px=img_size,
        )
        x_norm = max(0.0, min(1.0, px / img_size))
        y_norm = max(0.0, min(1.0, py / img_size))

        if self.transforms is None:
            transforms = T.Compose(
                [
                    T.ToTensor(),
                    T.Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225]),
                ]
            )
        else:
            transforms = self.transforms

        img = transforms(img)
        target = torch.tensor([x_norm, y_norm], dtype=torch.float32)
        return img, target
