async function fetchDataAndPlot(isInitial = false) {
    const loading = document.getElementById('loading');
    loading.style.display = 'block';
    loading.innerText = "Querying USGS...";

    try {
        const start = document.getElementById('start-date').value;
        const end = document.getElementById('end-date').value;
        const minMag = document.getElementById('min-mag-slider').value;
        const maxMag = document.getElementById('max-mag-slider').value;
        const minDepth = document.getElementById('min-depth-filter').value;
        const maxDepth = document.getElementById('max-depth-filter').value;
        const limit = document.getElementById('limit-select').value;

        let url = `${USGS_BASE_URL}&starttime=${start}`;
        if (end) url += `&endtime=${end}`;

        if(parseFloat(minMag) > 0) url += `&minmagnitude=${minMag}`;
        if(parseFloat(maxMag) < 10) url += `&maxmagnitude=${maxMag}`;
        url += `&mindepth=${minDepth}&maxdepth=${maxDepth}`;
        url += `&limit=${limit}`;

        console.log("Fetching: " + url);

        const res = await fetch(url);
        if (!res.ok) throw new Error("API Limit or Network Error");
        const quakeJson = await res.json();

        stats = { maxMag: 0, maxDepth: 0, minTime: Infinity, maxTime: -Infinity, avgMag: 0, minMag: Infinity, minDepth: Infinity };
        let totalMag = 0, count = 0, totalRealMag = 0, totalDepth = 0;

        // Counters for log report
        let magCounts = { "0-3": 0, "3-5": 0, "5-7": 0, "7+": 0 };
        let depthCounts = { "Shallow (<70km)": 0, "Intermediate (70-300km)": 0, "Deep (>300km)": 0 };

        rawQuakeData = quakeJson.features.map(f => {
            const realMag = f.properties.mag || 0;
            const visualMag = Math.max(realMag, 0.1);
            const depth = f.geometry.coordinates[2];
            const time = f.properties.time;

            if (realMag < stats.minMag) stats.minMag = realMag;
            if (realMag > stats.maxMag) stats.maxMag = realMag;
            if (depth < stats.minDepth) stats.minDepth = depth;
            if (depth > stats.maxDepth) stats.maxDepth = depth;
            if (time < stats.minTime) stats.minTime = time;
            if (time > stats.maxTime) stats.maxTime = time;

            totalMag += visualMag;
            totalRealMag += realMag;
            totalDepth += depth;
            count++;

            // Stats logic
            if (realMag < 3) magCounts["0-3"]++;
            else if (realMag < 5) magCounts["3-5"]++;
            else if (realMag < 7) magCounts["5-7"]++;
            else magCounts["7+"]++;

            if (depth < 70) depthCounts["Shallow (<70km)"]++;
            else if (depth < 300) depthCounts["Intermediate (70-300km)"]++;
            else depthCounts["Deep (>300km)"]++;

            return {
                lat: f.geometry.coordinates[1],
                lon: f.geometry.coordinates[0],
                depth: depth,
                mag: visualMag,
                realMag: realMag,
                time: time,
                place: f.properties.place || "Unknown",
                url: f.properties.url,
                type: 'quake'
            };
        });

        if (count === 0) {
            stats.minMag = 0; stats.maxMag = 0; stats.minDepth = 0; stats.maxDepth = 0;
            stats.minTime = Date.now(); stats.maxTime = Date.now();
        }

        stats.avgMag = count > 0 ? (totalMag / count) : 0;
        const realAvgMag = count > 0 ? (totalRealMag / count) : 0;
        const avgDepth = count > 0 ? (totalDepth / count) : 0;

        console.log("================ DATA REPORT ================");
        console.log(`Total Events: ${count}`);
        console.log(`Date Range: ${new Date(stats.minTime).toLocaleDateString()} to ${new Date(stats.maxTime).toLocaleDateString()}`);
        console.log(`Magnitude: Min ${stats.minMag.toFixed(2)} | Max ${stats.maxMag.toFixed(2)} | Avg ${realAvgMag.toFixed(2)}`);
        console.log(`Depth: Min ${stats.minDepth.toFixed(1)}km | Max ${stats.maxDepth.toFixed(1)}km`);
        console.log("---------------------------------------------");
        console.table(magCounts);
        console.table(depthCounts);
        console.log("=============================================");

        document.getElementById('info-overlay').innerText = `Data: ${count} earthquakes. Source: USGS.`;

        loading.style.display = 'none';

        // Show all immediately
        updatePlot(isInitial);

    } catch (err) {
        console.error(err);
        loading.innerText = "Error: " + err.message;
    }
}

