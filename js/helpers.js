// --- Helper Function for Frame Calc ---
function getFrameCount() {
    const val = parseInt(document.getElementById('frame-number').value);
    return val > 0 ? val : 1;
}

// --- Helper to calculate size array for renderer ---
function calculateScaledSizes(multiplier) {
    const baseSize = parseFloat(document.getElementById('size-slider').value);
    const magBonusScale = parseFloat(document.getElementById('mag-slider').value);
    const sizes = [];
    const MIDPOINT = 1.618;

    for (const q of rawQuakeData) {
        let sizeFactor = q.mag;
        if (q.mag > MIDPOINT) {
            const diff = q.mag - MIDPOINT;
            sizeFactor += (Math.pow(diff, 3) * magBonusScale);
        }
        // Apply multiplier to final size
        const s = baseSize * (sizeFactor / 2.5) * multiplier;
        sizes.push(s);
    }
    return sizes;
}

// --- Global Error Helper ---
function showError(msg) {
    const loadingDiv = document.getElementById('loading');
    loadingDiv.innerText = "Error: " + msg;
    loadingDiv.style.color = '#ff4444';
    loadingDiv.style.display = 'block';

    setTimeout(() => {
        loadingDiv.style.display = 'none';
        loadingDiv.style.color = ''; // Reset to default (CSS handles it)
        loadingDiv.innerText = "Initializing...";
    }, 3000);
}

// --- Date Helpers ---
function setDefaultDates() {
    const end = new Date();
    const start = new Date();
    start.setMonth(start.getMonth() - 1);
    document.getElementById('end-date').value = end.toISOString().split('T')[0];
    document.getElementById('start-date').value = start.toISOString().split('T')[0];
}

function applyPreset(type) {
    const end = new Date();
    let start = new Date();

    document.getElementById('min-mag-slider').value = "0";
    document.getElementById('max-mag-slider').value = "10";
    document.getElementById('min-depth-filter').value = "0";
    document.getElementById('max-depth-filter').value = "800";

    if (type === '24h') start.setDate(end.getDate() - 1);
    else if (type === '7d') start.setDate(end.getDate() - 7);
    else if (type === '30d') start.setDate(end.getDate() - 30);
    else if (type === 'sig') {
        start.setDate(end.getDate() - 30);
        document.getElementById('min-mag-slider').value = "5.0";
    } else if (type === 'deep') {
        start.setDate(end.getDate() - 365);
        document.getElementById('min-depth-filter').value = "300";
    }

    document.getElementById('end-date').value = end.toISOString().split('T')[0];
    document.getElementById('start-date').value = start.toISOString().split('T')[0];
    updateLabels();
    fetchDataAndPlot(false);
}

function updateLabels() {
    document.getElementById('size-val').innerText = parseFloat(document.getElementById('size-slider').value).toFixed(1);
    document.getElementById('mag-val').innerText = parseFloat(document.getElementById('mag-slider').value).toFixed(2);
    document.getElementById('depth-val').innerText = parseFloat(document.getElementById('depth-slider').value).toFixed(1);

    document.getElementById('min-mag-val').innerText = document.getElementById('min-mag-slider').value;
    document.getElementById('max-mag-val').innerText = document.getElementById('max-mag-slider').value;
    document.getElementById('min-depth-filter-val').innerText = document.getElementById('min-depth-filter').value;
    document.getElementById('max-depth-filter-val').innerText = document.getElementById('max-depth-filter').value;

    // Update Scale Label
    document.getElementById('render-scale-val').innerText = document.getElementById('render-scale').value + "x";
}
