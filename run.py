import requests
import math
import plotly.graph_objects as go

# -------------------------------
# Fetch earthquake data from USGS
# -------------------------------
USGS_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson"

try:
    response = requests.get(USGS_URL, timeout=10)
    response.raise_for_status()
    data = response.json()
except requests.RequestException as e:
    print(f"Error fetching earthquake data: {e}")
    exit(1)

# -------------------------------
# Process earthquake data
# -------------------------------
lats, lons, depths, mags, texts = [], [], [], [], []

for feature in data["features"]:
    coords = feature["geometry"]["coordinates"]  # [lon, lat, depth]
    lon, lat, depth_km = coords
    mag = feature["properties"]["mag"] or 0
    place = feature["properties"]["place"] or "Unknown location"

    lats.append(lat)
    lons.append(lon)
    depths.append(depth_km)
    mags.append(mag)
    texts.append(f"{place}<br>Mag: {mag}, Depth: {depth_km} km")

# -------------------------------
# Convert lat/lon/depth to 3D coordinates
# -------------------------------
EARTH_RADIUS = 6371  # km

def latlon_depth_to_xyz(lat, lon, depth_km, radius_km=EARTH_RADIUS):
    """Convert lat/lon and depth to 3D Cartesian coordinates inside the Earth."""
    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)
    r = radius_km - depth_km  # move inside the sphere
    x = r * math.cos(lat_rad) * math.cos(lon_rad)
    y = r * math.cos(lat_rad) * math.sin(lon_rad)
    z = r * math.sin(lat_rad)
    return x, y, z

xs, ys, zs = [], [], []
for lat, lon, depth in zip(lats, lons, depths):
    x, y, z = latlon_depth_to_xyz(lat, lon, depth)
    xs.append(x)
    ys.append(y)
    zs.append(z)

# -------------------------------
# Create Earth sphere mesh
# -------------------------------
sphere_x, sphere_y, sphere_z = [], [], []
for lat in range(-90, 91, 5):
    for lon in range(-180, 181, 5):
        x, y, z = latlon_depth_to_xyz(lat, lon, 0)
        sphere_x.append(x)
        sphere_y.append(y)
        sphere_z.append(z)

earth_surface = go.Mesh3d(
    x=sphere_x,
    y=sphere_y,
    z=sphere_z,
    opacity=0.3,
    color='blue',
    alphahull=0,
    name="Earth Surface"
)

# -------------------------------
# Earthquake points
# -------------------------------
earthquakes = go.Scatter3d(
    x=xs,
    y=ys,
    z=zs,
    mode='markers',
    marker=dict(
        size=[max(2, mag * 2) for mag in mags],  # scale by magnitude
        color=depths,  # color by depth
        colorscale='Turbo',
        colorbar=dict(title='Depth (km)'),
        opacity=0.8
    ),
    text=texts,
    hoverinfo='text',
    name="Earthquakes"
)

# -------------------------------
# Plot
# -------------------------------
fig = go.Figure(data=[earth_surface, earthquakes])
fig.update_layout(
    title="3D Earthquake Map with Depth (Past Day)",
    scene=dict(
        xaxis=dict(showbackground=False, visible=False),
        yaxis=dict(showbackground=False, visible=False),
        zaxis=dict(showbackground=False, visible=False),
        aspectmode='data'
    ),
    margin=dict(l=0, r=0, t=50, b=0)
)

# Set initial camera view to Japan
fig.update_layout(
    scene_camera=dict(
        eye=dict(x=-1.5, y=1.5, z=1.0),
        center=dict(x=0, y=0, z=0)
    )
)

fig.show()
