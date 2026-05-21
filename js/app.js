// --- UI Logic ---
function toggleMenu() {
    document.getElementById('side-panel').classList.toggle('open');
}
document.getElementById('menu-btn').addEventListener('click', toggleMenu);
document.getElementById('close-btn').addEventListener('click', toggleMenu);

// --- Main App Logic ---
async function initApp() {
    try {
        console.log("Starting application...");
        setDefaultDates();

        // Defaults
        document.getElementById('size-slider').value = "2.5";
        document.getElementById('mag-slider').value = "0.1";
        document.getElementById('depth-slider').value = "2.5";
        document.getElementById('color-select').value = "Hot";
        document.getElementById('color-mode').value = "mag";

        document.getElementById('min-mag-slider').value = "0";
        document.getElementById('max-mag-slider').value = "10";
        document.getElementById('min-depth-filter').value = "0";
        document.getElementById('max-depth-filter').value = "800";

        // Initialize checkboxes
        document.getElementById('borders-checkbox').checked = true;
        document.getElementById('plates-checkbox').checked = true;
        document.getElementById('labels-checkbox').checked = false;
        document.getElementById('volcanoes-checkbox').checked = false;
        document.getElementById('surface-lines-checkbox').checked = false;

        updateLabels();

        console.log("Downloading static map data...");
        document.getElementById('loading').innerText = "Loading Map Data...";

        // Fetch Borders, Plates, AND Volcanoes
        const [borderRes, platesRes, volcanoRes] = await Promise.all([
            fetch(BORDERS_URL),
            fetch(PLATES_URL),
            fetch(VOLCANOES_URL)
        ]);

        const borderJson = await borderRes.json();
        const platesJson = await platesRes.json();
        const volcanoCsv = await volcanoRes.text();

        const processedBorders = processBorders(borderJson);
        staticBorderArrays = processedBorders.borders;
        staticLabelArrays = processedBorders.labels;

        // --- Frame Control Sync ---
        const frameSlider = document.getElementById('frame-slider');
        const frameInput = document.getElementById('frame-number');

        // 1. Slider moves -> Update Input
        frameSlider.addEventListener('input', (e) => {
            frameInput.value = e.target.value;
            updateLabels(); // Updates the "Total Frames" text if you have it elsewhere
        });

        // 2. Input types -> Update Slider (visually) but keep exact value
        frameInput.addEventListener('input', (e) => {
            let val = parseInt(e.target.value);
            if (!val || val < 1) val = 1;

            // Update slider visual (it will just max out if value > max)
            frameSlider.value = val;
            updateLabels();
        });

        // Process Volcanoes
        rawVolcanoData = processVolcanoes(volcanoCsv);
        console.log(`Loaded ${rawVolcanoData.length} volcanoes.`);

        // Populate Autocomplete (Countries)
        const dataList = document.getElementById('locations-list');
        const uniqueNames = [...new Set(staticLabelArrays.text)].sort();
        uniqueNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            dataList.appendChild(option);
        });

        // Populate Autocomplete (Volcanoes)
        const volcList = document.getElementById('volcanoes-list');
        // Use a Set to avoid duplicates if any
        const uniqueVolcNames = [...new Set(rawVolcanoData.map(v => v.name))].sort();
        uniqueVolcNames.forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            volcList.appendChild(option);
        });

        // Populate Autocomplete (Zones)
        const zonesList = document.getElementById('zones-list');
        Object.keys(seismicBookmarks).forEach(name => {
            const option = document.createElement('option');
            option.value = name;
            zonesList.appendChild(option);
        });

        staticPlateArrays = processPlates(platesJson);
        staticGridArrays = generateWireframeGrid();

        const visualInputs = ['size-slider', 'mag-slider', 'depth-slider'];
        visualInputs.forEach(id => {
            document.getElementById(id).addEventListener('input', () => {
                updateLabels();
                if (tlState.active) {
                     updateTimeLapseFrame();
                } else {
                     updatePlot();
                }
            });
        });

        const filterInputs = ['min-mag-slider', 'max-mag-slider', 'min-depth-filter', 'max-depth-filter'];
        filterInputs.forEach(id => {
            document.getElementById(id).addEventListener('input', updateLabels);
        });

        // Handle frame slider separately (UI only)
        document.getElementById('render-scale').addEventListener('input', updateLabels);

        // Listen for checkbox change
        document.getElementById('labels-checkbox').addEventListener('change', () => updatePlot());
        document.getElementById('borders-checkbox').addEventListener('change', () => updatePlot());
        document.getElementById('plates-checkbox').addEventListener('change', () => updatePlot());
        document.getElementById('volcanoes-checkbox').addEventListener('change', () => updatePlot());
        document.getElementById('surface-lines-checkbox').addEventListener('change', () => updatePlot());

        // Toggle Logic
        document.getElementById('theme-btn').addEventListener('click', () => {
            isLightMode = !isLightMode;
            const btn = document.getElementById('theme-btn');
            if(isLightMode) {
                document.body.classList.add('light-mode');
                btn.innerHTML = '☾'; // Moon icon
            } else {
                document.body.classList.remove('light-mode');
                btn.innerHTML = '☀'; // Sun icon
            }
            updatePlot();
        });

        // Rotation Toggle
        document.getElementById('rotate-btn').addEventListener('click', () => {
            const btn = document.getElementById('rotate-btn');

            // Case A: User clicked during the 1-second Grace Period
            if (rotationTimeout) {
                stopRotation(); // Clears timeout, sets autoRotate=false, sets Icon to ▶
                return;
            }

            // Case B: Standard Toggle
            if (autoRotate) {
                stopRotation();
            } else {
                autoRotate = true;
                btn.innerHTML = '❚❚';
            }
        });

        // Reset View
        document.getElementById('reset-btn').addEventListener('click', () => {
            // 1. Clear any existing rotation/timers first
            stopRotation();

            // 2. Clear search & Reset Camera
            const defaultCam = calculateResponsiveCamera();
            currentCamera = defaultCam;
            Plotly.relayout('chart-container', { 'scene.camera': defaultCam });

            // 3. UI State: Show "Pause" icon immediately.
            // This tells the user: "I am active (or about to be). Click me to stop."
            document.getElementById('rotate-btn').innerHTML = '❚❚';

            // 4. Update plot (to clear markers etc)
            updatePlot();

            // 5. Start Grace Period (1 Second)
            rotationTimeout = setTimeout(() => {
                autoRotate = true;
                rotationTimeout = null; // Clear the reference
            }, 1000);
        });

        // Render frames
        document.getElementById('render-btn').addEventListener('click', renderFrames);

        // GPS Button
        document.getElementById('gps-btn').addEventListener('click', () => {
            if (!navigator.geolocation) {
                showError("Geolocation is not supported.");
                return;
            }

            navigator.geolocation.getCurrentPosition(
                (position) => {
                    const lat = position.coords.latitude;
                    const lon = position.coords.longitude;

                    // Move Camera logic (copied/adapted from search)
                    const [tx, ty, tz] = latLonToXYZ(lat, lon, EARTH_RADIUS);

                    // Calculate normalized vector
                    const len = Math.sqrt(tx*tx + ty*ty + tz*tz);
                    const nx = tx / len;
                    const ny = ty / len;
                    const nz = tz / len;

                    const PLOT_SCALE = 3000 / EARTH_RADIUS;
                    const cx = (tx / EARTH_RADIUS) * PLOT_SCALE;
                    const cy = (ty / EARTH_RADIUS) * PLOT_SCALE;
                    const cz = (tz / EARTH_RADIUS) * PLOT_SCALE;

                    const currentDist = Math.sqrt(currentCamera.eye.x**2 + currentCamera.eye.y**2 + currentCamera.eye.z**2);

                    const newEye = {
                        x: nx * currentDist,
                        y: ny * currentDist,
                        z: nz * currentDist
                    };

                    const newCenter = { x: cx, y: cy, z: cz };

                    const newCameraSettings = {
                        eye: newEye,
                        center: newCenter,
                        up: { x: 0, y: 0, z: 1 }
                    };

                    currentCamera = newCameraSettings;
                    Plotly.relayout('chart-container', { 'scene.camera': newCameraSettings });

                    // Stop rotation
                    autoRotate = false;
                    document.getElementById('rotate-btn').innerHTML = '▶';
                },
                (error) => {
                    console.warn("GPS Error:", error);
                    let msg = "Location access denied or unavailable.";
                    if (error.code === 1) msg = "Location permission denied.";
                    else if (error.code === 2) msg = "Location unavailable.";
                    else if (error.code === 3) msg = "Location request timed out.";
                    else if (error.message) msg = error.message;

                    showError(msg);
                },
                { timeout: 10000, maximumAge: 0, enableHighAccuracy: false }
            );
        });

        document.getElementById('color-select').addEventListener('change', () => {
            if (tlState.active) updateTimeLapseFrame();
            else updatePlot();
        });

        document.getElementById('color-mode').addEventListener('change', () => {
            if (tlState.active) updateTimeLapseFrame();
            else updatePlot();
        });

        document.getElementById('load-btn').addEventListener('click', () => fetchDataAndPlot(false));

        // Search Listeners (Countries)
        document.getElementById('search-btn').addEventListener('click', searchLocation);
        document.getElementById('search-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchLocation();
        });
        // Validation on Input (Case Insensitive Match)
        document.getElementById('search-input').addEventListener('input', (e) => {
            const val = e.target.value.trim().toLowerCase();
            const btn = document.getElementById('search-btn');
            // Check against country list (case insensitive)
            const isValid = staticLabelArrays.text.some(name => name.toLowerCase() === val);
            btn.disabled = !isValid;

            if (isValid && e.inputType === 'insertReplacementText') {
               // Direct click from datalist
               searchLocation();
               document.getElementById('search-input').blur();
            }
        });

        // Search Listeners (Volcanoes)
        document.getElementById('volc-search-btn').addEventListener('click', searchVolcano);
        document.getElementById('volc-search-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchVolcano();
        });
        // Validation on Input (Case Insensitive Match)
        document.getElementById('volc-search-input').addEventListener('input', (e) => {
            const val = e.target.value.trim().toLowerCase();
            const btn = document.getElementById('volc-search-btn');
            // Check against volcano list (case insensitive)
            const isValid = rawVolcanoData.some(v => v.name.toLowerCase() === val);
            // Partial match logic for button enable
            const isPartial = rawVolcanoData.some(v => v.name.toLowerCase().includes(val));
            btn.disabled = !(isValid || (val.length > 2 && isPartial));

            if (isValid && e.inputType === 'insertReplacementText') {
               // Direct click from datalist
               searchVolcano();
               document.getElementById('volc-search-input').blur();
            }
        });

        // Simulate Button
        document.getElementById('qi-sim-btn').addEventListener('click', () => {
            if (selectedQuake) {
                // SYNC CAMERA HERE
                const graphDiv = document.getElementById('chart-container');
                if (graphDiv._fullLayout && graphDiv._fullLayout.scene && graphDiv._fullLayout.scene.camera) {
                    currentCamera = JSON.parse(JSON.stringify(graphDiv._fullLayout.scene.camera));
                }

                // Trigger the wave
                triggerPulse(selectedQuake);

                // Center camera on it (fixed jump issue)
                executeFlyTo(selectedQuake);
            }
        });

        // Search Listeners (Zones)
        document.getElementById('zone-btn').addEventListener('click', searchZone);
        document.getElementById('zone-input').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') searchZone();
        });
        // Validation on Input (Case Insensitive Match)
        document.getElementById('zone-input').addEventListener('input', (e) => {
            const val = e.target.value.trim().toLowerCase();
            const btn = document.getElementById('zone-btn');
            // Check against zone keys (case insensitive)
            const isValid = Object.keys(seismicBookmarks).some(k => k.toLowerCase() === val);
            btn.disabled = !isValid;

            if (isValid && e.inputType === 'insertReplacementText') {
               // Direct click from datalist
               searchZone();
               document.getElementById('zone-input').blur();
            }
        });

        await fetchDataAndPlot(true);

        // --- INTERACTION LOGIC ---
        const graphDiv = document.getElementById('chart-container');
        const stopRotation = () => {
            // 1. Cancel the grace period timer if it's running
            if (rotationTimeout) {
                clearTimeout(rotationTimeout);
                rotationTimeout = null;
            }
            // 2. Stop actual rotation
            autoRotate = false;
            // 3. Update UI to "Play" icon (meaning we are currently paused)
            document.getElementById('rotate-btn').innerHTML = '▶';
        };

        // HANDSHAKE STATE
        // We separate the "Data Availability" (from Plotly) and the "Interaction Complete" (from DOM)
        let interactionState = {
            isDragging: false,
            startX: 0,
            startY: 0,
            pointData: null,       // Stores data from plotly_click
            awaitingData: false    // True if mouseup happened but plotly_click hasn't fired yet
        };

        // 1. Pointer Down: Reset everything
        graphDiv.addEventListener('pointerdown', (e) => {
            stopRotation();

            // Close Side Panel if open
            const panel = document.getElementById('side-panel');
            if (panel.classList.contains('open')) {
                panel.classList.remove('open');
            }

            interactionState.isDragging = false;
            interactionState.startX = e.clientX;
            interactionState.startY = e.clientY;
            interactionState.pointData = null;
            interactionState.awaitingData = false;
        }, {capture: true});

        // 2. Pointer Move: Detect Drag
        graphDiv.addEventListener('pointermove', (e) => {
            const dx = Math.abs(e.clientX - interactionState.startX);
            const dy = Math.abs(e.clientY - interactionState.startY);

            if (dx > 3 || dy > 3) {
                interactionState.isDragging = true;
            }
        }, {capture: true});

        // 3. Plotly Click: Capture Data (Don't move yet unless waiting)
        graphDiv.on('plotly_click', function(data){
            if(!data || !data.points || data.points.length === 0) return;

            // Store the data
            interactionState.pointData = data.points[0].customdata;

            // If mouseup already happened (race condition), execute immediately
            if (interactionState.awaitingData && !interactionState.isDragging) {
                executeFlyTo(interactionState.pointData);
                interactionState.awaitingData = false;
            }
        });

        // 4. Pointer Up: The Trigger
        graphDiv.addEventListener('pointerup', (e) => {
            if (interactionState.isDragging) return; // It was a drag, ignore

            if (interactionState.pointData) {
                // We already have data (plotly_click fired on down or during press)
                executeFlyTo(interactionState.pointData);
                interactionState.pointData = null; // Clear to prevent double fire
            } else {
                // We clicked, but Plotly hasn't sent data yet. Wait for it.
                interactionState.awaitingData = true;
                // Timeout to reset if we clicked empty space
                setTimeout(() => { interactionState.awaitingData = false; }, 200);
            }
        }, {capture: true});

        // Helper to perform the action
        function executeFlyTo(q) {
            if (!q) return;

            // Store global selection
            selectedQuake = q;

            // Update Popup Content
            document.getElementById('qi-place').innerText = q.name || q.place;

            const label1 = document.getElementById('qi-label-1');
            const val1 = document.getElementById('qi-val-1');
            const label2 = document.getElementById('qi-label-2');
            const val2 = document.getElementById('qi-val-2');
            const label3 = document.getElementById('qi-label-3');
            const val3 = document.getElementById('qi-val-3');
            const link = document.getElementById('qi-link');
            const simBtn = document.getElementById('qi-sim-btn');

            if (q.type === 'volcano') {
                label1.innerText = "Type:";
                val1.innerText = q.volcType;

                label2.innerText = "Elevation:";
                val2.innerText = q.elev + "m";

                label3.innerText = "Status:";
                val3.innerText = q.status;

                link.style.display = 'none';
                simBtn.style.display = 'none'; // No wave simulation for volcanoes
            } else {
                label1.innerText = "Magnitude:";
                val1.innerText = q.realMag.toFixed(2);

                label2.innerText = "Depth:";
                val2.innerText = q.depth.toFixed(1) + " km";

                label3.innerText = "Time:";
                // Fix popup time format here
                const d = new Date(q.time);
                const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                val3.innerText = dateStr;

                if (q.url) {
                    link.href = q.url;
                    link.style.display = 'block';
                } else {
                    link.style.display = 'none';
                }
                simBtn.style.display = 'block'; // Enable for quakes
            }

            document.getElementById('quake-info').style.display = 'block';

            // Fly Camera
            const PLOT_SCALE = 3000 / EARTH_RADIUS;
            // For volcanoes, depth is 0 (or negative technically), but we use 0 offset here
            // For quakes, we use depth slider
            let r_final = EARTH_RADIUS;
            if(q.type === 'quake') {
                r_final -= (q.depth * parseFloat(document.getElementById('depth-slider').value));
            }
            if(q.type === 'volcano') {
                r_final += (q.elev / 1000 * parseFloat(document.getElementById('depth-slider').value));
            }

            const [x, y, z] = latLonToXYZ(q.lat, q.lon, r_final);

            // Apply Plot Scale
            const scx = (x / EARTH_RADIUS) * PLOT_SCALE;
            const scy = (y / EARTH_RADIUS) * PLOT_SCALE;
            const scz = (z / EARTH_RADIUS) * PLOT_SCALE;

            const newCenter = { x: scx, y: scy, z: scz };

            const newCamera = {
                eye: { ...currentCamera.eye }, // Keep zoom level
                center: newCenter, // Look at point
                up: { ...currentCamera.up }
            };

            currentCamera = newCamera;
            Plotly.relayout('chart-container', { 'scene.camera': newCamera });
        }

        // Helper: Trigger the pulse animation given a quake object
        function triggerPulse(q) {
            if (!q || q.type === 'volcano') return;

            // Calculate Felt Radius based on Magnitude
            // Exponential scale: roughly M4=140km, M5=280km, M7=1000km, M9=4000km
            // Ensure visible minimum for small quakes
            const animMaxRadius = Math.max(500, Math.exp(q.realMag / 1.5) * 20);

            // Initialize Pulse Animation State
            // Store origin LAT/LON to calculate the circle correctly on sphere surface
            pulseState = {
                startTime: performance.now(),
                lat: q.lat,
                lon: q.lon,
                maxRadius: animMaxRadius
            };
        }

        function getSafeCamera(layoutScene) {
            if (!layoutScene || !layoutScene.camera) return null;

            const cam = layoutScene.camera;
            return {
                // If 'eye' is missing, use default zoom (1.5)
                eye: cam.eye ? { ...cam.eye } : { x: 1.5, y: 1.5, z: 1.5 },
                // If 'center' is missing, it means 0,0,0 (Plotly deletes it to save memory)
                center: cam.center ? { ...cam.center } : { x: 0, y: 0, z: 0 },
                // If 'up' is missing, it means Z-axis is up
                up: cam.up ? { ...cam.up } : { x: 0, y: 0, z: 1 }
            };
        }

        // --- EVENT BASED CAMERA TRACKING ---
        // This keeps currentCamera up-to-date passively.
        // We use this INSTEAD of querying _fullLayout inside click handlers.
        graphDiv.on('plotly_relayout', (eventData) => {
            // Case 1: Full camera object update
            if (eventData['scene.camera']) {
                const cam = eventData['scene.camera'];
                currentCamera = {
                    eye: cam.eye ? { ...cam.eye } : currentCamera.eye,
                    center: cam.center ? { ...cam.center } : currentCamera.center,
                    up: cam.up ? { ...cam.up } : currentCamera.up
                };
            }
            // Case 2: Partial updates (e.g. dragging updates just one axis)
            // We iterate over keys to catch things like 'scene.camera.eye.x'
            else {
                let changed = false;
                Object.keys(eventData).forEach(key => {
                    if (key.startsWith('scene.camera.')) {
                        // Determine which part (eye, center, up)
                        const parts = key.split('.'); // ['scene', 'camera', 'eye', 'x']
                        const category = parts[2]; // 'eye', 'center', or 'up'
                        const axis = parts[3];     // 'x', 'y', or 'z'

                        if (category && axis && currentCamera[category]) {
                            currentCamera[category][axis] = eventData[key];
                            changed = true;
                        }
                    }
                });
            }
        });

        graphDiv.addEventListener('touchstart', stopRotation);
        graphDiv.addEventListener('wheel', stopRotation);

        // Global Key Listener for Escape
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                const panel = document.getElementById('side-panel');
                const popup = document.getElementById('quake-info');

                if (panel.classList.contains('open')) {
                    panel.classList.remove('open');
                    return;
                }

                if (popup.style.display !== 'none') {
                    popup.style.display = 'none';
                }
            }
        });

        requestAnimationFrame(animateGlobe);
        initResumeCheck();

    } catch (err) {
        console.error("Critical Error:", err);
        document.getElementById('loading').innerText = "Error initializing app.";
    }
}

// --- INITIALIZATION CHECK ---
// Run this when the app loads to see if we crashed previously
function initResumeCheck() {
    const session = RenderSession.check();
    if (session) {
        const container = document.getElementById('resume-container');
        const text = document.getElementById('resume-text');

        container.style.display = 'block';
        text.innerText = `Previous render stopped at frame ${session.progress.current + 1} of ${session.progress.total}.`;
    }
}

initApp();
