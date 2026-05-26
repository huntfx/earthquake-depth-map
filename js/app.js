// --- Module-level timelapse interaction pause/resume ---
let _tlPausedForInteraction = false;
let _wheelResumeTimer       = null;

function _pauseTL() {
    if (tlState.active && tlState.playing) {
        tlState.playing = false;
        _tlPausedForInteraction = true;
        document.getElementById('tl-play-btn').innerText = '▶';
    }
}

function _resumeTL() {
    if (_tlPausedForInteraction) {
        tlState.playing = true;
        _tlPausedForInteraction = false;
        document.getElementById('tl-play-btn').innerText = '❚❚';
    }
}

// --- UI Logic ---
function toggleMenu() {
    document.getElementById('side-panel').classList.toggle('open');
}
document.getElementById('menu-btn').addEventListener('click', toggleMenu);
document.getElementById('close-btn').addEventListener('click', toggleMenu);

// Show the info popup for an earthquake or volcano, then shift the Plotly
// camera center to face it — keeping the current eye position/zoom intact.
function executeFlyTo(q) {
    if (!q) return;

    selectedQuake = q;

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
        simBtn.style.display = 'none';
    } else {
        label1.innerText = "Magnitude:";
        val1.innerText = q.realMag.toFixed(2);

        label2.innerText = "Depth:";
        val2.innerText = q.depth.toFixed(1) + " km";

        label3.innerText = "Time:";
        const d = new Date(q.time);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
        val3.innerText = dateStr;

        if (q.url) {
            link.href = q.url;
            link.style.display = 'block';
        } else {
            link.style.display = 'none';
        }
        simBtn.style.display = 'block';
    }

    document.getElementById('quake-info').style.display = 'block';

    // Shift camera center to the point's rendered position (depth-scaled for quakes).
    let r_final = EARTH_RADIUS;
    if (q.type === 'quake') r_final -= q.depth * parseFloat(document.getElementById('depth-slider').value);
    if (q.type === 'volcano') r_final += (q.elev / 1000) * parseFloat(document.getElementById('depth-slider').value);

    const [x, y, z] = latLonToXYZ(q.lat, q.lon, r_final);
    const newCenter = {
        x: (x / EARTH_RADIUS) * PLOT_SCALE,
        y: (y / EARTH_RADIUS) * PLOT_SCALE,
        z: (z / EARTH_RADIUS) * PLOT_SCALE
    };

    const liveCam   = getLiveCamera();
    const newCamera = { eye: { ...liveCam.eye }, center: newCenter, up: { ...liveCam.up } };

    currentCamera = newCamera;
    Plotly.relayout('chart-container', { 'scene.camera': newCamera });
}

// --- Initialisation Helpers ---

function setDefaults() {
    setDefaultDates();

    document.getElementById('size-slider').value = "2.5";
    document.getElementById('mag-slider').value = "0.1";
    document.getElementById('depth-slider').value = "2.5";
    document.getElementById('color-select').value = "Hot";
    document.getElementById('color-mode').value = "mag";

    document.getElementById('min-mag-slider').value = "0";
    document.getElementById('max-mag-slider').value = "10";
    document.getElementById('min-depth-filter').value = "0";
    document.getElementById('max-depth-filter').value = "800";

    document.getElementById('borders-checkbox').checked = true;
    document.getElementById('plates-checkbox').checked = true;
    document.getElementById('labels-checkbox').checked = false;
    document.getElementById('volcanoes-checkbox').checked = false;
    document.getElementById('surface-lines-checkbox').checked = false;

    updateLabels();
}

function populateAutocomplete() {
    const dataList = document.getElementById('locations-list');
    [...new Set(staticLabelArrays.text)].sort().forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        dataList.appendChild(option);
    });

    const volcList = document.getElementById('volcanoes-list');
    [...new Set(rawVolcanoData.map(v => v.name))].sort().forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        volcList.appendChild(option);
    });

    const zonesList = document.getElementById('zones-list');
    Object.keys(seismicBookmarks).forEach(name => {
        const option = document.createElement('option');
        option.value = name;
        zonesList.appendChild(option);
    });

    const notableList = document.getElementById('notable-list');
    rawNotableData.forEach(e => {
        const option = document.createElement('option');
        option.value = e.title;
        notableList.appendChild(option);
    });
}

