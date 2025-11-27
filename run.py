import requests
import math
import plotly.graph_objects as go

# -------------------------------
# Fetch earthquake data from USGS
# -------------------------------
# This URL gets all earthquakes from the past day (GeoJSON format)
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
    lon, lat, depth = coords
    mag = feature["properties"]["mag"] or 0
    place = feature["properties"]["place"] or "Unknown location"

    lats.append(lat)
    lons.append(lon)
    depths.append(depth)
    mags.append(mag)
    texts.append(f"{place}<br>Mag: {mag}, Depth: {depth} km")

# -------------------------------
# Convert lat/lon to 3D coordinates
# -------------------------------
def latlon_to_xyz(lat, lon, radius=1):
    """Convert latitude/longitude to 3D Cartesian coordinates."""
    lat_rad = math.radians(lat)
    lon_rad = math.radians(lon)
    x = radius * math.cos(lat_rad) * math.cos(lon_rad)
    y = radius * math.cos(lat_rad) * math.sin(lon_rad)
    z = radius * math.sin(lat_rad)
    return x, y, z

xs, ys, zs = [], [], []
for lat, lon in zip(lats, lons):
    x, y, z = latlon_to_xyz(lat, lon, radius=1)
    xs.append(x)
    ys.append(y)
    zs.append(z)

# -------------------------------
# Create 3D globe + earthquake points
# -------------------------------
# Create a sphere for Earth
sphere_lat = []
sphere_lon = []
sphere_x = []
sphere_y = []
sphere_z = []

for lat in range(-90, 91, 5):
    for lon in range(-180, 181, 5):
        x, y, z = latlon_to_xyz(lat, lon, radius=1)
        sphere_x.append(x)
        sphere_y.append(y)
        sphere_z.append(z)
        sphere_lat.append(lat)
        sphere_lon.append(lon)

# Earth surface trace
earth_surface = go.Mesh3d(
    x=sphere_x,
    y=sphere_y,
    z=sphere_z,
    opacity=0.3,
    color='blue',
    alphahull=0
)

# Earthquake points trace
earthquakes = go.Scatter3d(
    x=xs,
    y=ys,
    z=zs,
    mode='markers',
    marker=dict(
        size=[max(2, mag * 2) for mag in mags],  # Scale by magnitude
        color=depths,  # Color by depth
        colorscale='Turbo',
        colorbar=dict(title='Depth (km)'),
        opacity=0.8
    ),
    text=texts,
    hoverinfo='text'
)

# -------------------------------
# Plot
# -------------------------------
fig = go.Figure(data=[earth_surface, earthquakes])
fig.update_layout(
    title="3D Earthquake Map (Past Day)",
    scene=dict(
        xaxis=dict(showbackground=False, showticklabels=False, visible=False),
        yaxis=dict(showbackground=False, showticklabels=False, visible=False),
        zaxis=dict(showbackground=False, showticklabels=False, visible=False),
        aspectmode='data'
    ),
    margin=dict(l=0, r=0, t=50, b=0)
)

fig.show()
