import folium

# Center coordinates from your result
center_lat = 47.6007247
center_lon = -122.139411

# Bounding box from your result
south = 47.6006395
west = -122.139536
north = 47.6008162
east = -122.1392861

# Create map centered at the building
m = folium.Map(location=[center_lat, center_lon], zoom_start=20)

# Add center marker
folium.Marker(
    [center_lat, center_lon],
    popup="Center Point",
    icon=folium.Icon(color="red", icon="info-sign")
).add_to(m)

# Add bounding box rectangle
folium.Rectangle(
    bounds=[[south, west], [north, east]],
    color="blue",
    weight=2,
    fill=True,
    fill_opacity=0.2
).add_to(m)

# Save and open map
m.save("building_bbox.html")
print("Map saved to building_bbox.html")
