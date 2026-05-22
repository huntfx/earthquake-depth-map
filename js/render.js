const RenderSession = {
    start: (totalFrames) => {
        const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
        sessionStorage.setItem('active_render_job', jobId);
        const state = {
            id: jobId,
            status: 'active',
            timestamp: Date.now(),
            progress: { current: -1, total: totalFrames },
            camera: currentCamera,
            settings: {
                frameValue:   document.getElementById('frame-number').value,
                isLightMode:  isLightMode,
                startDate:    document.getElementById('start-date').value,
                endDate:      document.getElementById('end-date').value,
                minMag:       document.getElementById('min-mag-slider').value,
                maxMag:       document.getElementById('max-mag-slider').value,
                minDepth:     document.getElementById('min-depth-filter').value,
                maxDepth:     document.getElementById('max-depth-filter').value,
                limit:        document.getElementById('limit-select').value,
                colorSelect:  document.getElementById('color-select').value,
                colorMode:    document.getElementById('color-mode').value,
                size:         document.getElementById('size-slider').value,
                magBonus:     document.getElementById('mag-slider').value,
                depthScale:   document.getElementById('depth-slider').value,
                filename:     document.getElementById('filename-pattern').value,
                format:       document.getElementById('render-format').value,
                scale:        document.getElementById('render-scale').value,
                borders:      document.getElementById('borders-checkbox').checked,
                plates:       document.getElementById('plates-checkbox').checked,
                labels:       document.getElementById('labels-checkbox').checked,
                volcanoes:    document.getElementById('volcanoes-checkbox').checked,
                surfaceLines: document.getElementById('surface-lines-checkbox').checked
            }
        };
        localStorage.setItem(jobId, JSON.stringify(state));
        return jobId;
    },

    update: (frameIndex) => {
        const jobId = sessionStorage.getItem('active_render_job');
        if (!jobId) return;
        const raw = localStorage.getItem(jobId);
        if (raw) {
            const state = JSON.parse(raw);
            state.progress.current = frameIndex;
            localStorage.setItem(jobId, JSON.stringify(state));
        }
    },

    complete: () => {
        const jobId = sessionStorage.getItem('active_render_job');
        if (jobId) {
            localStorage.removeItem(jobId);
            sessionStorage.removeItem('active_render_job');
        }
        document.getElementById('resume-container').style.display = 'none';
    },

    check: () => {
        const jobId = sessionStorage.getItem('active_render_job');
        if (!jobId) return null;
        const raw = localStorage.getItem(jobId);
        if (!raw) return null;
        const state = JSON.parse(raw);
        if (state.status === 'active' && state.progress.current < state.progress.total - 1) {
            return state;
        }
        return null;
    }
};

