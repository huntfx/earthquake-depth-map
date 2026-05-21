// --- Search Logic ---
function searchLocation() {
    // Close info popup if open
    document.getElementById('quake-info').style.display = 'none';

    const input = document.getElementById('search-input');
    const btn = document.getElementById('search-btn');
    const query = input.value.trim().toLowerCase();

    if (!query) return;

    // Find best match in labels
    const labels = staticLabelArrays.text;
    // First try exact match
    let index = labels.findIndex(name => name.toLowerCase() === query);

    if (index === -1) {
        // Try partial match
        index = labels.findIndex(name => name.toLowerCase().includes(query));
    }

    if (index !== -1) {
        const tx = staticLabelArrays.x[index];
        const ty = staticLabelArrays.y[index];
        const tz = staticLabelArrays.z[index];

        // Calculate normalized vector for Eye Direction (Look from this direction)
        const len = Math.sqrt(tx*tx + ty*ty + tz*tz);
        const nx = tx / len;
        const ny = ty / len;
        const nz = tz / len;

        // Calculate Center Point (The surface point to rotate around)
        const PLOT_SCALE = 3000 / EARTH_RADIUS;
        const cx = (tx / EARTH_RADIUS) * PLOT_SCALE;
        const cy = (ty / EARTH_RADIUS) * PLOT_SCALE;
        const cz = (tz / EARTH_RADIUS) * PLOT_SCALE;

        // Maintain current zoom distance relative to the new center
        const currentDist = Math.sqrt(currentCamera.eye.x**2 + currentCamera.eye.y**2 + currentCamera.eye.z**2);

        // Position eye along the normal vector relative to the surface point
        const newEye = {
            x: nx * currentDist,
            y: ny * currentDist,
            z: nz * currentDist
        };

        const newCenter = { x: cx, y: cy, z: cz };

        // Update camera
        const newCameraSettings = {
            eye: newEye,
            center: newCenter,
            up: { x: 0, y: 0, z: 1 }
        };

        currentCamera = newCameraSettings;
        Plotly.relayout('chart-container', { 'scene.camera': newCameraSettings });

        // Stop rotation so user stays on target
        autoRotate = false;
        document.getElementById('rotate-btn').innerHTML = '▶';

        // Clear input and disable button (No visual text feedback)
        input.value = "";
        btn.disabled = true;

        // Update plot to clear any old markers
        updatePlot();
    }
}

function searchVolcano() {
    // Close info popup if open
    document.getElementById('quake-info').style.display = 'none';

    const input = document.getElementById('volc-search-input');
    const btn = document.getElementById('volc-search-btn');
    const query = input.value.trim().toLowerCase();

    if (!query) return;

    // Find best match in rawVolcanoData
    // First try exact match
    let found = rawVolcanoData.find(v => v.name.toLowerCase() === query);

    if (!found) {
        // Try partial match
        found = rawVolcanoData.find(v => v.name.toLowerCase().includes(query));
    }

    if (found) {

        // Center camera on volcano
        const lat = found.lat;
        const lon = found.lon;

        // Calculate normalized vector
        const latRad = lat * Math.PI / 180;
        const lonRad = lon * Math.PI / 180;

        const nx = Math.cos(latRad) * Math.cos(lonRad);
        const ny = Math.cos(latRad) * Math.sin(lonRad);
        const nz = Math.sin(latRad);

        const PLOT_SCALE = 3000 / EARTH_RADIUS;
        const [tx, ty, tz] = latLonToXYZ(lat, lon, EARTH_RADIUS);
        const scx = (tx / EARTH_RADIUS) * PLOT_SCALE;
        const scy = (ty / EARTH_RADIUS) * PLOT_SCALE;
        const scz = (tz / EARTH_RADIUS) * PLOT_SCALE;

        const newCenter = { x: scx, y: scy, z: scz };

        const currentDist = Math.sqrt(currentCamera.eye.x**2 + currentCamera.eye.y**2 + currentCamera.eye.z**2);

        const newEye = {
            x: nx * currentDist,
            y: ny * currentDist,
            z: nz * currentDist
        };

        const newCameraSettings = {
            eye: newEye,
            center: newCenter,
            up: { x: 0, y: 0, z: 1 }
        };

        currentCamera = newCameraSettings;
        Plotly.relayout('chart-container', { 'scene.camera': newCameraSettings });

        autoRotate = false;
        document.getElementById('rotate-btn').innerHTML = '▶';

        // Provide visual feedback
        input.value = "";
        btn.disabled = true;
    }
}

