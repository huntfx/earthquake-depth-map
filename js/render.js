const RenderSession = {
    // Start a new job
    start: (totalFrames) => {
        // Generate Unique ID for this job
        const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);

        // 1. Save this ID to this tab's SessionStorage (survives reload, unique to tab)
        sessionStorage.setItem('active_render_job', jobId);

        const state = {
            id: jobId, // Store ID inside state too
            status: 'active',
            timestamp: Date.now(),
            progress: { current: -1, total: totalFrames },
            camera: currentCamera,
            settings: {
                frameValue: document.getElementById('frame-number').value, // Remember the new input!
                isLightMode: isLightMode,
                startDate: document.getElementById('start-date').value,
                endDate: document.getElementById('end-date').value,
                minMag: document.getElementById('min-mag-slider').value,
                maxMag: document.getElementById('max-mag-slider').value,
                minDepth: document.getElementById('min-depth-filter').value,
                maxDepth: document.getElementById('max-depth-filter').value,
                limit: document.getElementById('limit-select').value,
                colorSelect: document.getElementById('color-select').value,
                colorMode: document.getElementById('color-mode').value,
                size: document.getElementById('size-slider').value,
                magBonus: document.getElementById('mag-slider').value,
                depthScale: document.getElementById('depth-slider').value,
                filename: document.getElementById('filename-pattern').value,
                format: document.getElementById('render-format').value,
                scale: document.getElementById('render-scale').value,
                borders: document.getElementById('borders-checkbox').checked,
                plates: document.getElementById('plates-checkbox').checked,
                labels: document.getElementById('labels-checkbox').checked,
                volcanoes: document.getElementById('volcanoes-checkbox').checked,
                surfaceLines: document.getElementById('surface-lines-checkbox').checked
            }
        };

        // 2. Save full data to LocalStorage (Shared storage, but unique key)
        localStorage.setItem(jobId, JSON.stringify(state));
        return jobId;
    },

    update: (frameIndex) => {
        // Get the ID this tab is responsible for
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
            localStorage.removeItem(jobId);       // Clear data
            sessionStorage.removeItem('active_render_job'); // Clear tab association
        }
        document.getElementById('resume-container').style.display = 'none';
    },

    check: () => {
        // 1. Check if THIS tab had an active job
        const jobId = sessionStorage.getItem('active_render_job');
        if (!jobId) return null;

        // 2. Retrieve the data for that job
        const raw = localStorage.getItem(jobId);
        if (!raw) return null;

        const state = JSON.parse(raw);
        if (state.status === 'active' && state.progress.current < state.progress.total - 1) {
            return state;
        }
        return null;
    }
};

async function resumeRender() {
    const session = RenderSession.check();
    if (!session) return;

    // 1. CRITICAL FIX: Ask for folder IMMEDIATELY to preserve User Gesture
    // We cannot await the network call first, or the browser will block the folder picker.
    let dirHandle;
    try {
        dirHandle = await window.showDirectoryPicker();
    } catch (e) {
        return; // User cancelled
    }

    const loading = document.getElementById('loading');
    loading.style.display = 'block';
    loading.innerText = "Restoring Session...";

    // 2. Restore UI Settings
    const s = session.settings;

    // Restore Theme
    isLightMode = s.isLightMode;
    const themeBtn = document.getElementById('theme-btn');
    if (isLightMode) {
        document.body.classList.add('light-mode');
        themeBtn.innerHTML = '☾';
    } else {
        document.body.classList.remove('light-mode');
        themeBtn.innerHTML = '☀';
    }

    // Restore Frame Slider & Inputs
    document.getElementById('start-date').value = s.startDate;
    document.getElementById('end-date').value = s.endDate;
    document.getElementById('min-mag-slider').value = s.minMag;
    document.getElementById('max-mag-slider').value = s.maxMag;
    document.getElementById('min-depth-filter').value = s.minDepth;
    document.getElementById('max-depth-filter').value = s.maxDepth;
    document.getElementById('limit-select').value = s.limit;

    document.getElementById('color-select').value = s.colorSelect;
    document.getElementById('color-mode').value = s.colorMode;
    document.getElementById('size-slider').value = s.size;
    document.getElementById('mag-slider').value = s.magBonus;
    document.getElementById('depth-slider').value = s.depthScale;

    document.getElementById('filename-pattern').value = s.filename;
    document.getElementById('render-format').value = s.format;
    document.getElementById('render-scale').value = s.scale;

    document.getElementById('borders-checkbox').checked = s.borders;
    document.getElementById('plates-checkbox').checked = s.plates;
    document.getElementById('labels-checkbox').checked = s.labels;
    document.getElementById('volcanoes-checkbox').checked = s.volcanoes;
    document.getElementById('surface-lines-checkbox').checked = s.surfaceLines;

    document.getElementById('frame-number').value = s.frameValue;
    document.getElementById('frame-slider').value = s.frameValue;

    // Force UI labels to update (Frame Count, etc.)
    updateLabels();

    // 3. Fetch Data
    loading.innerText = "Restoring Data...";
    try {
        await fetchDataAndPlot(false);
    } catch (e) {
        alert("Could not download data. Check internet.");
        loading.style.display = 'none';
        return;
    }

    // 4. Restore Camera
    loading.innerText = "Aligning Camera...";
    currentCamera = session.camera;
    await Plotly.relayout('chart-container', { 'scene.camera': session.camera });

    autoRotate = false;
    document.getElementById('rotate-btn').innerHTML = '▶';

    // 5. Start Render (Pass the directory handle we already got!)
    await renderFrames(true, session, dirHandle);
}

