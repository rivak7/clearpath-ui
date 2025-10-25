# EntryPoint POC: Entrance keypoint regressor

## Assumptions
- Images are north-up Web Mercator static tiles at a fixed zoom, square size (default 512).
- Each row in `data/labels.csv` includes `image_path`, `center_lat`, `center_lon`, `entrance_lat`, `entrance_lon`, `zoom`, `img_size_px`.
- Your screenshot pipeline must ensure the image center aligns to the provided `center_lat`, `center_lon` and the zoom matches.

## Setup
```bash
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# Prepare labels (optional for your current sheet)
python -m src.prep_labels --in_csv data/Training\ Data\ -\ Sheet1.csv --out_csv data/labels.csv \
  --zoom 19 --img_size_px 512 --image_root data/images
```

Place your corresponding images in `data/images/` with the exact filenames used in `labels.csv`.

## Train
```bash
python -m src.train --labels data/labels.csv --epochs 40 --batch_size 8 --lr 3e-4
```

## Predict on one image
```bash
python -m src.predict --weights checkpoints/best.pt \
  --image_path data/images/Suzzallo_Library.png \
  --center_lat 47.6561 --center_lon -122.3094 --zoom 19 --img_size_px 512
```

## Notes
- Metric prints average pixel error and approximate average meter error using Web Mercator ground sampling distance at the building latitude.
- Keep imagery provider consistent. Disable rotation, tilt, or bearing. North-up only.
- For better robustness, collect at least hundreds of buildings per campus. Cover all quadrants and facade styles.

---

## How to run it end-to-end in Cursor
1. Paste the “Paste this to Cursor’s Codex CLI” section into Cursor and let it create files.  
2. Drop your aerial screenshots in `data/images/` with the exact filenames used in `labels.csv`.  
3. If you only have the CSV with “Entrance (lat, long)”, run `src/prep_labels.py` to produce `labels.csv`.  
4. Train with `src/train.py`.  
5. Test with `src/predict.py`, then project predicted pixels back to lat, lon for navigation.  

This will work. It is a clean baseline.

---

## Hard truths and fast upgrades
- **Data size**. Thirty samples will overfit. Add data quickly. Target 500 to 2,000 unique buildings from varied campuses for a strong v1.  
- **Augmentation**. Once the baseline runs, add color jitter, mild blur, and very small perspective jitter. Avoid flips or rotations until you implement matching label transforms.  
- **Better head**. Replace regression with a small heatmap head and soft-argmax for sharper localization.  
- **Provider variance**. Train with mixed providers to avoid provider lock-in artifacts.  
- **Moat**. Close the loop with in-product user taps. When a driver taps the true entrance, log that as a new label and retrain weekly.  
- **License**. Satellite providers have usage limits. For a B2B SaaS, secure a commercial imagery license before scale.  
- **Latency**. Precompute and cache entrance coordinates for all known destinations. Query becomes O(1).  

You want top 0.00000001 percent output. This is how you build it. Ship the baseline, measure errors in meters, add data, and iterate. When you are ready, I will give you the upgraded heatmap architecture, on-device quantization, and an active-learning data engine that turns every customer click into training gold.