async function updatePlot(isInitial = false) {

    const depthScale = parseFloat(document.getElementById('depth-slider').value);
    const baseSize = parseFloat(document.getElementById('size-slider').value);

    // Checkbox logic replacing slider logic
    const bordersEnabled = document.getElementById('borders-checkbox').checked;
    const platesEnabled = document.getElementById('plates-checkbox').checked;
    const volcanoesEnabled = document.getElementById('volcanoes-checkbox').checked;
    const showLabels = document.getElementById('labels-checkbox').checked;
    const showSurfaceLines = document.getElementById('surface-lines-checkbox').checked;
    const labelSize = showLabels ? 12 : 0;

    // Light Mode check
    // Use dark grey for borders in light mode for better contrast
    const bgColor = isLightMode ? '#f0f0f0' : 'black';
    const gridColor = isLightMode ? '#ccc' : '#333';

    // Modified: Darker Teal for Dark Mode borders, Grey for Light Mode
    const borderColor = isLightMode ? '#666' : '#008888';

    // Lighter blue for plates in light mode to distinguish from grey borders
    const plateColor = isLightMode ? '#2288cc' : '#1565C0';

    const labelColor = isLightMode ? 'rgba(0, 0, 0, 0.7)' : 'rgba(180, 180, 180, 0.9)';

    // Volcano styling based on Light Mode
    const volcColor = isLightMode ? 'white' : 'black';
    const volcLine = isLightMode ? 'black' : 'white';

    // Modified: Constant thick widths for both modes (2px borders, 3px plates)
    // UPDATED: Now using global constants
    const borderWidth = bordersEnabled ? BASE_BORDER_WIDTH : 0;
    const plateWidth = platesEnabled ? BASE_PLATE_WIDTH : 0;

    const selectedPalette = document.getElementById('color-select').value;
    const colorMode = document.getElementById('color-mode').value;

    const qx = [], qy = [], qz = [], ghostSizes = [], colors = [], texts = [];
    const customData = []; // To store full object references for click events
    // Arrays for surface lines
    const slx = [], sly = [], slz = [];
    const lineColors = []; // Array for line colors

    // Volcano lines
    const vlx = [], vly = [], vlz = [];

    // Use shared helper for consistency, multiplier 1 for standard view
    const sizes = calculateScaledSizes(1.0);

    rawQuakeData.forEach((q, i) => {
        const r_quake = EARTH_RADIUS - (q.depth * depthScale);
        const [x, y, z] = latLonToXYZ(q.lat, q.lon, r_quake);
        qx.push(x); qy.push(y); qz.push(z);

        const s = sizes[i]; // Use pre-calculated size
        ghostSizes.push(Math.max(s * 2, 10));

        // Add full object to custom data
        customData.push(q);

        let val;
        if (colorMode === 'depth') val = q.depth;
        else if (colorMode === 'mag') val = q.mag;
        else val = q.time;

        colors.push(val);

        const d = new Date(q.time);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        texts.push(
            `<b>${q.place}</b><br>` +
            `Date: ${dateStr}<br>` +
            `Magnitude: ${q.realMag.toFixed(2)}<br>` +
            `Depth: ${q.depth.toFixed(2)}km`
        );

        // Build Surface Lines (Earthquakes)
        if (showSurfaceLines) {
              const [sx, sy, sz] = latLonToXYZ(q.lat, q.lon, EARTH_RADIUS);
              // Line from Surface (sx, sy, sz) to Quake (x, y, z)
              slx.push(sx); sly.push(sy); slz.push(sz);
              slx.push(x);  sly.push(y);  slz.push(z);
              // Add breaks to disconnect lines
              slx.push(null); sly.push(null); slz.push(null);

              // Push color values for both vertices and the break
              lineColors.push(val);
              lineColors.push(val);
              lineColors.push(val);
        }
    });

    const { cmin, cmax } = getColorRange(colorMode);
    const colorSettings = {
        colorscale: selectedPalette,
        cmin, cmax,
        colorbar: {
            x: 0, len: 0.5, thickness: 15,
            titlefont: { color: isLightMode ? '#333' : 'white' },
            tickfont:  { color: isLightMode ? '#333' : 'white' }
        }
    };

    const gridTrace = {
        type: 'scatter3d', mode: 'lines',
        x: staticGridArrays.x, y: staticGridArrays.y, z: staticGridArrays.z,
        line: { color: gridColor, width: 1 }, opacity: 0.5, hoverinfo: 'skip'
    };

    const borderTrace = {
        type: 'scatter3d', mode: 'lines',
        x: staticBorderArrays.x, y: staticBorderArrays.y, z: staticBorderArrays.z,
        line: { color: borderColor, width: borderWidth }, opacity: 0.4, hoverinfo: 'skip',
        visible: borderWidth > 0
    };

    const plateTrace = {
        type: 'scatter3d', mode: 'lines',
        x: staticPlateArrays.x, y: staticPlateArrays.y, z: staticPlateArrays.z,
        line: { color: plateColor, width: plateWidth }, opacity: 0.8, hoverinfo: 'skip',
        visible: plateWidth > 0
    };

    // Prepare Volcano Trace
    const vx = [], vy = [], vz = [], vtext = [], vCustom = [];

    // Loop data if enabled OR if lines are needed
    if (volcanoesEnabled || (showSurfaceLines && volcanoesEnabled)) {
        rawVolcanoData.forEach(v => {
            // Position Logic: Earth Radius + (Elev_km * depthScale)
            // Convert meters to km first
            const r_volc = EARTH_RADIUS + ((v.elev / 1000) * depthScale);
            const [x, y, z] = latLonToXYZ(v.lat, v.lon, r_volc);

            if (volcanoesEnabled) {
                vx.push(x); vy.push(y); vz.push(z);
                vtext.push(
                    `<b>${v.name}</b><br>` +
                    `Type: ${v.type}<br>` +
                    `Elevation: ${v.elev}m`
                );
                vCustom.push({
                    type: 'volcano',
                    name: v.name,
                    lat: v.lat,
                    lon: v.lon,
                    elev: v.elev,
                    volcType: v.type,
                    status: v.status
                });
            }

            // Volcano Surface Lines Logic
            if (showSurfaceLines && volcanoesEnabled) {
                // Surface point
                const [sx, sy, sz] = latLonToXYZ(v.lat, v.lon, EARTH_RADIUS);

                vlx.push(sx); vly.push(sy); vlz.push(sz);
                vlx.push(x);  vly.push(y);  vlz.push(z);
                vlx.push(null); vly.push(null); vlz.push(null);
            }
        });
    }

    const volcanoTrace = {
        type: 'scatter3d',
        mode: 'markers',
        x: vx, y: vy, z: vz,
        text: vtext,
        hoverinfo: 'text',
        customdata: vCustom,
        marker: {
            symbol: 'x',
            size: baseSize,
            color: volcColor,
            line: { color: volcLine, width: 1.5 },
            opacity: 1.0
        },
        visible: volcanoesEnabled
    };

    // Distinct Trace for Volcano Surface Lines (Fixed Color)
    const volcanoLineTrace = {
        type: 'scatter3d',
        mode: 'lines',
        x: vlx, y: vly, z: vlz,
        line: {
            color: isLightMode ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)',
            width: 2
        },
        opacity: 0.5,
        hoverinfo: 'skip',
        visible: showSurfaceLines && volcanoesEnabled
    };

    const surfaceLineTrace = {
        type: 'scatter3d',
        mode: 'lines',
        x: slx, y: sly, z: slz,
        line: {
            color: lineColors,
            colorscale: selectedPalette,
            cmin: colorSettings.cmin,
            cmax: colorSettings.cmax,
            width: 2,
            showscale: false
        },
        opacity: 0.3,
        hoverinfo: 'skip',
        visible: showSurfaceLines
    };

    // New Country Labels Trace
    const labelTrace = {
        type: 'scatter3d',
        mode: 'text',
        x: staticLabelArrays.x,
        y: staticLabelArrays.y,
        z: staticLabelArrays.z,
        text: staticLabelArrays.text,
        textfont: {
            color: labelColor,
            size: labelSize,
            family: 'sans-serif'
        },
        hoverinfo: 'none',
        visible: labelSize > 0 // Hide if size is 0
    };

    const quakeTrace = {
        type: 'scatter3d', mode: 'markers',
        x: qx, y: qy, z: qz,
        hoverinfo: 'skip',
        customdata: customData, // Pass full object to click event
        marker: {
            size: sizes, color: colors,
            colorscale: colorSettings.colorscale, cmin: colorSettings.cmin, cmax: colorSettings.cmax,
            colorbar: colorSettings.colorbar, opacity: 1.0, line: { width: 0 }
        }
    };

    const ghostTrace = {
        type: 'scatter3d', mode: 'markers',
        x: qx, y: qy, z: qz,
        text: texts, hoverinfo: 'text',
        customdata: customData,
        marker: { size: ghostSizes, color: 'rgba(0,0,0,0)', opacity: 0.0 },
        visible: !tlState.active  // hidden during timelapse (hover not meaningful on filtered data)
    };

    const layout = {
        paper_bgcolor: bgColor,
        plot_bgcolor: bgColor,
        margin: { l: 0, r: 0, t: 0, b: 0 },
        hovermode: 'closest',
        scene: {
            xaxis: { visible: false, showbackground: false },
            yaxis: { visible: false, showbackground: false },
            zaxis: { visible: false, showbackground: false },
            aspectmode: 'data',
            dragmode: 'orbit'
        },
        showlegend: false,
        uirevision: 'true' // Add uirevision to allow user interaction to persist across updates
    };

    if (isInitial) {
        currentCamera = calculateResponsiveCamera();
        layout.scene.camera = currentCamera;
    } else if (!tlState.active) {
        layout.scene.camera = getLiveCamera();
    } else {
        // During timelapse: omit the camera from the layout entirely and preserve
        // the existing uirevision so Plotly doesn't reset interaction state.
        // syncSceneCamera() (called below) has already written the live camera to
        // _fullLayout.scene.camera, which Plotly.react will use when uirevision is unchanged.
        const gd = getChartDiv();
        if (gd._fullLayout) layout.uirevision = gd._fullLayout.uirevision;
    }

    // --- OCCLUSION CORE (Trace 1) ---
    // A single giant point at the center of the earth.
    // Markers are 2D billboards, so it always faces the camera.
    // We size it to cover the full earth diameter (roughly).
    const coreColor = isLightMode ? '#f0f0f0' : 'black';
    const coreOpacity = isLightMode ? 0.4 : 0.2;
    const coreTrace = {
        type: 'scatter3d',
        mode: 'markers',
        x: [0], y: [0], z: [0],
        marker: {
            color: coreColor,
            size: 10000, // Arbitrary large number
            sizemode: 'diameter',
            opacity: coreOpacity
        },
        hoverinfo: 'none'
    };

    if (!isInitial) syncSceneCamera();
    await Plotly.react('chart-container', [
        gridTrace, coreTrace, borderTrace, plateTrace, labelTrace,
        volcanoTrace, surfaceLineTrace, volcanoLineTrace,
        quakeTrace, ghostTrace
    ], layout, {responsive: true});

    invalidateMagChart();
    drawMagChart();

    // After rebuilding static traces, restore timelapse quake window if active.
    if (tlState.active && !isInitial) {
        await updateTimeLapseFrame();
    }
}

