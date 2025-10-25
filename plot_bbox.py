from satdist.map import MAX_SATELLITE_ZOOM, save_map_html
from satdist.fetch import save_satellite_bbox

# Example center and bbox
center_lat = 47.6007247
center_lon = -122.139411
south = 47.6006395
west = -122.139536
north = 47.6008162
east = -122.1392861

html_path = save_map_html(
    center_lat,
    center_lon,
    south,
    west,
    north,
    east,
    out_html="building_bbox.html",
    zoom_start=MAX_SATELLITE_ZOOM,
)
print(f"Map saved to {html_path}")

try:
    img_path = save_satellite_bbox(south, west, north, east, width=1024, height=1024, out="building_bbox_satellite.png")
    print(f"Satellite image saved to {img_path}")
except Exception as e:
    print(f"Could not save satellite image: {e}")
