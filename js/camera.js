// Plotly camera space normalises the globe (radius EARTH_RADIUS km) to coordinates of
// magnitude ~0.47. The default eye at (~1.5, ~1.5, ~1.5) sits comfortably outside it.
const PLOT_SCALE = 3000 / EARTH_RADIUS;

let _chartDiv = null;
function getChartDiv() {
    if (!_chartDiv) _chartDiv = document.getElementById('chart-container');
    return _chartDiv;
}

// Stop auto-rotation and cancel any pending resume timer.
function stopAutoRotate() {
    if (rotationTimeout) {
        clearTimeout(rotationTimeout);
        rotationTimeout = null;
    }
    autoRotate = false;
    document.getElementById('rotate-btn').innerHTML = '▶';
}

// Returns the best available camera reading. Falls back to currentCamera if the
// internal scene objects aren't reachable (they are stale during drag/inertia anyway).
function getLiveCamera() {
    const gd = getChartDiv();
    const s  = gd._fullLayout && gd._fullLayout.scene && gd._fullLayout.scene._scene;

    if (s && typeof s.getCamera === 'function') {
        const c = s.getCamera();
        if (c && c.eye && typeof c.eye.x === 'number') return c;
    }

    const glplot = s && s.glplot;
    const cam    = glplot && glplot.camera;
    const p      = cam && cam.params;
    if (p && p.eye) {
        const toVec = (v) => Array.isArray(v) ? { x: v[0], y: v[1], z: v[2] } : { x: v.x, y: v.y, z: v.z };
        return { eye: toVec(p.eye), center: toVec(p.center), up: toVec(p.up) };
    }

    return { eye: { ...currentCamera.eye }, center: { ...currentCamera.center }, up: { ...currentCamera.up } };
}

// Writes currentCamera into _fullLayout.scene.camera so any immediately following
// Plotly.restyle uses the correct position and doesn't snap the view.
// currentCamera is always synchronously updated by plotly_relayout (fired during both
// auto-rotate relayouts and manual orbit). getLiveCamera() / s.getCamera() lags by one
// WebGL paint frame behind auto-rotate relayouts, so using it here would overwrite
// _fullLayout.scene.camera with the pre-rotate position and cause a snap.
function syncSceneCamera() {
    const gd = getChartDiv();
    const lc = gd._fullLayout && gd._fullLayout.scene && gd._fullLayout.scene.camera;
    if (!lc) return;
    const live = getLiveCamera();
    lc.eye    = { ...live.eye };
    lc.center = { ...live.center };
    lc.up     = { ...live.up };
}

// Returns the current eye-to-origin distance, used to preserve zoom when navigating.
function currentEyeDist() {
    const cam = getLiveCamera();
    return Math.sqrt(cam.eye.x ** 2 + cam.eye.y ** 2 + cam.eye.z ** 2);
}

// Move the camera to face a lat/lon surface point at the given zoom distance.
// zoomDist is in Plotly camera units (~0.9 = close, ~2.2 = zoomed out).
function cameraGoTo(lat, lon, zoomDist) {
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;

    // Unit normal pointing outward from this surface location — becomes the eye direction
    const nx = Math.cos(latRad) * Math.cos(lonRad);
    const ny = Math.cos(latRad) * Math.sin(lonRad);
    const nz = Math.sin(latRad);

    // Surface point converted to Plotly camera space
    const [tx, ty, tz] = latLonToXYZ(lat, lon, EARTH_RADIUS);
    const center = {
        x: (tx / EARTH_RADIUS) * PLOT_SCALE,
        y: (ty / EARTH_RADIUS) * PLOT_SCALE,
        z: (tz / EARTH_RADIUS) * PLOT_SCALE
    };

    const cam = {
        eye: { x: nx * zoomDist, y: ny * zoomDist, z: nz * zoomDist },
        center,
        up: { x: 0, y: 0, z: 1 }
    };

    currentCamera = cam;
    Plotly.relayout('chart-container', { 'scene.camera': cam });
    stopAutoRotate();
}

