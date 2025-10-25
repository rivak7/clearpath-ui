import math

import satdist


def test_haversine_zero():
    assert satdist.haversine_m(0.0, 0.0, 0.0, 0.0) == 0.0


def test_haversine_known_pair():
    # Roughly 1 degree of latitude ~ 111.2 km
    d = satdist.haversine_m(0.0, 0.0, 1.0, 0.0)
    assert 111_000 <= d <= 111_500


def test_pixel_mapping_and_distance_small_bbox():
    south, west, north, east = 47.6006395, -122.139536, 47.6008162, -122.1392861
    w, h = 1000, 800
    lon, lat = satdist.pixel_to_lonlat(0, 0, w, h, south, west, north, east)
    assert math.isclose(lat, north, rel_tol=0, abs_tol=1e-9)
    assert math.isclose(lon, west, rel_tol=0, abs_tol=1e-9)

    # 10 px horizontally near center should be a small distance
    d = satdist.distance_between_image_pixels_m(w / 2, h / 2, w / 2 + 10, h / 2, w, h, south, west, north, east)
    assert d > 0
    assert d < 20  # on the order of a few meters for this bbox

