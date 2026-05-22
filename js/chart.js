let magChartVisible = true;
let _chartW         = 0;
let _staticCanvas   = null; // offscreen layer: dots, grid, axes — rebuilt when data changes

const COLORSCALE_STOPS = {
    Hot:     [[0,'#000000'],[0.30,'#e60000'],[0.60,'#ffd200'],[1,'#ffffff']],
    YlGnBu:  [[0,'#ffffd9'],[0.25,'#7fcdbb'],[0.50,'#41b6c4'],[0.75,'#2c7fb8'],[1,'#081d58']],
    Rainbow: [[0,'#96005a'],[0.20,'#0000c8'],[0.40,'#00d200'],[0.60,'#ffff00'],[0.80,'#ff6400'],[1,'#9a0000']],
    YlOrRd:  [[0,'#ffffb2'],[0.25,'#fecc5c'],[0.50,'#fd8d3c'],[0.75,'#f03b20'],[1,'#bd0026']],
    Greys:   [[0,'#ffffff'],[1,'#000000']],
    Electric:[[0,'#000000'],[0.15,'#1e0064'],[0.40,'#7800c8'],[0.60,'#00c0ff'],[0.80,'#c8ff00'],[1,'#ffffff']]
};

const CHART_PAD = { top: 12, right: 8, bottom: 22, left: 26 };

function _fmtHoverDate(ts, spanMs) {
    const d = new Date(ts);
    const spanDays = spanMs / 86400000;
    if (spanDays > 365 * 2) return String(d.getFullYear());
    if (spanDays > 60) return d.toLocaleString('default', { month: 'short', year: '2-digit' });
    return d.toLocaleString('default', { month: 'short', day: 'numeric', year: '2-digit' });
}

function _makeColorLUT(paletteName) {
    const stops = COLORSCALE_STOPS[paletteName] || COLORSCALE_STOPS['Hot'];
    const oc = document.createElement('canvas');
    oc.width = 256; oc.height = 1;
    const ctx = oc.getContext('2d');
    const grad = ctx.createLinearGradient(0, 0, 256, 0);
    stops.forEach(([pos, color]) => grad.addColorStop(pos, color));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 1);
    return ctx.getImageData(0, 0, 256, 1).data; // Uint8ClampedArray, 256×4
}

function _sampleLUT(lut, norm) {
    const i = Math.min(255, Math.max(0, Math.round(norm * 255))) * 4;
    return [lut[i], lut[i + 1], lut[i + 2]];
}

function toggleMagChart() {
    magChartVisible = !magChartVisible;
    const panel = document.getElementById('mag-chart-panel');
    panel.style.display = magChartVisible ? 'block' : 'none';
    if (magChartVisible) {
        _staticCanvas = null; // force fresh build on open
        drawMagChart();
    }
}

// Call this whenever rawQuakeData changes so the dot layer is rebuilt.
function invalidateMagChart() {
    _staticCanvas = null;
}

let _hoverX = null; // CSS-pixel x position of mouse within canvas, null when not hovering

// Full redraw: blit the static layer then draw the scrubber and hover line on top.
function drawMagChart() {
    if (!magChartVisible) return;

    const canvas = document.getElementById('mag-chart');
    const ctx    = canvas.getContext('2d');
    const dpr    = window.devicePixelRatio || 1;

    const w = canvas.offsetWidth;
    if (w > 0) _chartW = w;
    const W = _chartW || 256;
    const H = 150;

    // Resize the visible canvas only when dimensions change (resizing resets all state).
    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width        = W * dpr;
        canvas.height       = H * dpr;
        canvas.style.height = H + 'px';
        _staticCanvas = null;
    }

    // Build the static layer if invalidated.
    if (!_staticCanvas) {
        _staticCanvas = _buildStaticLayer(W, H, dpr);
    }

    // Clear then blit static layer pixel-perfect (bypass the DPR transform).
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W * dpr, H * dpr);
    ctx.drawImage(_staticCanvas, 0, 0);

    // Overlay lines — drawn in logical coordinates with DPR scale restored.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const pad   = CHART_PAD;
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top  - pad.bottom;

    // Timelapse scrubber
    if (tlState.active) {
        const x = pad.left + ((tlState.currentTime - stats.minTime) / (stats.maxTime - stats.minTime || 1)) * plotW;
        if (x >= pad.left && x <= pad.left + plotW) {
            ctx.strokeStyle = 'rgba(255,100,60,0.9)';
            ctx.lineWidth   = 1.5;
            ctx.setLineDash([4, 3]);
            ctx.beginPath();
            ctx.moveTo(x, pad.top);
            ctx.lineTo(x, pad.top + plotH);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }

    // Hover line
    if (_hoverX !== null) {
        ctx.strokeStyle = 'rgba(255,220,0,0.7)';
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(_hoverX, pad.top);
        ctx.lineTo(_hoverX, pad.top + plotH);
        ctx.stroke();

        // Date tooltip
        if (rawQuakeData.length > 0) {
            const pct   = Math.max(0, Math.min(1, (_hoverX - pad.left) / plotW));
            const t     = stats.minTime + pct * (stats.maxTime - stats.minTime);
            const label = _fmtHoverDate(t, stats.maxTime - stats.minTime);
            const labelX = _hoverX > W / 2 ? _hoverX - 4 : _hoverX + 4;
            ctx.font         = '9px sans-serif';
            ctx.textBaseline = 'top';
            ctx.textAlign    = _hoverX > W / 2 ? 'right' : 'left';
            ctx.fillStyle    = 'rgba(255,220,0,0.95)';
            ctx.fillText(label, labelX, pad.top + 1);
        }
    }
}

