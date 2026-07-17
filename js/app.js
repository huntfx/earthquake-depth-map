// --- Module-level timelapse interaction pause/resume ---
let _tlPausedForInteraction = false;
let _tlRestyling            = false; // true while a timelapse Plotly.restyle is in-flight
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

// --- Touch gesture support: pinch-to-zoom + two-finger pan ---
// Plotly's gl3d orbit camera only understands a single mouse-like pointer (synthesized
// from the first touch); it has no native multi-touch pinch/pan support. We drive both
// manually with the same eye/center/up math used elsewhere (cameraGoTo, animateGlobe's
// rotation), then feed a full camera object to Plotly.relayout — same rule as everywhere
// else in this file. Bounds are derived from PLOT_SCALE (the globe's camera-space radius)
// so zoom can't push the eye inside the globe or absurdly far away.
const TOUCH_MIN_ZOOM_DIST = PLOT_SCALE * 1.2;
const TOUCH_MAX_ZOOM_DIST = PLOT_SCALE * 12;

function _applyPinchPan(zoomScale, panDX, panDY, W, H) {
    const eye = currentCamera.eye, center = currentCamera.center, up = currentCamera.up;

    // Camera basis — same derivation as _project3D / _raySphereLatLon.
    let fx = center.x - eye.x, fy = center.y - eye.y, fz = center.z - eye.z;
    const flen = Math.sqrt(fx*fx + fy*fy + fz*fz) || 1;
    fx /= flen; fy /= flen; fz /= flen;

    let rx = fy*up.z - fz*up.y, ry = fz*up.x - fx*up.z, rz = fx*up.y - fy*up.x;
    const rlen = Math.sqrt(rx*rx + ry*ry + rz*rz) || 1;
    rx /= rlen; ry /= rlen; rz /= rlen;

    const ux = ry*fz - rz*fy, uy = rz*fx - rx*fz, uz = rx*fy - ry*fx;

    // Zoom: scale the eye-center offset, clamped so the eye can't cross the globe.
    let dx = eye.x - center.x, dy = eye.y - center.y, dz = eye.z - center.z;
    const dist = Math.sqrt(dx*dx + dy*dy + dz*dz) || 1;
    const newDist = Math.max(TOUCH_MIN_ZOOM_DIST, Math.min(TOUCH_MAX_ZOOM_DIST, dist * zoomScale));
    const zf = newDist / dist;
    dx *= zf; dy *= zf; dz *= zf;

    // Pan: translate eye+center together along the screen-space right/up plane, scaled
    // so the point under the fingers stays under the fingers (gl-plot3d fovY = π/4).
    const focal  = 1.0 / Math.tan(Math.PI / 8);
    const aspect = W / H;
    const worldPerPxX = (newDist / focal) * (2 / W) * aspect;
    const worldPerPxY = (newDist / focal) * (2 / H);
    const panWorldX = -panDX * worldPerPxX;
    const panWorldY =  panDY * worldPerPxY;

    const newCenter = {
        x: center.x + rx * panWorldX + ux * panWorldY,
        y: center.y + ry * panWorldX + uy * panWorldY,
        z: center.z + rz * panWorldX + uz * panWorldY
    };
    const newEye = { x: newCenter.x + dx, y: newCenter.y + dy, z: newCenter.z + dz };

    currentCamera = { eye: newEye, center: newCenter, up: { ...up } };
    Plotly.relayout('chart-container', { 'scene.camera': currentCamera });
}

