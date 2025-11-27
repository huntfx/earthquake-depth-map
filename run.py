import dash
from dash import dcc, html, Input, Output
import plotly.graph_objects as go
import requests
import numpy as np
import json

# -------------------------------
# 1. Data Fetching & Prep
# -------------------------------
print("Fetching Earthquake Data...")
USGS_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_month.geojson"
BORDERS_URL = "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json"

# Earth Constants
EARTH_RADIUS = 6371  # km

def fetch_data():
    # Fetch Quakes
    try:
        r_quake = requests.get(USGS_URL, timeout=10)
        r_quake.raise_for_status()
        quake_data = r_quake.json()
    except Exception as e:
        print(f"Error fetching quakes: {e}")
        return [], [], [], [], []

    # Fetch Country Borders for the "Transparent Map" look
    try:
        r_border = requests.get(BORDERS_URL, timeout=10)
        border_data = r_border.json()
    except Exception as e:
        print(f"Error fetching borders: {e}")
        border_data = None

    return quake_data, border_data

quake_json, border_json = fetch_data()

# Pre-process Quake Data into NumPy arrays for speed
lats, lons, depths, mags, places = [], [], [], [], []
for feature in quake_json.get("features", []):
    coords = feature["geometry"]["coordinates"]
    lats.append(coords[1])
    lons.append(coords[0])
    depths.append(coords[2])
    props = feature["properties"]
    mags.append(props.get("mag") or 0)
    places.append(props.get("place") or "Unknown")

# Convert to numpy for vector math
lats = np.array(lats)
lons = np.array(lons)
depths = np.array(depths)
mags = np.array(mags)

# -------------------------------
# 2. Math Helpers (Vectorized)
# -------------------------------
def latlon_to_xyz(lat, lon, radius):
    """Convert lat/lon to 3D Cartesian coordinates."""
    # Convert to radians
    lat_rad = np.radians(lat)
    lon_rad = np.radians(lon)

    # Spherical conversion
    x = radius * np.cos(lat_rad) * np.cos(lon_rad)
    y = radius * np.cos(lat_rad) * np.sin(lon_rad)
    z = radius * np.sin(lat_rad)
    return x, y, z

# -------------------------------
# 3. Generate Static Assets (Country Borders)
# -------------------------------
# We generate the country border lines once to avoid recalculating on every slider move
b_x, b_y, b_z = [], [], []

if border_json:
    print("Processing Country Borders...")
    for feature in border_json['features']:
        geo_type = feature['geometry']['type']
        coords = feature['geometry']['coordinates']

        # Handle Polygon and MultiPolygon
        polygons = coords if geo_type == 'Polygon' else [p for p in coords] # MultiPolygon is list of polygons

        for poly in polygons:
            # GeoJSON polygons are usually lists of lists of points.
            # Sometimes MultiPolygon is nested differently, simplified handling here:
            if geo_type == 'MultiPolygon':
                poly = poly[0]

            # Extract lons and lats
            try:
                # Convert list of lists to numpy
                pts = np.array(poly)
                b_lons = pts[:, 0]
                b_lats = pts[:, 1]

                # Convert to XYZ on surface
                bx, by, bz = latlon_to_xyz(b_lats, b_lons, EARTH_RADIUS)

                b_x.extend(bx.tolist())
                b_y.extend(by.tolist())
                b_z.extend(bz.tolist())
                # Add None to break the line between countries
                b_x.append(None)
                b_y.append(None)
                b_z.append(None)
            except Exception:
                continue

# Create the Border Trace
border_trace = go.Scatter3d(
    x=b_x, y=b_y, z=b_z,
    mode='lines',
    line=dict(color='cyan', width=1),
    hoverinfo='skip',
    name='Countries',
    opacity=0.3
)

# Create a Reference Sphere (Transparent Surface)
# Create a mesh grid
phi = np.linspace(0, np.pi, 50)
theta = np.linspace(0, 2*np.pi, 50)
phi, theta = np.meshgrid(phi, theta)
x_sphere = EARTH_RADIUS * np.sin(phi) * np.cos(theta)
y_sphere = EARTH_RADIUS * np.sin(phi) * np.sin(theta)
z_sphere = EARTH_RADIUS * np.cos(phi)