function setupControls() {
    // Frame slider/input sync
    const frameSlider = document.getElementById('frame-slider');
    const frameInput = document.getElementById('frame-number');
    frameSlider.addEventListener('input', (e) => {
        frameInput.value = e.target.value;
        updateLabels();
    });
    frameInput.addEventListener('input', (e) => {
        let val = parseInt(e.target.value);
        if (!val || val < 1) val = 1;
        frameSlider.value = val;
        updateLabels();
    });

    // Visual sliders
    ['size-slider', 'mag-slider', 'depth-slider'].forEach(id => {
        document.getElementById(id).addEventListener('input', () => {
            updateLabels();
            if (tlState.active) updateTimeLapseFrame();
            else updatePlot();
        });
    });

    // Filter sliders
    ['min-mag-slider', 'max-mag-slider', 'min-depth-filter', 'max-depth-filter'].forEach(id => {
        document.getElementById(id).addEventListener('input', updateLabels);
    });

    document.getElementById('render-scale').addEventListener('input', updateLabels);

    // Checkboxes
    ['labels-checkbox', 'borders-checkbox', 'plates-checkbox', 'volcanoes-checkbox', 'surface-lines-checkbox'].forEach(id => {
        document.getElementById(id).addEventListener('change', () => {
            if (tlState.active) updateStaticTracesForTimelapse();
            else updatePlot();
        });
    });

    // Theme toggle
    document.getElementById('theme-btn').addEventListener('click', () => {
        isLightMode = !isLightMode;
        const btn = document.getElementById('theme-btn');
        if (isLightMode) {
            document.body.classList.add('light-mode');
            btn.innerHTML = '☾';
        } else {
            document.body.classList.remove('light-mode');
            btn.innerHTML = '☀';
        }
        if (tlState.active) updateStaticTracesForTimelapse();
        else updatePlot();
    });

    // Rotation toggle
    document.getElementById('rotate-btn').addEventListener('click', () => {
        if (rotationTimeout) {
            stopAutoRotate();
            return;
        }
        if (autoRotate) {
            stopAutoRotate();
        } else {
            autoRotate = true;
            document.getElementById('rotate-btn').innerHTML = '❚❚';
        }
    });

    // Reset view
    document.getElementById('reset-btn').addEventListener('click', () => {
        stopAutoRotate();
        const defaultCam = calculateResponsiveCamera();
        currentCamera = defaultCam;
        Plotly.relayout('chart-container', { 'scene.camera': defaultCam });
        document.getElementById('rotate-btn').innerHTML = '❚❚';
        updatePlot();
        rotationTimeout = setTimeout(() => {
            autoRotate = true;
            rotationTimeout = null;
        }, 1000);
    });

    // GPS
    document.getElementById('gps-btn').addEventListener('click', () => {
        if (!navigator.geolocation) {
            showError("Geolocation is not supported.");
            return;
        }
        navigator.geolocation.getCurrentPosition(
            (position) => {
                cameraGoTo(position.coords.latitude, position.coords.longitude, currentEyeDist());
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

    // Colour controls
    document.getElementById('color-select').addEventListener('change', () => {
        if (tlState.active) updateTimeLapseFrame();
        else updatePlot();
    });
    document.getElementById('color-mode').addEventListener('change', () => {
        if (tlState.active) updateTimeLapseFrame();
        else updatePlot();
    });

    document.getElementById('chart-sync-colors').addEventListener('change', () => {
        invalidateMagChart();
        drawMagChart();
    });

    document.getElementById('mag-chart-btn').addEventListener('click', toggleMagChart);
    document.getElementById('load-btn').addEventListener('click', () => fetchDataAndPlot(false));

    // Search — Countries
    document.getElementById('search-btn').addEventListener('click', searchLocation);
    document.getElementById('search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchLocation();
    });
    document.getElementById('search-input').addEventListener('input', (e) => {
        const val = e.target.value.trim().toLowerCase();
        const btn = document.getElementById('search-btn');
        const isValid = staticLabelArrays.text.some(name => name.toLowerCase() === val);
        btn.disabled = !isValid;
        if (isValid && e.inputType === 'insertReplacementText') {
            searchLocation();
            document.getElementById('search-input').blur();
        }
    });

    // Search — Volcanoes
    document.getElementById('volc-search-btn').addEventListener('click', searchVolcano);
    document.getElementById('volc-search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchVolcano();
    });
    document.getElementById('volc-search-input').addEventListener('input', (e) => {
        const val = e.target.value.trim().toLowerCase();
        const btn = document.getElementById('volc-search-btn');
        const isValid = rawVolcanoData.some(v => v.name.toLowerCase() === val);
        const isPartial = rawVolcanoData.some(v => v.name.toLowerCase().includes(val));
        btn.disabled = !(isValid || (val.length > 2 && isPartial));
        if (isValid && e.inputType === 'insertReplacementText') {
            searchVolcano();
            document.getElementById('volc-search-input').blur();
        }
    });

    // Simulate wave
    document.getElementById('qi-sim-btn').addEventListener('click', () => {
        if (selectedQuake) triggerPulse(selectedQuake);
    });

    // Search — Zones
    document.getElementById('zone-btn').addEventListener('click', searchZone);
    document.getElementById('zone-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchZone();
    });
    document.getElementById('zone-input').addEventListener('input', (e) => {
        const val = e.target.value.trim().toLowerCase();
        const btn = document.getElementById('zone-btn');
        const isValid = Object.keys(seismicBookmarks).some(k => k.toLowerCase() === val);
        btn.disabled = !isValid;
        if (isValid && e.inputType === 'insertReplacementText') {
            searchZone();
            document.getElementById('zone-input').blur();
        }
    });

    // Search — Notable Events
    document.getElementById('notable-btn').addEventListener('click', searchNotable);
    document.getElementById('notable-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') searchNotable();
    });
    document.getElementById('notable-input').addEventListener('input', (e) => {
        const val = e.target.value.trim().toLowerCase();
        const btn = document.getElementById('notable-btn');
        const isExact = rawNotableData.some(ev => ev.title.toLowerCase() === val);
        const isPartial = rawNotableData.some(ev => ev.title.toLowerCase().includes(val));
        btn.disabled = !(isExact || (val.length > 2 && isPartial));
        if (isExact && e.inputType === 'insertReplacementText') {
            searchNotable();
            document.getElementById('notable-input').blur();
        }
    });
}

