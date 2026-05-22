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
    const H      = 150;

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

    // X-axis labels and intermediate ticks
    const spanMs = maxT - minT || 1;
    const spanDays = spanMs / 86400000;

    function fmtTick(ts) {
        const d = new Date(ts);
        if (spanDays > 365 * 2) return String(d.getFullYear());
        if (spanDays > 60)      return d.toLocaleString('default', { month: 'short', year: '2-digit' });
        return d.toLocaleString('default', { month: 'short', day: 'numeric' });
    }

    // Compute a sensible set of intermediate tick timestamps
    function getIntervalTicks() {
        const ticks = [];
        const d = new Date(minT);
        let bump;
        if      (spanDays > 365 * 8) { d.setMonth(0,1); d.setFullYear(Math.ceil(d.getFullYear()/5)*5); bump = () => d.setFullYear(d.getFullYear()+5); }
        else if (spanDays > 365 * 3) { d.setMonth(0,1); d.setFullYear(d.getFullYear()+1);               bump = () => d.setFullYear(d.getFullYear()+1); }
        else if (spanDays > 180)     { d.setDate(1); d.setMonth(d.getMonth()+3 - ((d.getMonth())%3));   bump = () => d.setMonth(d.getMonth()+3); }
        else if (spanDays > 60)      { d.setDate(1); d.setMonth(d.getMonth()+1);                        bump = () => d.setMonth(d.getMonth()+1); }
        else if (spanDays > 14)      { d.setDate(d.getDate()+7-d.getDay());                             bump = () => d.setDate(d.getDate()+7); }
        else                         { d.setDate(d.getDate()+1); d.setHours(0,0,0,0);                   bump = () => d.setDate(d.getDate()+1); }
        while (d.getTime() < maxT) { ticks.push(d.getTime()); bump(); }
        return ticks;
    }

    const ticks = getIntervalTicks();
    ctx.textBaseline = 'top';
    ctx.font = '9px sans-serif';

    ticks.forEach(t => {
        const x = toX(t);
        // Tick mark
        ctx.strokeStyle = axisColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, pad.top + plotH);
        ctx.lineTo(x, pad.top + plotH + 3);
        ctx.stroke();
        // Subtle vertical grid line
        ctx.strokeStyle = gridColor;
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + plotH);
        ctx.stroke();
    });

    // Label only ticks that have enough room between neighbours
    const minLabelGap = 38;
    let lastLabelX = pad.left - minLabelGap;
    ctx.fillStyle = textColor;
    ctx.textAlign = 'center';
    ticks.forEach(t => {
        const x = toX(t);
        if (x - lastLabelX >= minLabelGap && pad.left + plotW - x >= minLabelGap / 2) {
            ctx.fillText(fmtTick(t), x, pad.top + plotH + 4);
            lastLabelX = x;
        }
    });

    // Start / end labels (always shown, anchored to the edges)
    ctx.textAlign = 'left';
    ctx.fillText(fmtTick(minT), pad.left, pad.top + plotH + 4);
    ctx.textAlign = 'right';
    ctx.fillText(fmtTick(maxT), pad.left + plotW, pad.top + plotH + 4);
}