// During timelapse, update only the static/visual traces via Plotly.restyle so the
// layout (and therefore the camera) is never touched.
function updateStaticTracesForTimelapse() {
    const depthScale       = parseFloat(document.getElementById('depth-slider').value);
    const bordersEnabled   = document.getElementById('borders-checkbox').checked;
    const platesEnabled    = document.getElementById('plates-checkbox').checked;
    const volcanoesEnabled = document.getElementById('volcanoes-checkbox').checked;
    const showLabels       = document.getElementById('labels-checkbox').checked;
    const showSurfaceLines = document.getElementById('surface-lines-checkbox').checked;
    const selectedPalette  = document.getElementById('color-select').value;
    const colorMode        = document.getElementById('color-mode').value;

    const borderColor = isLightMode ? '#666'    : '#008888';
    const plateColor  = isLightMode ? '#2288cc' : '#1565C0';
    const volcColor   = isLightMode ? 'white'   : 'black';
    const volcLine    = isLightMode ? 'black'   : 'white';
    const borderWidth = bordersEnabled ? BASE_BORDER_WIDTH : 0;
    const plateWidth  = platesEnabled  ? BASE_PLATE_WIDTH  : 0;
    const labelSize   = showLabels     ? 12                : 0;

    syncSceneCamera();

    Plotly.restyle('chart-container', { visible: bordersEnabled, 'line.color': borderColor, 'line.width': borderWidth }, [TRACE.BORDER]);
    Plotly.restyle('chart-container', { visible: platesEnabled,  'line.color': plateColor,  'line.width': plateWidth  }, [TRACE.PLATE]);
    Plotly.restyle('chart-container', { visible: labelSize > 0,  'textfont.size': labelSize                           }, [TRACE.LABEL]);

    if (volcanoesEnabled) {
        const vx = [], vy = [], vz = [], vtext = [], vCustom = [];
        const vlx = [], vly = [], vlz = [];
        rawVolcanoData.forEach(v => {
            const r = EARTH_RADIUS + ((v.elev / 1000) * depthScale);
            const [x, y, z] = latLonToXYZ(v.lat, v.lon, r);
            vx.push(x); vy.push(y); vz.push(z);
            vtext.push(`<b>${v.name}</b><br>Type: ${v.type}<br>Elevation: ${v.elev}m`);
            vCustom.push({ type: 'volcano', name: v.name, lat: v.lat, lon: v.lon, elev: v.elev, volcType: v.type, status: v.status });
            if (showSurfaceLines) {
                const [sx, sy, sz] = latLonToXYZ(v.lat, v.lon, EARTH_RADIUS);
                vlx.push(sx, x, null); vly.push(sy, y, null); vlz.push(sz, z, null);
            }
        });
        Plotly.restyle('chart-container', { x: [vx], y: [vy], z: [vz], text: [vtext], customdata: [vCustom], 'marker.color': volcColor, 'marker.line.color': volcLine, visible: true }, [TRACE.VOLCANO]);
        Plotly.restyle('chart-container', { x: [vlx], y: [vly], z: [vlz], visible: showSurfaceLines }, [TRACE.VOLCANO_LINE]);
    } else {
        Plotly.restyle('chart-container', { visible: false }, [TRACE.VOLCANO]);
        Plotly.restyle('chart-container', { visible: false }, [TRACE.VOLCANO_LINE]);
    }

    if (showSurfaceLines) {
        const slx = [], sly = [], slz = [], lineColors = [];
        const { cmin, cmax } = getColorRange(colorMode);
        const windowEnd = tlState.currentTime;
        const windowStart = windowEnd - tlState.windowSize;
        let windowQuakes = tlState.sortedData.filter(q => q.time >= windowStart && q.time <= windowEnd);
        if (windowStart < tlState.startTime) {
            const wrapCutoff = tlState.endTime - (tlState.startTime - windowStart);
            windowQuakes = windowQuakes.concat(tlState.sortedData.filter(q => q.time >= wrapCutoff));
        }
        windowQuakes.forEach(q => {
            const r = EARTH_RADIUS - (q.depth * depthScale);
            const [x, y, z] = latLonToXYZ(q.lat, q.lon, r);
            const [sx, sy, sz] = latLonToXYZ(q.lat, q.lon, EARTH_RADIUS);
            const val = colorMode === 'depth' ? q.depth : colorMode === 'mag' ? q.mag : q.time;
            slx.push(sx, x, null); sly.push(sy, y, null); slz.push(sz, z, null);
            lineColors.push(val, val, val);
        });
        Plotly.restyle('chart-container', { x: [slx], y: [sly], z: [slz], 'line.color': [lineColors], 'line.colorscale': selectedPalette, 'line.cmin': cmin, 'line.cmax': cmax, visible: true }, [TRACE.SURFACE_LINE]);
    } else {
        Plotly.restyle('chart-container', { visible: false }, [TRACE.SURFACE_LINE]);
    }
}
