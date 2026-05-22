async function startTimeLapse() {
    if (rawQuakeData.length === 0) {
        alert("No data loaded!");
        return;
    }

    initAudio();

    document.getElementById('side-panel').classList.remove('open');
    document.getElementById('timelapse-bar').classList.add('active');

    tlState.active = true;
    tlState.playing = true;
    document.getElementById('tl-play-btn').innerText = '❚❚';

    tlState.startTime = stats.minTime;
    tlState.endTime = stats.maxTime;
    tlState.currentTime = tlState.startTime;
    tlState.lastSoundTime = tlState.startTime - 1000;
    tlState.sortedData = [...rawQuakeData].sort((a, b) => a.time - b.time);

    // Changing uirevision forces Plotly to adopt the current camera as a fresh
    // baseline rather than snapping back to its previous interaction state.
    await Plotly.relayout('chart-container', {
        'uirevision': Date.now().toString(),
        'scene.camera': { eye: { ...currentCamera.eye }, center: { ...currentCamera.center }, up: { ...currentCamera.up } }
    });

    await Plotly.restyle('chart-container', { visible: false }, [6, 9]);
    await updateTimeLapseFrame();
}

function stopTimeLapse() {
    tlState.active = false;
    tlState.playing = false;
    document.getElementById('timelapse-bar').classList.remove('active');
    updatePlot();
}

function updateTimeLapseFrame() {
    const windowEnd   = tlState.currentTime;
    const windowStart = windowEnd - tlState.windowSize;

    const depthScale   = parseFloat(document.getElementById('depth-slider').value);
    const baseSize     = parseFloat(document.getElementById('size-slider').value);
    const magBonusScale = parseFloat(document.getElementById('mag-slider').value);
    const selectedPalette = document.getElementById('color-select').value;
    const colorMode    = document.getElementById('color-mode').value;

    let visibleQuakes = tlState.sortedData.filter(q => q.time >= windowStart && q.time <= windowEnd);

    // Wrap-around: when near the start of a loop, include quakes from the end of
    // the timeline so the fade trail looks seamless across the boundary.
    if (windowStart < tlState.startTime) {
        const wrapCutoff = tlState.endTime - (tlState.startTime - windowStart);
        visibleQuakes = visibleQuakes.concat(tlState.sortedData.filter(q => q.time >= wrapCutoff));
    }

    const qx = [], qy = [], qz = [], colors = [], sizes = [];

    // Dummy point keeps the colorbar visible when there are no quakes in the window.
    if (visibleQuakes.length === 0) {
        qx.push(null); qy.push(null); qz.push(null);
        colors.push(stats.minTime);
        sizes.push(0);
    }

    visibleQuakes.forEach(q => {
        const [x, y, z] = latLonToXYZ(q.lat, q.lon, EARTH_RADIUS - q.depth * depthScale);
        qx.push(x); qy.push(y); qz.push(z);

        // freshness: 1.0 = just happened, 0.0 = about to expire
        let timeDiff = windowEnd - q.time;
        if (timeDiff < 0) timeDiff = (windowEnd - tlState.startTime) + (tlState.endTime - q.time);
        const freshness = 1 - timeDiff / tlState.windowSize;

        let s = quakeBaseSize(q, baseSize, magBonusScale);
        s *= (tlState.popEnabled && freshness > 0.95) ? 2.0 : (0.5 + 0.5 * freshness);
        sizes.push(s);

        colors.push(colorMode === 'depth' ? q.depth : colorMode === 'mag' ? q.mag : q.time);
    });

    const { cmin, cmax } = getColorRange(colorMode);

    let tickmode = 'auto', tickvals, ticktext;
    if (colorMode !== 'depth' && colorMode !== 'mag') {
        const span = cmax - cmin;
        if (span > 0) {
            tickmode = 'array';
            const step = span / 4;
            tickvals = [0, 1, 2, 3, 4].map(i => cmin + step * i);
            ticktext = tickvals.map(t => new Date(t).toISOString().split('T')[0]);
        }
    }

    return Plotly.restyle('chart-container', {
        x: [qx], y: [qy], z: [qz],
        'marker.size':              [sizes],
        'marker.color':             [colors],
        'marker.cmin':              cmin,
        'marker.cmax':              cmax,
        'marker.colorscale':        selectedPalette,
        'marker.colorbar.title.text': '',
        'marker.colorbar.tickmode': tickmode,
        'marker.colorbar.tickvals': tickvals,
        'marker.colorbar.ticktext': ticktext
    }, [8]);

    drawMagChart();
}

// --- Event Listeners ---
document.getElementById('timelapse-mode-btn').addEventListener('click', startTimeLapse);
document.getElementById('tl-close-btn').addEventListener('click', stopTimeLapse);

document.getElementById('tl-play-btn').addEventListener('click', () => {
    tlState.playing = !tlState.playing;
    document.getElementById('tl-play-btn').innerText = tlState.playing ? '❚❚' : '▶';
    initAudio();
});

document.getElementById('tl-speed').addEventListener('change', (e) => {
    tlState.speed = parseInt(e.target.value);
});

document.getElementById('tl-window').addEventListener('change', (e) => {
    tlState.windowSize = parseInt(e.target.value);
    if (!tlState.playing) updateTimeLapseFrame();
});

document.getElementById('tl-pop-check').addEventListener('change', (e) => {
    tlState.popEnabled = e.target.checked;
    if (!tlState.playing) updateTimeLapseFrame();
});

document.getElementById('tl-sound-check').addEventListener('change', (e) => {
    tlState.soundEnabled = e.target.checked;
    if (e.target.checked) initAudio();
});

document.getElementById('tl-scrubber').addEventListener('input', (e) => {
    const percent = parseFloat(e.target.value);
    tlState.currentTime = tlState.startTime + (tlState.endTime - tlState.startTime) * (percent / 100);
    tlState.lastSoundTime = tlState.currentTime;

    const dateStr = new Date(tlState.currentTime).toISOString().slice(0, 16).replace('T', ' ');
    document.getElementById('tl-date-display').innerText = dateStr;

    updateTimeLapseFrame();
});