function _buildStaticLayer(W, H, dpr) {
    const oc  = document.createElement('canvas');
    oc.width  = W * dpr;
    oc.height = H * dpr;
    const ctx = oc.getContext('2d');
    ctx.scale(dpr, dpr);

    const pad   = CHART_PAD;
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top  - pad.bottom;

    const light     = document.body.classList.contains('light-mode');
    const textColor = light ? '#888'              : '#666';
    const gridColor = light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
    const axisColor = light ? '#ccc'              : '#444';

    const syncColors = document.getElementById('chart-sync-colors').checked;
    const dotRGB     = light ? '0,120,120' : '0,220,220';
    let lut, colorMode, cmin, cmax;
    if (syncColors) {
        const palette = document.getElementById('color-select').value;
        colorMode     = document.getElementById('color-mode').value;
        ({ cmin, cmax } = getColorRange(colorMode));
        lut = _makeColorLUT(palette);
    }

    const titleEl = document.getElementById('mag-chart-title');

    if (rawQuakeData.length === 0) {
        ctx.fillStyle    = textColor;
        ctx.font         = '11px sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No data loaded', W / 2, H / 2);
        if (titleEl) titleEl.textContent = 'Magnitude Timeline';
        return oc;
    }

    if (titleEl) titleEl.textContent =
        `Magnitude Timeline  ·  ${rawQuakeData.length.toLocaleString()} events`;

    const minT = stats.minTime;
    const maxT = stats.maxTime;
    const minM = Math.floor(stats.minMag);
    const maxM = Math.ceil(stats.maxMag);
    const magRange = maxM - minM || 1;

    const toX = t => pad.left + ((t - minT) / (maxT - minT || 1)) * plotW;
    const toY = m => pad.top  + (1 - (m - minM) / magRange) * plotH;

    // Horizontal grid lines at each integer magnitude
    for (let m = minM; m <= maxM; m++) {
        const y = toY(m);
        ctx.strokeStyle = gridColor;
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + plotW, y);
        ctx.stroke();
    }

    // Dots — size/opacity by magnitude, color by palette or fixed cyan
    rawQuakeData.forEach(q => {
        const norm   = (q.realMag - minM) / magRange;
        const radius = 0.8 + norm * 2.4;
        const alpha  = 0.15 + norm * 0.7;

        let fillStyle;
        if (syncColors) {
            const colorVal  = colorMode === 'depth' ? q.depth
                            : colorMode === 'mag'   ? q.realMag
                            : q.time;
            const colorNorm = Math.max(0, Math.min(1, (colorVal - cmin) / (cmax - cmin || 1)));
            const [r, g, b] = _sampleLUT(lut, colorNorm);
            fillStyle = `rgba(${r},${g},${b},${alpha.toFixed(2)})`;
        } else {
            fillStyle = `rgba(${dotRGB},${alpha.toFixed(2)})`;
        }

        ctx.beginPath();
        ctx.arc(toX(q.time), toY(q.realMag), radius, 0, Math.PI * 2);
        ctx.fillStyle = fillStyle;
        ctx.fill();
    });

    // Axes
    ctx.strokeStyle = axisColor;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + plotH);
    ctx.lineTo(pad.left + plotW, pad.top + plotH);
    ctx.stroke();

    // Y-axis labels
    ctx.fillStyle    = textColor;
    ctx.font         = '9px sans-serif';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'middle';
    const yStep = magRange <= 4 ? 1 : 2;
    for (let m = minM; m <= maxM; m += yStep) {
        ctx.fillText(m, pad.left - 4, toY(m));
    }

    // X-axis: span-aware tick intervals and labels
    const spanMs   = maxT - minT || 1;
    const spanDays = spanMs / 86400000;

    function fmtTick(ts) {
        const d = new Date(ts);
        if (spanDays > 365 * 2) return String(d.getFullYear());
        if (spanDays > 60)      return d.toLocaleString('default', { month: 'short', year: '2-digit' });
        return d.toLocaleString('default', { month: 'short', day: 'numeric' });
    }

    function getIntervalTicks() {
        const ticks = [];
        const d = new Date(minT);
        let bump;
        if      (spanDays > 365*8) { d.setMonth(0,1); d.setFullYear(Math.ceil(d.getFullYear()/5)*5); bump = () => d.setFullYear(d.getFullYear()+5); }
        else if (spanDays > 365*3) { d.setMonth(0,1); d.setFullYear(d.getFullYear()+1);               bump = () => d.setFullYear(d.getFullYear()+1); }
        else if (spanDays > 180)   { d.setDate(1); d.setMonth(d.getMonth()+3-d.getMonth()%3);         bump = () => d.setMonth(d.getMonth()+3); }
        else if (spanDays > 60)    { d.setDate(1); d.setMonth(d.getMonth()+1);                        bump = () => d.setMonth(d.getMonth()+1); }
        else if (spanDays > 14)    { d.setDate(d.getDate()+7-d.getDay());                             bump = () => d.setDate(d.getDate()+7); }
        else                       { d.setDate(d.getDate()+1); d.setHours(0,0,0,0);                   bump = () => d.setDate(d.getDate()+1); }
        while (d.getTime() < maxT) { ticks.push(d.getTime()); bump(); }
        return ticks;
    }

    const ticks = getIntervalTicks();
    ctx.font = '9px sans-serif';
    ctx.textBaseline = 'top';

    ticks.forEach(t => {
        const x = toX(t);
        ctx.strokeStyle = axisColor;
        ctx.lineWidth   = 1;
        ctx.beginPath(); ctx.moveTo(x, pad.top + plotH); ctx.lineTo(x, pad.top + plotH + 3); ctx.stroke();
        ctx.strokeStyle = gridColor;
        ctx.beginPath(); ctx.moveTo(x, pad.top); ctx.lineTo(x, pad.top + plotH); ctx.stroke();
    });

    const minGap = 38;
    let lastX = pad.left - minGap;
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ticks.forEach(t => {
        const x = toX(t);
        if (x - lastX >= minGap && pad.left + plotW - x >= minGap / 2) {
            ctx.fillText(fmtTick(t), x, pad.top + plotH + 4);
            lastX = x;
        }
    });

    ctx.textAlign = 'left';
    ctx.fillText(fmtTick(minT), pad.left, pad.top + plotH + 4);
    ctx.textAlign = 'right';
    ctx.fillText(fmtTick(maxT), pad.left + plotW, pad.top + plotH + 4);

    return oc;
}

