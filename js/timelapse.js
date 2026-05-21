// --- TIME LAPSE FUNCTIONS ---

async function startTimeLapse() {
    if (rawQuakeData.length === 0) {
        alert("No data loaded!");
        return;
    }

    // Init Audio Context on user interaction
    initAudio();

    const graphDiv = document.getElementById('chart-container');

    // 1. Capture current camera state deeply to avoid reference issues
    let savedCamera = currentCamera;
    if (graphDiv._fullLayout && graphDiv._fullLayout.scene && graphDiv._fullLayout.scene.camera) {
        savedCamera = JSON.parse(JSON.stringify(graphDiv._fullLayout.scene.camera));
        currentCamera = savedCamera; // Update global state
    }

    // Hide Side Panel
    document.getElementById('side-panel').classList.remove('open');
    // Show Control Bar
    document.getElementById('timelapse-bar').classList.add('active');

    // Init State
    tlState.active = true;
    tlState.playing = true;
    document.getElementById('tl-play-btn').innerText = '❚❚';

    tlState.startTime = stats.minTime;
    tlState.endTime = stats.maxTime;
    tlState.currentTime = tlState.startTime;
    tlState.lastSoundTime = tlState.startTime - 1000; // Reset audio tracker slightly before start

    // Pre-Sort Data
    tlState.sortedData = [...rawQuakeData].sort((a,b) => a.time - b.time);

    // 2. CRITICAL FIX: Use a UNIQUE uirevision (Date.now()) instead of a constant string.
    // This forces Plotly to treat this as a fresh interaction session, adopting the
    // 'savedCamera' as the new baseline, rather than snapping back to the state
    // stored under the old 'true' key.
    await Plotly.relayout('chart-container', {
        'uirevision': Date.now().toString(),
        'scene.camera': savedCamera
    });

    // Hide Auxiliary Traces
    await Plotly.restyle('chart-container', { visible: false }, [6, 9]);

    // Initial Draw
    await updateTimeLapseFrame();
}

function stopTimeLapse() {
    const graphDiv = document.getElementById('chart-container');
    // Removed manual sync logic as requested

    tlState.active = false;
    tlState.playing = false;
    document.getElementById('timelapse-bar').classList.remove('active');

    // Restore visibility of main trace (show all)
    updatePlot();
}

