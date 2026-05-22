let magChartVisible = false;

function toggleMagChart() {
    magChartVisible = !magChartVisible;
    const panel = document.getElementById('mag-chart-panel');
    panel.style.display = magChartVisible ? 'block' : 'none';
    if (magChartVisible) drawMagChart();
}

function drawMagChart() {
    if (!magChartVisible) return;

    const canvas = document.getElementById('mag-chart');
    const ctx    = canvas.getContext('2d');
    const dpr    = window.devicePixelRatio || 1;
    const W      = canvas.offsetWidth || 256;
    const H      = 130;

    canvas.width       = W * dpr;
    canvas.height      = H * dpr;
    canvas.style.height = H + 'px';
    ctx.scale(dpr, dpr);

    const pad   = { top: 12, right: 8, bottom: 22, left: 26 };
    const plotW = W - pad.left - pad.right;
    const plotH = H - pad.top  - pad.bottom;

    ctx.clearRect(0, 0, W, H);

    const light     = document.body.classList.contains('light-mode');
    const textColor = light ? '#888'                       : '#666';
    const gridColor = light ? 'rgba(0,0,0,0.06)'          : 'rgba(255,255,255,0.06)';
    const axisColor = light ? '#ccc'                       : '#444';
    const dotRGB    = light ? '0,120,120'                  : '0,220,220';

    const titleEl = document.getElementById('mag-chart-title');

    if (rawQuakeData.length === 0) {
        ctx.fillStyle    = textColor;
        ctx.font         = '11px sans-serif';
        ctx.textAlign    = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No data loaded', W / 2, H / 2);
        if (titleEl) titleEl.textContent = 'Magnitude Timeline';
        return;
    }

    if (titleEl) titleEl.textContent =
        `Magnitude Timeline  ·  ${rawQuakeData.length.toLocaleString()} events`;

    const minT = stats.minTime;
    const maxT = stats.maxTime;
    const maxM = Math.max(stats.maxMag, 3);

    const toX = t => pad.left + ((t - minT) / (maxT - minT || 1)) * plotW;
    const toY = m => pad.top  + (1 - m / maxM) * plotH;

    // Horizontal grid lines
    for (let m = 0; m <= Math.ceil(maxM); m++) {
        const y = toY(m);
        if (y < pad.top - 1 || y > pad.top + plotH + 1) continue;
        ctx.strokeStyle = gridColor;
        ctx.lineWidth   = 1;
        ctx.beginPath();
        ctx.moveTo(pad.left,          y);
        ctx.lineTo(pad.left + plotW,  y);
        ctx.stroke();
    }

    // Dots — size and opacity scale with magnitude
    rawQuakeData.forEach(q => {
        const norm   = Math.min(q.realMag / maxM, 1);
        const radius = 0.8 + norm * 2.4;
        const alpha  = 0.15 + norm * 0.7;
        ctx.beginPath();
        ctx.arc(toX(q.time), toY(q.realMag), radius, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${dotRGB},${alpha.toFixed(2)})`;
        ctx.fill();
    });

    // Timelapse position marker
    if (tlState.active) {
        const x = toX(tlState.currentTime);
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
    for (let m = 0; m <= Math.ceil(maxM); m += 2) {
        const y = toY(m);
        if (y < pad.top - 4 || y > pad.top + plotH + 4) continue;
        ctx.fillText(m, pad.left - 4, y);
    }

    // X-axis labels (start / end year)
    ctx.textBaseline = 'top';
    ctx.textAlign    = 'left';
    ctx.fillText(new Date(minT).getFullYear(), pad.left,          pad.top + plotH + 4);
    ctx.textAlign    = 'right';
    ctx.fillText(new Date(maxT).getFullYear(), pad.left + plotW,  pad.top + plotH + 4);
}