function searchZone() {
    const input = document.getElementById('zone-input');
    const btn = document.getElementById('zone-btn');
    const query = input.value.trim();

    // Close info popup if open
    document.getElementById('quake-info').style.display = 'none';

    if (!query) return;

    // Case-insensitive lookup for keys
    let matchedKey = Object.keys(seismicBookmarks).find(k => k.toLowerCase() === query.toLowerCase());

    // Try partial match if exact fails
    if (!matchedKey) {
        matchedKey = Object.keys(seismicBookmarks).find(k => k.toLowerCase().includes(query.toLowerCase()));
    }

    if (matchedKey) {
        const zone = seismicBookmarks[matchedKey];
        // Calculate normalized vector from Lat/Lon
        const latRad = zone.lat * Math.PI / 180;
        const lonRad = zone.lon * Math.PI / 180;

        // Vector for eye direction
        const nx = Math.cos(latRad) * Math.cos(lonRad);
        const ny = Math.cos(latRad) * Math.sin(lonRad);
        const nz = Math.sin(latRad);

        // New Center (Surface point)
        const PLOT_SCALE = 3000 / EARTH_RADIUS;
        const [tx, ty, tz] = latLonToXYZ(zone.lat, zone.lon, EARTH_RADIUS);
        const scx = (tx / EARTH_RADIUS) * PLOT_SCALE;
        const scy = (ty / EARTH_RADIUS) * PLOT_SCALE;
        const scz = (tz / EARTH_RADIUS) * PLOT_SCALE;

        const newCenter = { x: scx, y: scy, z: scz };

        // New Eye (Zoom distance back from center)
        const zoomDist = zone.zoom;
        const newEye = {
            x: nx * zoomDist,
            y: ny * zoomDist,
            z: nz * zoomDist
        };

        const newCam = {
            eye: newEye,
            center: newCenter,
            up: { x: 0, y: 0, z: 1 }
        };

        currentCamera = newCam;
        Plotly.relayout('chart-container', { 'scene.camera': newCam });

        // Stop rotation
        autoRotate = false;
        document.getElementById('rotate-btn').innerHTML = '▶';

        // Clear input and disable button (No visual text feedback)
        input.value = "";
        btn.disabled = true;

        updatePlot();
    }
}

function calculateResponsiveCamera() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const aspectRatio = width / height;
    const baseDistance = 0.9;
    let finalDistance = (aspectRatio >= 1) ? baseDistance : Math.max(1.5, baseDistance / aspectRatio);

    return {
        eye: { x: finalDistance, y: finalDistance, z: finalDistance * 0.5 },
        center: { x: 0, y: 0, z: 0 },
        up: { x: 0, y: 0, z: 1 }
    };
}

function saveRenderCamera() {
    // Save the current camera state to LocalStorage
    const camState = {
        eye: currentCamera.eye,
        center: currentCamera.center,
        up: currentCamera.up
    };
    localStorage.setItem('earthquake_render_cam', JSON.stringify(camState));
    console.log("Camera state saved:", camState);
}

function restoreRenderCamera() {
    const saved = localStorage.getItem('earthquake_render_cam');
    if (!saved) {
        alert("No saved camera position found.");
        return;
    }
    try {
        const camState = JSON.parse(saved);
        currentCamera = camState;
        Plotly.relayout('chart-container', { 'scene.camera': camState });
        // Disable rotation so user doesn't accidentally move it again
        autoRotate = false;
        document.getElementById('rotate-btn').innerHTML = '▶';
    } catch (e) {
        console.error("Failed to restore camera", e);
    }
}