// Hover line and pointer cursor over the plot area.
document.getElementById('mag-chart').addEventListener('mousemove', (e) => {
    if (!magChartVisible) return;
    const canvas = document.getElementById('mag-chart');
    const rect   = canvas.getBoundingClientRect();
    const pad    = CHART_PAD;
    const x      = e.clientX - rect.left;
    const inPlot = x >= pad.left && x <= rect.width - pad.right;
    _hoverX             = inPlot ? x : null;
    canvas.style.cursor = (inPlot && rawQuakeData.length > 0) ? 'pointer' : 'default';
    drawMagChart();
});

document.getElementById('mag-chart').addEventListener('mouseleave', () => {
    _hoverX = null;
    const canvas = document.getElementById('mag-chart');
    canvas.style.cursor = 'default';
    drawMagChart();
});

// Click to seek timelapse — starts it first if not yet active.
document.getElementById('mag-chart').addEventListener('mousedown', async (e) => {
    if (!magChartVisible || rawQuakeData.length === 0) return;
    const canvas = document.getElementById('mag-chart');
    const rect   = canvas.getBoundingClientRect();
    const pad    = { left: 26, right: 8 };
    const plotW  = rect.width - pad.left - pad.right;
    const plotX  = (e.clientX - rect.left - pad.left) / plotW;
    if (plotX < 0 || plotX > 1) return;

    const targetTime = stats.minTime + plotX * (stats.maxTime - stats.minTime);

    if (!tlState.active) {
        await startTimeLapse();
    }

    tlState.currentTime   = targetTime;
    tlState.lastSoundTime = targetTime;
    drawMagChart();
    updateTimeLapseFrame();
});