// Patch glplot.camera.lookAt — the primitive Plotly 2.27 uses to re-apply the layout
// camera after every restyle. Blocked when _tlRestyling is true so timelapse data
// updates cannot snap the WebGL camera to the stale _fullLayout.scene.camera value.
// Re-applied on each pointerdown to survive any gl-plot3d scene recreation.
function _applySetCameraGuard() {
    const fl    = getChartDiv()._fullLayout;
    const inner = fl?.scene?._scene;
    const glcam = inner?.glplot?.camera;
    if (!glcam || !glcam.lookAt || glcam._lookAtGuarded) return;
    const origLookAt = glcam.lookAt.bind(glcam);
    glcam.lookAt = (...args) => { if (!_tlRestyling) origLookAt(...args); };
    glcam._lookAtGuarded = true;
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

    const newCamera = { eye: { ...currentCamera.eye }, center: newCenter, up: { ...currentCamera.up } };

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

// Custom autocomplete dropdown — replaces <datalist>, which iOS Safari doesn't support
// at all (no suggestion UI would ever show on iPhone). getCandidates() is called lazily
// on each keystroke rather than once up front, so it always sees the latest data even if
// this is wired up before that data finishes loading. onSelect(name) fires after the
// input's value is set to the picked candidate — callers use it to run the search and
// blur the field, mirroring what the old datalist "insertReplacementText" branch did.
function _setupAutocomplete(input, list, getCandidates, onSelect) {
    let matches = [];
    let activeIndex = -1;

    function render() {
        list.innerHTML = '';
        matches.forEach((name, i) => {
            const item = document.createElement('div');
            item.className = 'ac-item';
            item.textContent = name;
            // pointerdown (not click) + preventDefault — a click fires after the input's
            // blur, which would already have closed and cleared this list.
            item.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                pick(name);
            });
            list.appendChild(item);
        });
        [...list.children].forEach((el, i) => el.classList.toggle('active', i === activeIndex));
        list.classList.toggle('open', matches.length > 0);
    }

    function close() {
        matches = [];
        activeIndex = -1;
        list.innerHTML = '';
        list.classList.remove('open');
    }

    function pick(name) {
        input.value = name;
        close();
        onSelect(name);
    }

    // val === '' shows the first 8 candidates unfiltered — lets a short fixed list (e.g.
    // the 7 seismic zones) be browsed on focus rather than requiring the user to type,
    // matching how a native <datalist> shows all options on an empty focused input.
    function open(val) {
        const candidates = getCandidates();
        matches = val ? candidates.filter(c => c.toLowerCase().includes(val)).slice(0, 8) : candidates.slice(0, 8);
        render();
    }

    input.addEventListener('input', () => {
        activeIndex = -1;
        open(input.value.trim().toLowerCase());
    });

    input.addEventListener('focus', () => {
        if (!input.value.trim()) open('');
    });

    input.addEventListener('keydown', (e) => {
        if (!matches.length) return;
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            activeIndex = Math.min(activeIndex + 1, matches.length - 1);
            render();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            activeIndex = Math.max(activeIndex - 1, 0);
            render();
        } else if (e.key === 'Enter' && activeIndex >= 0) {
            e.preventDefault();
            pick(matches[activeIndex]);
        } else if (e.key === 'Escape') {
            close();
        }
    });

    // Delay so a pointerdown on an .ac-item (which doesn't itself steal focus) can still
    // run before the list gets torn down.
    input.addEventListener('blur', () => setTimeout(close, 150));
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

    // Waves toggle
    document.getElementById('live-btn').addEventListener('click', () => {
        wavesEnabled = !wavesEnabled;
        if (!wavesEnabled) {
            tlState.lastPulseTime = tlState.currentTime;
            // When timelapse is paused, preserve pulseStates — they're frozen in
            // place and can be redrawn as-is when waves are re-enabled.
            if (!tlState.active || tlState.playing || liveState.active) pulseStates = [];
        } else {
            if (liveState.active) { pulseStates = []; seedLive(); }
            else if (tlState.active && pulseStates.length === 0) restoreActivePulses();
        }
        document.getElementById('live-btn').classList.toggle('active', wavesEnabled);
    });

    // Reset view
    document.getElementById('reset-btn').addEventListener('click', () => {
        stopAutoRotate();
        const defaultCam = calculateResponsiveCamera();
        currentCamera = defaultCam;
        Plotly.relayout('chart-container', { 'scene.camera': defaultCam });
        document.getElementById('rotate-btn').innerHTML = '❚❚';
        updatePlot();
        wavesEnabled = true;
        document.getElementById('live-btn').classList.add('active');
        startLive();
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
    });
    _setupAutocomplete(
        document.getElementById('search-input'),
        document.getElementById('search-ac-list'),
        () => [...new Set(staticLabelArrays.text)],
        () => { searchLocation(); document.getElementById('search-input').blur(); }
    );

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
    });
    _setupAutocomplete(
        document.getElementById('volc-search-input'),
        document.getElementById('volc-ac-list'),
        () => [...new Set(rawVolcanoData.map(v => v.name))],
        () => { searchVolcano(); document.getElementById('volc-search-input').blur(); }
    );

    // Simulate wave
    document.getElementById('qi-sim-btn').addEventListener('click', () => {
        if (selectedQuake) _triggerLivePulse(selectedQuake.lat, selectedQuake.lon, selectedQuake.realMag || selectedQuake.mag);
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
    });
    _setupAutocomplete(
        document.getElementById('zone-input'),
        document.getElementById('zone-ac-list'),
        () => Object.keys(seismicBookmarks),
        () => { searchZone(); document.getElementById('zone-input').blur(); }
    );

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
    });
    _setupAutocomplete(
        document.getElementById('notable-input'),
        document.getElementById('notable-ac-list'),
        () => rawNotableData.map(ev => ev.title),
        () => { searchNotable(); document.getElementById('notable-input').blur(); }
    );
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
        if (!e.isPrimary) return; // ignore a second touch finger — see pinch/pan handling below
        clearTimeout(_wheelResumeTimer);
        _wheelResumeTimer = null;
        _pauseTL();
        if (tlState.active) _applySetCameraGuard();
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
        if (!e.isPrimary) return;
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

    graphDiv.addEventListener('pointerup', (e) => {
        if (!e.isPrimary) return;
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
    graphDiv.addEventListener('pointerdown', stopAutoRotate);
    graphDiv.addEventListener('wheel', () => {
        stopAutoRotate();
        _pauseTL();
        clearTimeout(_wheelResumeTimer);
        _wheelResumeTimer = setTimeout(_resumeTL, 300);
    }, { capture: true });

    // --- Two-finger pinch-zoom / pan ---
    // Intercepted as raw Touch events (not Pointer events) at the capture phase, before
    // they reach Plotly's canvas. preventDefault() on touchstart/touchmove here also
    // suppresses the browser's synthetic compatibility mousemove/mousedown that Plotly's
    // gl3d orbit camera is driven by — this is what stops Plotly fighting our pinch/pan.
    // Single-finger touches are left completely alone so Plotly's native touch-orbit
    // rotation keeps working exactly as before.
    let _pinchActive = false;
    let _pinchPrevDist = 0;
    let _pinchPrevMid = { x: 0, y: 0 };

    function _touchDistMid(touches) {
        const t0 = touches[0], t1 = touches[1];
        const dx = t0.clientX - t1.clientX, dy = t0.clientY - t1.clientY;
        return { dist: Math.hypot(dx, dy), mid: { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 } };
    }

    graphDiv.addEventListener('touchstart', (e) => {
        if (e.touches.length >= 2) {
            e.preventDefault();
            e.stopImmediatePropagation();
            stopAutoRotate();
            _pauseTL();
            _pinchActive = true;
            const { dist, mid } = _touchDistMid(e.touches);
            _pinchPrevDist = dist;
            _pinchPrevMid = mid;
        } else if (_pinchActive) {
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, { capture: true, passive: false });

    graphDiv.addEventListener('touchmove', (e) => {
        if (e.touches.length >= 2) {
            e.preventDefault();
            e.stopImmediatePropagation();
            const { dist, mid } = _touchDistMid(e.touches);
            if (_pinchPrevDist > 0) {
                const scale = _pinchPrevDist / dist;
                const gd = getChartDiv();
                _applyPinchPan(scale, mid.x - _pinchPrevMid.x, mid.y - _pinchPrevMid.y, gd.clientWidth, gd.clientHeight);
            }
            _pinchPrevDist = dist;
            _pinchPrevMid = mid;
        } else if (_pinchActive) {
            // One finger lifted mid-pinch — freeze rather than resume Plotly's rotate
            // with a stale drag reference (that's what causes camera-snap bugs here).
            e.preventDefault();
            e.stopImmediatePropagation();
        }
    }, { capture: true, passive: false });

    const _endPinch = (e) => {
        if (!_pinchActive) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        if (e.touches.length >= 2) {
            const { dist, mid } = _touchDistMid(e.touches);
            _pinchPrevDist = dist;
            _pinchPrevMid = mid;
        } else if (e.touches.length === 0) {
            _pinchActive = false;
            _resumeTL();
        }
    };
    graphDiv.addEventListener('touchend', _endPinch, { capture: true, passive: false });
    graphDiv.addEventListener('touchcancel', _endPinch, { capture: true, passive: false });

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

        setupControls();

        await fetchDataAndPlot(true);

        setupInteraction();
        requestAnimationFrame(animateGlobe);
        startLive();
        document.getElementById('live-btn').classList.add('active');
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
