- Repo entry points
  - Python CLI: `src/satdist/cli.py` (satdist.cli:main)
  - Batch script: `addresses_to_satellite.py` (main)
  - Bbox fetch CLI: `fetch_satellite_bbox.py` (main)
  - Node server: `server.js` (Express app)

- Key logic (files:line ranges)
  - Geocoding (Python): `addresses_to_satellite.py` L120-L186 – Nominatim `/search` with `polygon_geojson=1`, builds center + bbox.
  - Geocoding (Node): `server.js` L618-L673 – `geocodeAddress()` hits Nominatim, Photon fallback; returns bbox + optional footprint.
  - Overpass (Node): `server.js` L378-L396 – queries nearby `highway` via Overpass to project entrance; no building polygon fetch in Python.
  - Polygon→BBox: `addresses_to_satellite.py` L80-L116 – `bbox_from_geojson()` and `pad_bbox()` (pads in degrees, not meters).
  - Projection helpers: `src/satdist/distance.py` L35-L66 – pixel↔lon/lat mapping, haversine; no EPSG:3857 conversion utilities.
  - Imagery fetch: `src/satdist/fetch.py` L1-L190 – Esri World_Imagery via ArcGIS export/tiles; stitches tiles; saves PNG.
  - Map preview: `src/satdist/map.py` L1-L60 – Folium map using Esri tiles; `web/index.html` uses OSM standard tiles (not satellite).

- DONE vs MISSING (aligned to project goal)
  1) Geocode address → coord: DONE (Python + Node via Nominatim; Photon fallback in Node).
  2) Find OSM building polygon: MISSING in batch path. Only Nominatim footprint used; no Overpass building polygon query implemented in Python.
  3) BBox with 10% padding in meters, EPSG:3857 + WGS84: MISSING. Current `pad_bbox()` pads degrees; no Mercator math.
  4) Fetch imagery without paid keys: MISSING. Current source is Esri World_Imagery (restricted). NAIP (US) and EOX S2 Cloudless (global) not implemented.
  5) Save one image per address: DONE (writes PNG to `building_images/`).
  6) Write `labels.jsonl` with schema: MISSING. Per-address sidecar JSON exists, but no aggregated JSONL.
  7) Return entrance in normalized coords and convert: PARTIAL (Node server provides an entrance estimate for UI, not integrated into batch/labels).

- Minimal Change Set (exact files to touch)
  1) `src/satdist/fetch.py` – add `save_usgs_naip()` and `save_eox_s2_cloudless()`; route sources by country.
  2) `addresses_to_satellite.py` – implement `overpass_building_polygon()` to get building footprint near geocode.
  3) `addresses_to_satellite.py` – add `pad_bbox_mercator_from_poly()` for 10% padding in EPSG:3857 with inverse to WGS84.
  4) `addresses_to_satellite.py` – add `LabelsWriter` to append `labels.jsonl` records.
  5) `addresses_to_satellite.py` – enforce polite throttling for Overpass (>=1s) and deterministic User-Agent.
  6) `src/satdist/fetch.py` – set UA strings to project UA; avoid Esri defaults; mark Esri path as fallback only (or remove).
  7) `README.md` – clarify imagery sources (NAIP/EOX), note OSM has no satellite tiles.
  8) `src/satdist/cli.py` – optionally expose a subcommand to fetch NAIP/EOX by bbox.
  9) `tests/` – add unit test for mercator padding and pixel/latlon conversion.
  10) `web/index.html` (optional) – keep OSM tiles for vector; make clear they’re not satellite.

- How to Run
  - Batch (current): `python addresses_to_satellite.py --input addresses.txt --out-dir building_images --width 1024 --height 1024`
  - Python CLI (bbox): `python -m satdist.cli fetch --south <s> --west <w> --north <n> --east <e> --width 1024 --height 1024`
  - Node server: `npm install && npm start` (or `./run` on macOS/Linux)

- Gotchas
  - OSM standard tiles are not satellite imagery; do not confuse with aerial sources.
  - Respect Nominatim/Overpass usage policies: throttle (~1 req/sec), set descriptive User-Agent, add contact email.
  - Building polygons may be missing; fall back to nearest polygon centroid or geocoder bbox with conservative padding.
  - Esri World_Imagery is not permitted per this task’s constraints; use NAIP (US) and EOX S2 Cloudless (global).
  - Handle timeouts and HTTP 429; add retries with backoff where appropriate.