sphere_trace = go.Mesh3d(
    x=x_sphere.flatten(),
    y=y_sphere.flatten(),
    z=z_sphere.flatten(),
    alphahull=0,
    opacity=0.1,
    color='black',
    hoverinfo='skip'
)

# -------------------------------
# 4. Dash App Layout
# -------------------------------
app = dash.Dash(__name__)

app.layout = html.Div([
    html.H2("Earthquake Depth Map", style={'color': 'white', 'textAlign': 'center'}),

    # Controls Container
    html.Div([
        # Size Slider
        html.Div([
            html.Label("Marker Size Scale:", style={'color': 'white'}),
            dcc.Slider(
                id='size-slider',
                min=1, max=10, step=0.5, value=3,
                marks={1: '1x', 5: '5x', 10: '10x'},
            )
        ], style={'width': '45%', 'display': 'inline-block', 'padding': '10px'}),

        # Depth Slider
        html.Div([
            html.Label("Depth Exaggeration (Visual Only):", style={'color': 'white'}),
            dcc.Slider(
                id='depth-slider',
                min=1, max=50, step=1, value=10,
                marks={1: 'Real', 10: '10x', 25: '25x', 50: '50x'},
            )
        ], style={'width': '45%', 'display': 'inline-block', 'padding': '10px'}),
    ], style={'backgroundColor': '#222', 'padding': '10px'}),

    # The Graph
    dcc.Graph(id='earth-graph', style={'height': '85vh'})
], style={'backgroundColor': 'black', 'height': '100vh', 'fontFamily': 'sans-serif'})


# -------------------------------
# 5. Callback Logic
# -------------------------------
@app.callback(
    Output('earth-graph', 'figure'),
    [Input('size-slider', 'value'),
     Input('depth-slider', 'value')]
)
def update_graph(size_scale, depth_scale):

    # 1. Calculate earthquake positions based on Depth Exaggeration
    r_quakes = EARTH_RADIUS - (depths * depth_scale)
    qx, qy, qz = latlon_to_xyz(lats, lons, r_quakes)

    # 2. Text Labels
    hover_text = [
        f"{p}<br>Mag: {m}<br>Depth: {d}km<br>(Vis Depth: {d*depth_scale:.0f}km)"
        for p, m, d in zip(places, mags, depths)
    ]

    # 3. FIX: Handle negative magnitudes
    # We clamp the magnitude to a minimum of 0.1 so Plotly doesn't crash
    # np.maximum compares the array against 0.1 and takes the larger value
    safe_mags = np.maximum(mags, 0.1)

    # 4. Quake Trace
    quake_trace = go.Scatter3d(
        x=qx, y=qy, z=qz,
        mode='markers',
        marker=dict(
            size=safe_mags * size_scale,  # Use the sanitized magnitudes
            color=depths,
            colorscale='Turbo',
            cmin=0, cmax=700,
            colorbar=dict(title='Real Depth (km)', x=0),
            opacity=0.9,
            line=dict(width=0)
        ),
        text=hover_text,
        hoverinfo='text',
        name='Quakes'
    )

    # 5. Figure Setup
    fig = go.Figure(data=[sphere_trace, border_trace, quake_trace])

    fig.update_layout(
        paper_bgcolor='black',
        plot_bgcolor='black',
        scene=dict(
            xaxis=dict(visible=False, showbackground=False),
            yaxis=dict(visible=False, showbackground=False),
            zaxis=dict(visible=False, showbackground=False),
            aspectmode='data',
            camera=dict(
                eye=dict(x=0.6, y=0.6, z=0.6),
                center=dict(x=0, y=0, z=0)
            ),
            dragmode='orbit'
        ),
        margin=dict(l=0, r=0, t=0, b=0),
        legend=dict(font=dict(color='white'))
    )

    return fig

if __name__ == '__main__':
    app.run(debug=True)