// --- Search Logic ---
function searchLocation() {
    document.getElementById('quake-info').style.display = 'none';

    const input = document.getElementById('search-input');
    const btn = document.getElementById('search-btn');
    const query = input.value.trim().toLowerCase();
    if (!query) return;

    const labels = staticLabelArrays.text;
    let index = labels.findIndex(name => name.toLowerCase() === query);
    if (index === -1) index = labels.findIndex(name => name.toLowerCase().includes(query));

    if (index !== -1) {
        // Derive lat/lon from the stored label XYZ position
        const tx = staticLabelArrays.x[index];
        const ty = staticLabelArrays.y[index];
        const tz = staticLabelArrays.z[index];
        const lat = Math.asin(tz / Math.sqrt(tx*tx + ty*ty + tz*tz)) * 180 / Math.PI;
        const lon = Math.atan2(ty, tx) * 180 / Math.PI;

        cameraGoTo(lat, lon, currentEyeDist());

        input.value = "";
        btn.disabled = true;
        updatePlot();
    }
}

function searchVolcano() {
    document.getElementById('quake-info').style.display = 'none';

    const input = document.getElementById('volc-search-input');
    const btn = document.getElementById('volc-search-btn');
    const query = input.value.trim().toLowerCase();
    if (!query) return;

    let found = rawVolcanoData.find(v => v.name.toLowerCase() === query);
    if (!found) found = rawVolcanoData.find(v => v.name.toLowerCase().includes(query));

    if (found) {
        cameraGoTo(found.lat, found.lon, currentEyeDist());
        input.value = "";
        btn.disabled = true;
    }
}

function searchZone() {
    document.getElementById('quake-info').style.display = 'none';

    const input = document.getElementById('zone-input');
    const btn = document.getElementById('zone-btn');
    const query = input.value.trim();
    if (!query) return;

    let matchedKey = Object.keys(seismicBookmarks).find(k => k.toLowerCase() === query.toLowerCase());
    if (!matchedKey) matchedKey = Object.keys(seismicBookmarks).find(k => k.toLowerCase().includes(query.toLowerCase()));

    if (matchedKey) {
        const zone = seismicBookmarks[matchedKey];
        cameraGoTo(zone.lat, zone.lon, zone.zoom);
        input.value = "";
        btn.disabled = true;
        updatePlot();
    }
}

function searchNotable() {
    document.getElementById('quake-info').style.display = 'none';

    const input = document.getElementById('notable-input');
    const btn = document.getElementById('notable-btn');
    const query = input.value.trim().toLowerCase();
    if (!query) return;

    let found = rawNotableData.find(e => e.title.toLowerCase() === query);
    if (!found) found = rawNotableData.find(e => e.title.toLowerCase().includes(query));
    if (!found) return;

    // Set date range to ±30 days around the event
    const eventDate = new Date(found.time);
    const pad = (n) => String(n).padStart(2, '0');
    const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
    const before = new Date(eventDate.getTime() - 30 * 86400000);
    const after  = new Date(eventDate.getTime() + 30 * 86400000);
    document.getElementById('start-date').value = fmt(before);
    document.getElementById('end-date').value   = fmt(after);

    // Lower the magnitude filter so the event itself is visible
    document.getElementById('min-mag-slider').value = '4.0';
    updateLabels();

    cameraGoTo(found.lat, found.lon, 1.2);
    fetchDataAndPlot(false);

    input.value = '';
    btn.disabled = true;
}

function calculateResponsiveCamera() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspectRatio = width / height;
    const baseDistance = 0.9;
    const finalDistance = (aspectRatio >= 1) ? baseDistance : Math.max(1.5, baseDistance / aspectRatio);

    return {
        eye: { x: finalDistance, y: finalDistance, z: finalDistance * 0.5 },
        center: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 0, z: 1 }
    };
}