function updateTimeLapseFrame() {
    // "Windowed" Fading Approach with Seamless Loop Support
    const windowEnd = tlState.currentTime;
    const windowStart = windowEnd - tlState.windowSize;

    const depthScale = parseFloat(document.getElementById('depth-slider').value);

    // FIX 1: Calculate base size dynamically using the slider logic, just like calculateScaledSizes
    const baseSizeInput = parseFloat(document.getElementById('size-slider').value);
    const magBonusScale = parseFloat(document.getElementById('mag-slider').value);
    const MIDPOINT = 1.618;

    const selectedPalette = document.getElementById('color-select').value;
    const colorMode = document.getElementById('color-mode').value;

    // Standard filter for current time window
    let visibleQuakes = tlState.sortedData.filter(q => q.time >= windowStart && q.time <= windowEnd);

    // --- WRAP-AROUND LOGIC ---
    // If we are near the start of the loop (windowStart is before minTime),
    // we should also show quakes from the very end of the timeline to create a seamless fade.
    if (windowStart < tlState.startTime) {
        const wrapOverlap = tlState.startTime - windowStart;
        const wrapCutoff = tlState.endTime - wrapOverlap;

        // Grab quakes from end of timeline
        const wrappedQuakes = tlState.sortedData.filter(q => q.time >= wrapCutoff);

        // Add them to visible list, but we need to treat their time specially for fading calculation
        visibleQuakes = visibleQuakes.concat(wrappedQuakes);
    }

    const qx = [], qy = [], qz = [], colors = [], sizes = [];

    // Persistent Colorbar Fix: Add dummy point if no quakes
    if (visibleQuakes.length === 0) {
        qx.push(null); qy.push(null); qz.push(null);
        colors.push(stats.minTime); // Dummy value within range
        sizes.push(0);
    }

    visibleQuakes.forEach(q => {
        const r_quake = EARTH_RADIUS - (q.depth * depthScale);
        const [x, y, z] = latLonToXYZ(q.lat, q.lon, r_quake);
        qx.push(x); qy.push(y); qz.push(z);

        // Fading Logic / "Pop" Logic
        let timeDiff = windowEnd - q.time;

        // Correct timeDiff for wrapped quakes (if quake is from end of timeline but we are at start)
        if (timeDiff < 0) {
            // This means q.time is bigger than windowEnd (it's from the end of the loop)
            // The actual time passed in current loop is:
            // (currentTime - startTime) + (endTime - q.time)
            timeDiff = (windowEnd - tlState.startTime) + (tlState.endTime - q.time);
        }

        // How "fresh" is this quake? 1.0 = just happened, 0.0 = about to expire
        const freshness = 1 - (timeDiff / tlState.windowSize);

        // 1. Base Size Logic from Slider
        let sizeFactor = q.mag;
        if (q.mag > MIDPOINT) {
            const diff = q.mag - MIDPOINT;
            sizeFactor += (Math.pow(diff, 3) * magBonusScale);
        }
        // Visual multiplier 1.6 used in renderFrames, 1.0 in normal plot. Let's use 1.0 for consistency.
        let s = baseSizeInput * (sizeFactor / 2.5);

        // 2. Apply Pop/Fade on top of calculated base size
        if (tlState.popEnabled && freshness > 0.95) {
            s = s * 2.0; // Pop size
        } else {
            // Fade size slightly as it gets older? Or keep constant?
            // Let's keep constant size after pop, maybe slight fade
            s = s * (0.5 + (0.5 * freshness));
        }
        sizes.push(s);

        // Color Logic
        let val;
        if (colorMode === 'depth') val = q.depth;
        else if (colorMode === 'mag') val = q.mag;
        else val = q.time;
        colors.push(val);
    });

    // --- COLOR SCALE FIX ---
    let cmin, cmax, cTitle;
    let tickmode = 'auto', tickvals = undefined, ticktext = undefined;

    if (colorMode === 'depth') {
        cTitle = 'Depth (km)';
        cmin = 0;
        cmax = Math.ceil(stats.maxDepth / 100) * 100;
    } else if (colorMode === 'mag') {
        cTitle = 'Magnitude';
        cmin = 0;
        cmax = 9;
    } else {
        cTitle = 'Date';
        cmin = stats.minTime;
        cmax = stats.maxTime;

         // Date Formatting for Colorbar
        const range = cmax - cmin;
        if (range > 0) {
             tickmode = 'array';
             // Generate 5 ticks
             const step = range / 4;
             tickvals = [cmin, cmin + step, cmin + step*2, cmin + step*3, cmax];
             ticktext = tickvals.map(t => new Date(t).toISOString().split('T')[0]);
        }
    }

    // Update Plotly Trace 7 (Quakes)
    const updateObj = {
        x: [qx], y: [qy], z: [qz],
        'marker.size': [sizes],
        'marker.color': [colors],
        'marker.cmin': cmin,
        'marker.cmax': cmax,
        'marker.colorscale': selectedPalette,
        'marker.colorbar.tickmode': tickmode,
        'marker.colorbar.tickvals': tickvals,
        'marker.colorbar.ticktext': ticktext
    };

    // Remove Title in Timelapse Mode
    if (tlState.active) {
         updateObj['marker.colorbar.title.text'] = "";
    } else {
         updateObj['marker.colorbar.title.text'] = cTitle;
    }

    return Plotly.restyle('chart-container', updateObj, [8]);
}

// Time Lapse Event Listeners
document.getElementById('timelapse-mode-btn').addEventListener('click', startTimeLapse);
document.getElementById('tl-close-btn').addEventListener('click', stopTimeLapse);

document.getElementById('tl-play-btn').addEventListener('click', () => {
    tlState.playing = !tlState.playing;
    document.getElementById('tl-play-btn').innerText = tlState.playing ? '❚❚' : '▶';
    // Resume audio context if it was suspended
    initAudio();
});

document.getElementById('tl-speed').addEventListener('change', (e) => {
    tlState.speed = parseInt(e.target.value);
});

document.getElementById('tl-window').addEventListener('change', (e) => {
    tlState.windowSize = parseInt(e.target.value);
    if (!tlState.playing) updateTimeLapseFrame(); // Update immediately if paused
});

document.getElementById('tl-pop-check').addEventListener('change', (e) => {
    tlState.popEnabled = e.target.checked;
    if (!tlState.playing) updateTimeLapseFrame(); // Update immediately if paused
});

document.getElementById('tl-sound-check').addEventListener('change', (e) => {
    tlState.soundEnabled = e.target.checked;
    if (e.target.checked) initAudio(); // Ensure audio context is ready
});

document.getElementById('tl-scrubber').addEventListener('input', (e) => {
    // Pause while scrubbing for performance
    const wasPlaying = tlState.playing;
    tlState.playing = false;
    document.getElementById('tl-play-btn').innerText = '▶';

    const percent = parseFloat(e.target.value);
    tlState.currentTime = tlState.startTime + ((tlState.endTime - tlState.startTime) * (percent / 100));

    // Update Text
    const dateObj = new Date(tlState.currentTime);
    document.getElementById('tl-date-display').innerText = dateObj.toISOString().slice(0, 16).replace('T', ' ');

    // Reset audio tracker so we don't play a million sounds when scrubbing finishes
    tlState.lastSoundTime = tlState.currentTime;

    updateTimeLapseFrame();
});