function setupInteraction() {
    const graphDiv = document.getElementById('chart-container');

    // Pause timelapse playback during camera interaction and resume when done.
    // (_pauseTL, _resumeTL, _tlPausedForInteraction, _wheelResumeTimer are module-level)

    // HANDSHAKE STATE
    // We separate the "Data Availability" (from Plotly) and the "Interaction Complete" (from DOM)
    let interactionState = {
        isDragging: false,
        startX: 0,
        startY: 0,
        pointData: null,
        awaitingData: false
    };

    graphDiv.addEventListener('pointerdown', (e) => {
        clearTimeout(_wheelResumeTimer);
        _wheelResumeTimer = null;
        _pauseTL();
        stopAutoRotate();
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

    graphDiv.addEventListener('pointermove', (e) => {
        const dx = Math.abs(e.clientX - interactionState.startX);
        const dy = Math.abs(e.clientY - interactionState.startY);
        if (dx > 3 || dy > 3) {
            interactionState.isDragging = true;
        }
    }, {capture: true});

    graphDiv.on('plotly_click', function(data) {
        if (!data || !data.points || data.points.length === 0) return;
        interactionState.pointData = data.points[0].customdata;
        if (interactionState.awaitingData && !interactionState.isDragging) {
            executeFlyTo(interactionState.pointData);
            interactionState.awaitingData = false;
        }
    });

    graphDiv.addEventListener('pointerup', () => {
        _resumeTL();
        if (interactionState.isDragging) return;
        if (interactionState.pointData) {
            executeFlyTo(interactionState.pointData);
            interactionState.pointData = null;
        } else {
            interactionState.awaitingData = true;
            setTimeout(() => { interactionState.awaitingData = false; }, 200);
        }
    }, {capture: true});

    // EVENT BASED CAMERA TRACKING
    // Keeps currentCamera up-to-date passively instead of querying _fullLayout inside handlers.
    graphDiv.on('plotly_relayout', (eventData) => {
        if (eventData['scene.camera']) {
            const cam = eventData['scene.camera'];
            currentCamera = {
                eye:    cam.eye    ? { ...cam.eye }    : currentCamera.eye,
                center: cam.center ? { ...cam.center } : currentCamera.center,
                up:     cam.up     ? { ...cam.up }     : currentCamera.up
            };
        } else {
            Object.keys(eventData).forEach(key => {
                if (key.startsWith('scene.camera.')) {
                    const parts = key.split('.');
                    const category = parts[2];
                    const axis = parts[3];
                    if (!category) return;
                    if (axis && currentCamera[category]) {
                        currentCamera[category][axis] = eventData[key];
                    } else if (!axis && eventData[key] && typeof eventData[key] === 'object') {
                        currentCamera[category] = { ...eventData[key] };
                    }
                }
            });
        }

    });

    graphDiv.addEventListener('touchstart', stopAutoRotate);
    graphDiv.addEventListener('wheel', () => {
        stopAutoRotate();
        _pauseTL();
        clearTimeout(_wheelResumeTimer);
        Promise.resolve().then(syncSceneCamera);
        _wheelResumeTimer = setTimeout(_resumeTL, 300);
    }, { capture: true });

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
}

// --- Main App Logic ---
async function initApp() {
    try {
        console.log("Starting application...");
        setDefaults();

        console.log("Downloading static map data...");
        document.getElementById('loading').innerText = "Loading Map Data...";

        const [borderRes, platesRes, volcanoRes, notableRes] = await Promise.all([
            fetch(BORDERS_URL),
            fetch(PLATES_URL),
            fetch(VOLCANOES_URL),
            fetch(NOTABLE_URL).catch(() => null)
        ]);

        const borderJson = await borderRes.json();
        const platesJson = await platesRes.json();
        const volcanoCsv = await volcanoRes.text();

        const processedBorders = processBorders(borderJson);
        staticBorderArrays = processedBorders.borders;
        staticLabelArrays = processedBorders.labels;
        rawVolcanoData = processVolcanoes(volcanoCsv);
        staticPlateArrays = processPlates(platesJson);
        staticGridArrays = generateWireframeGrid();

        if (notableRes && notableRes.ok) {
            const notableJson = await notableRes.json();
            rawNotableData = processNotable(notableJson);
        }

        console.log(`Loaded ${rawVolcanoData.length} volcanoes.`);

        populateAutocomplete();
        setupControls();

        await fetchDataAndPlot(true);

        setupInteraction();
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
        document.getElementById('resume-container').style.display = 'block';
        document.getElementById('resume-text').innerText =
            `Previous render stopped at frame ${session.progress.current + 1} of ${session.progress.total}.`;
    }
}

initApp();