const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function generateFilename(template, index, format) {
    const numStr = (index + 1).toString();
    const hashMatch = template.match(/(#+)/);
    let base = hashMatch
        ? template.replace(hashMatch[1], numStr.padStart(hashMatch[1].length, '0'))
        : template + '_' + numStr.padStart(4, '0');
    if (!base.toLowerCase().endsWith('.' + format)) base += '.' + format;
    return base;
}

async function resumeRender() {
    const session = RenderSession.check();
    if (!session) return;

    // Ask for folder immediately to preserve the user gesture — showDirectoryPicker()
    // is blocked by the browser if called after an await.
    let dirHandle;
    try {
        dirHandle = await window.showDirectoryPicker();
    } catch (e) {
        return;
    }

    const loading = document.getElementById('loading');
    loading.style.display = 'block';
    loading.innerText = "Restoring Session...";

    const s = session.settings;

    isLightMode = s.isLightMode;
    if (isLightMode) {
        document.body.classList.add('light-mode');
        document.getElementById('theme-btn').innerHTML = '☾';
    } else {
        document.body.classList.remove('light-mode');
        document.getElementById('theme-btn').innerHTML = '☀';
    }

    [
        ['start-date', s.startDate],    ['end-date', s.endDate],
        ['min-mag-slider', s.minMag],   ['max-mag-slider', s.maxMag],
        ['min-depth-filter', s.minDepth], ['max-depth-filter', s.maxDepth],
        ['limit-select', s.limit],      ['color-select', s.colorSelect],
        ['color-mode', s.colorMode],    ['size-slider', s.size],
        ['mag-slider', s.magBonus],     ['depth-slider', s.depthScale],
        ['filename-pattern', s.filename], ['render-format', s.format],
        ['render-scale', s.scale],      ['frame-number', s.frameValue],
        ['frame-slider', s.frameValue]
    ].forEach(([id, val]) => { document.getElementById(id).value = val; });

    document.getElementById('borders-checkbox').checked      = s.borders;
    document.getElementById('plates-checkbox').checked       = s.plates;
    document.getElementById('labels-checkbox').checked       = s.labels;
    document.getElementById('volcanoes-checkbox').checked    = s.volcanoes;
    document.getElementById('surface-lines-checkbox').checked = s.surfaceLines;

    updateLabels();

    loading.innerText = "Restoring Data...";
    try {
        await fetchDataAndPlot(false);
    } catch (e) {
        alert("Could not download data. Check internet.");
        loading.style.display = 'none';
        return;
    }

    loading.innerText = "Aligning Camera...";
    currentCamera = session.camera;
    await Plotly.relayout('chart-container', { 'scene.camera': session.camera });

    await renderFrames(true, session, dirHandle);
}

async function renderFrames(isResume = false, sessionData = null, preLoadedHandle = null) {
    const loading = document.getElementById('loading');

    if (!window.showDirectoryPicker) { showError("Browser not supported."); return; }

    let startIndex = 0;
    let numFrames = getFrameCount();

    if (isResume && sessionData) {
        startIndex = sessionData.progress.current + 1;
        numFrames = sessionData.progress.total;
    } else {
        RenderSession.start(numFrames);
    }

    let dirHandle = preLoadedHandle;
    if (!dirHandle) {
        try {
            loading.innerText = "Select Folder...";
            dirHandle = await window.showDirectoryPicker();
        } catch (e) {
            loading.style.display = 'none';
            return;
        }
    }

    autoRotate = false;
    document.getElementById('rotate-btn').innerHTML = '▶';

    const format = document.getElementById('render-format').value;
    const filenamePattern = document.getElementById('filename-pattern').value;
    const sliderMultiplier = parseFloat(document.getElementById('render-scale').value);

    const graphDiv = document.getElementById('chart-container');
    const originalW = graphDiv.clientWidth;
    const originalH = graphDiv.clientHeight;

    let renderW = originalW * sliderMultiplier;
    let renderH = originalH * sliderMultiplier;
    const MAX_DIM = 8192;
    if (renderW > MAX_DIM || renderH > MAX_DIM) {
        const ratio = renderW / renderH;
        if (renderW > renderH) { renderW = MAX_DIM; renderH = MAX_DIM / ratio; }
        else                   { renderH = MAX_DIM; renderW = MAX_DIM * ratio; }
    }
    const effectiveMultiplier = renderW / originalW;

    loading.innerText = "Configuring Scene...";
    loading.style.display = 'block';

    const visualMultiplier = Math.min(effectiveMultiplier, 1.6);
    const baseRenderSize = parseFloat(document.getElementById('size-slider').value);
    const originalLabelSize = document.getElementById('labels-checkbox').checked ? 12 : 0;

    syncSceneCamera();
    await Plotly.restyle(graphDiv, { 'marker.showscale': false, 'marker.size': [calculateScaledSizes(visualMultiplier)] }, [TRACE.QUAKE]);
    await Plotly.restyle(graphDiv, { 'marker.size': baseRenderSize * 2.0 * visualMultiplier }, [TRACE.VOLCANO]);
    await Plotly.restyle(graphDiv, { 'line.width': BASE_BORDER_WIDTH * visualMultiplier }, [TRACE.BORDER]);
    await Plotly.restyle(graphDiv, { 'line.width': BASE_PLATE_WIDTH * visualMultiplier }, [TRACE.PLATE]);
    await Plotly.restyle(graphDiv, { 'textfont.size': originalLabelSize * visualMultiplier }, [TRACE.LABEL]);

    const startCam    = getLiveCamera();
    const startEye    = startCam.eye;
    const startUp     = startCam.up;
    const startCenter = startCam.center || { x: 0, y: 0, z: 0 };
    const dx = startEye.x - startCenter.x;
    const dy = startEye.y - startCenter.y;
    const dz = startEye.z - startCenter.z;

    try {
        for (let i = startIndex; i < numFrames; i++) {
            loading.innerText = `Rendering frame ${i + 1}/${numFrames}...`;

            const angle = (i / numFrames) * 2 * Math.PI;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const newEye = {
                x: startCenter.x + dx * cos - dy * sin,
                y: startCenter.y + dx * sin + dy * cos,
                z: startCenter.z + dz
            };

            await Plotly.relayout(graphDiv, {
                'scene.camera': { eye: newEye, center: startCenter, up: startUp }
            });
            await wait(20); // let WebGL finish rendering before capture

            let dataUrl = await Plotly.toImage(graphDiv, { format, width: renderW, height: renderH });

            // Decode base64 → Blob directly, avoiding a fetch() round-trip and
            // its associated Response object (saves one full copy of the image in RAM).
            let base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
            dataUrl = null;
            let bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
            base64 = null;
            let blob = new Blob([bytes], { type: `image/${format}` });
            bytes = null;

            const fileHandle = await dirHandle.getFileHandle(generateFilename(filenamePattern, i, format), { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();
            blob = null;

            RenderSession.update(i);
            await wait(0); // yield to event loop so GC can collect this frame before the next
        }

        loading.innerText = "Done!";
        RenderSession.complete();

        await Plotly.relayout(graphDiv, { 'scene.camera': { eye: startEye, center: startCenter, up: startUp } });
        await Plotly.restyle(graphDiv, { 'marker.showscale': true, 'marker.size': [calculateScaledSizes(1.0)] }, [TRACE.QUAKE]);
        await Plotly.restyle(graphDiv, { 'marker.size': baseRenderSize * 2.0 }, [TRACE.VOLCANO]);
        await Plotly.restyle(graphDiv, { 'line.width': BASE_BORDER_WIDTH }, [TRACE.BORDER]);
        await Plotly.restyle(graphDiv, { 'line.width': BASE_PLATE_WIDTH }, [TRACE.PLATE]);
        await Plotly.restyle(graphDiv, { 'textfont.size': originalLabelSize }, [TRACE.LABEL]);

        setTimeout(() => { loading.style.display = 'none'; loading.innerText = "Initializing..."; }, 2000);

    } catch (err) {
        console.warn(err);
        loading.innerText = "Crash! Refresh page to see 'Resume' button.";
        loading.style.color = "red";
    }
}

document.getElementById('render-btn').addEventListener('click', () => renderFrames(false));
document.getElementById('resume-btn').addEventListener('click', resumeRender);
