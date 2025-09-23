import argparse
import os
import random
from typing import Iterable, List, Mapping

import numpy as np
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, random_split

from .dataset import EntranceDataset
from .geo import meters_per_pixel
from .model import EntranceRegressor


def set_seed(seed: int = 1337) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)
    torch.cuda.manual_seed_all(seed)


def train_one_epoch(model, loader, device, criterion, optimizer) -> float:
    model.train()
    total = 0.0
    for imgs, targets in loader:
        imgs = imgs.to(device)
        targets = targets.to(device)
        preds = model(imgs)
        loss = criterion(preds, targets)
        optimizer.zero_grad()
        loss.backward()
        optimizer.step()
        total += loss.item() * imgs.size(0)
    return total / len(loader.dataset)


def _as_mapping(row) -> Mapping[str, float]:
    if isinstance(row, Mapping):
        return row
    if hasattr(row, "_asdict"):
        return row._asdict()
    return dict(row)


@torch.no_grad()
def evaluate(model, loader, device, criterion, rows: Iterable) -> tuple[float, float, float]:
    model.eval()
    total_loss = 0.0
    pixel_errs: List[float] = []
    meter_errs: List[float] = []
    rows_list = [_as_mapping(r) for r in rows]
    offset = 0
    for imgs, targets in loader:
        batch_rows = rows_list[offset : offset + len(imgs)]
        offset += len(imgs)

        imgs = imgs.to(device)
        targets = targets.to(device)
        preds = model(imgs)
        loss = criterion(preds, targets)
        total_loss += loss.item() * imgs.size(0)

        preds_np = preds.cpu().numpy()
        targets_np = targets.cpu().numpy()
        for i, row in enumerate(batch_rows):
            x_pred, y_pred = preds_np[i]
            x_t, y_t = targets_np[i]
            img_size = int(row["img_size_px"])
            px_err = np.sqrt(((x_pred - x_t) * img_size) ** 2 + ((y_pred - y_t) * img_size) ** 2)
            pixel_errs.append(float(px_err))
            mpp = meters_per_pixel(row["center_lat"], int(row["zoom"]))
            meter_errs.append(float(px_err * mpp))
    avg_loss = total_loss / len(loader.dataset)
    avg_px_err = float(np.mean(pixel_errs)) if pixel_errs else float("nan")
    avg_meter_err = float(np.mean(meter_errs)) if meter_errs else float("nan")
    return avg_loss, avg_px_err, avg_meter_err


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--labels", type=str, default="data/labels.csv")
    parser.add_argument("--epochs", type=int, default=40)
    parser.add_argument("--batch_size", type=int, default=8)
    parser.add_argument("--lr", type=float, default=3e-4)
    parser.add_argument("--val_split", type=float, default=0.2)
    parser.add_argument("--out_dir", type=str, default="checkpoints")
    parser.add_argument("--seed", type=int, default=1337)
    args = parser.parse_args()

    set_seed(args.seed)
    os.makedirs(args.out_dir, exist_ok=True)

    ds = EntranceDataset(args.labels)
    n_total = len(ds)
    n_val = max(1, int(n_total * args.val_split))
    n_train = max(1, n_total - n_val)
    train_ds, val_ds = random_split(
        ds, [n_train, n_val], generator=torch.Generator().manual_seed(args.seed)
    )

    import pandas as pd

    df = pd.read_csv(args.labels)
    train_rows = df.iloc[train_ds.indices].to_dict("records")
    val_rows = df.iloc[val_ds.indices].to_dict("records")

    train_loader = DataLoader(
        train_ds, batch_size=args.batch_size, shuffle=True, num_workers=2, pin_memory=True
    )
    val_loader = DataLoader(
        val_ds, batch_size=args.batch_size, shuffle=False, num_workers=2, pin_memory=True
    )

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    model = EntranceRegressor(pretrained=True).to(device)
    criterion = nn.SmoothL1Loss()
    optimizer = optim.Adam(model.parameters(), lr=args.lr)

    best_val = float("inf")
    best_path = os.path.join(args.out_dir, "best.pt")

    for epoch in range(1, args.epochs + 1):
        tr_loss = train_one_epoch(model, train_loader, device, criterion, optimizer)
        val_loss, px_err, m_err = evaluate(
            model, val_loader, device, criterion, val_rows
        )
        print(
            f"Epoch {epoch:03d} | train {tr_loss:.4f} | val {val_loss:.4f} | avg px err {px_err:.2f} | avg meter err {m_err:.2f}"
        )
        if val_loss < best_val:
            best_val = val_loss
            torch.save({"model": model.state_dict()}, best_path)

    print(f"Saved best model to {best_path}")


if __name__ == "__main__":
    main()