// Frame Rendering
async function renderFrames(isResume = false, sessionData = null, preLoadedHandle = null) {
    const loading = document.getElementById('loading');

    if (!window.showDirectoryPicker) { showError("Browser not supported."); return; }

    // --- SETUP VARIABLES ---
    let startIndex = 0;
    let numFrames = getFrameCount();

    if (isResume && sessionData) {
        startIndex = sessionData.progress.current + 1;
        numFrames = sessionData.progress.total;
    } else {
        RenderSession.start(numFrames);
    }

    // Use pre-loaded handle if available (Resume Mode), otherwise ask (New Mode)
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

    const filenamePattern = document.getElementById('filename-pattern').value;
    const format = document.getElementById('render-format').value;
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
        else { renderH = MAX_DIM; renderW = MAX_DIM * ratio; }
    }
    const effectiveMultiplier = renderW / originalW;

    // --- VISUAL SCALING ---
    loading.innerText = "Configuring Scene...";
    loading.style.display = 'block';

    const visualMultiplier = Math.min(effectiveMultiplier, 1.6);
    const scaledMarkerSizes = calculateScaledSizes(visualMultiplier);
    const baseRenderSize = parseFloat(document.getElementById('size-slider').value);
    const scaledVolcanoSize = baseRenderSize * 2.0 * visualMultiplier;
    const scaledBorderWidth = BASE_BORDER_WIDTH * visualMultiplier;
    const scaledPlateWidth = BASE_PLATE_WIDTH * visualMultiplier;
    const originalLabelSize = document.getElementById('labels-checkbox').checked ? 12 : 0;
    const scaledLabelSize = originalLabelSize * visualMultiplier;

    await Plotly.restyle(graphDiv, { 'marker.showscale': false, 'marker.size': [scaledMarkerSizes] }, [8]);
    await Plotly.restyle(graphDiv, { 'marker.size': scaledVolcanoSize }, [5]);
    await Plotly.restyle(graphDiv, { 'line.width': scaledBorderWidth }, [2]);
    await Plotly.restyle(graphDiv, { 'line.width': scaledPlateWidth }, [3]);
    await Plotly.restyle(graphDiv, { 'textfont.size': scaledLabelSize }, [4]);

    const currentCenter = currentCamera.center || {x: 0, y: 0, z: 0};
    const startEye = { ...currentCamera.eye };
    const startUp = { ...currentCamera.up };

    const dx = startEye.x - currentCenter.x;
    const dy = startEye.y - currentCenter.y;
    const dz = startEye.z - currentCenter.z;

    const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    function generateFilename(template, index) {
        const numStr = (index + 1).toString();
        const hashMatch = template.match(/(#+)/);
        let base = template;
        if (hashMatch) {
            const len = hashMatch[1].length;
            const padded = numStr.padStart(len, '0');
            base = template.replace(hashMatch[1], padded);
        } else {
            base = template + '_' + numStr.padStart(4, '0');
        }
        if (!base.toLowerCase().endsWith('.' + format)) base += '.' + format;
        return base;
    }

    try {
        for (let i = startIndex; i < numFrames; i++) {

            loading.innerText = `Rendering frame ${i + 1}/${numFrames}...`;

            const angle = (i / numFrames) * 2 * Math.PI;
            const cos = Math.cos(angle);
            const sin = Math.sin(angle);
            const newDx = dx * cos - dy * sin;
            const newDy = dx * sin + dy * cos;
            const newEye = { x: currentCenter.x + newDx, y: currentCenter.y + newDy, z: currentCenter.z + dz };

            await Plotly.relayout(graphDiv, { 'scene.camera.eye': newEye });
            await wait(20);

            let dataUrl = await Plotly.toImage(graphDiv, { format: format, width: renderW, height: renderH });
            let res = await fetch(dataUrl);
            let blob = await res.blob();

            const fileName = generateFilename(filenamePattern, i);
            const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
            const writable = await fileHandle.createWritable();
            await writable.write(blob);
            await writable.close();

            // Update session progress AFTER write
            RenderSession.update(i);

            dataUrl = null; res = null; blob = null;
        }

        loading.innerText = "Done!";

        RenderSession.complete();

        await Plotly.relayout(graphDiv, { 'scene.camera': { eye: startEye, center: currentCenter, up: startUp } });
        const normalSizes = calculateScaledSizes(1.0);
        await Plotly.restyle(graphDiv, { 'marker.size': baseRenderSize * 2.0 }, [5]);
        await Plotly.restyle(graphDiv, { 'marker.showscale': true, 'marker.size': [normalSizes] }, [8]);
        await Plotly.restyle(graphDiv, { 'line.width': BASE_BORDER_WIDTH }, [2]);
        await Plotly.restyle(graphDiv, { 'line.width': BASE_PLATE_WIDTH }, [3]);
        await Plotly.restyle(graphDiv, { 'textfont.size': originalLabelSize }, [4]);

        setTimeout(() => { loading.style.display = 'none'; loading.innerText = "Initializing..."; }, 2000);

    } catch (err) {
        console.warn(err);
        loading.innerText = "Crash! Refresh page to see 'Resume' button.";
        loading.style.color = "red";
    }
}

document.getElementById('render-btn').addEventListener('click', () => renderFrames(false));
document.getElementById('resume-btn').addEventListener('click', resumeRender);
