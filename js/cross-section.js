// Plotly colorscale stop definitions, mirroring the options in the settings panel.
const _CS_SCALES = {
    Hot:    [[0,[0,0,0]],[0.3,[230,0,0]],[0.6,[255,210,0]],[1,[255,255,255]]],
    YlGnBu: [[0,[8,29,88]],[0.125,[37,52,148]],[0.25,[34,94,168]],[0.375,[29,145,192]],
             [0.5,[65,182,196]],[0.625,[127,205,187]],[0.75,[199,233,180]],[0.875,[237,248,217]],[1,[255,255,217]]],
    Rainbow:[[0,[150,0,90]],[0.125,[0,0,200]],[0.25,[0,25,255]],[0.375,[0,152,255]],
             [0.5,[44,255,150]],[0.625,[151,255,0]],[0.75,[255,234,0]],[0.875,[255,111,0]],[1,[255,0,0]]],
    YlOrRd: [[0,[255,255,204]],[0.125,[255,237,160]],[0.25,[254,217,118]],[0.375,[254,178,76]],
             [0.5,[253,141,60]],[0.625,[252,78,42]],[0.75,[227,26,28]],[0.875,[189,0,38]],[1,[128,0,38]]],
    Greys:  [[0,[255,255,255]],[1,[0,0,0]]],
    Electric:[[0,[0,0,0]],[0.15,[30,0,100]],[0.4,[120,0,100]],[0.6,[160,90,0]],[0.8,[230,200,0]],[1,[255,255,255]]]
};

function _csColorFromScale(t, scaleName) {
    const scale = _CS_SCALES[scaleName] || _CS_SCALES.Hot;
    t = Math.max(0, Math.min(1, t));
    for (let i = 1; i < scale.length; i++) {
        if (t <= scale[i][0]) {
            const t0 = scale[i-1][0], t1 = scale[i][0];
            const f  = (t - t0) / (t1 - t0);
            const c0 = scale[i-1][1], c1 = scale[i][1];
            return [
                Math.round(c0[0] + f * (c1[0] - c0[0])),
                Math.round(c0[1] + f * (c1[1] - c0[1])),
                Math.round(c0[2] + f * (c1[2] - c0[2]))
            ];
        }
    }
    return scale[scale.length - 1][1];
}

const csState = {
    phase: 0,        // 0=closed, 1=place A, 2=place B, 3=view+drag
    pointA: null,    // { lat, lon }
    pointB: null,
    dragging: null,  // 'A' | 'B' | null
    data: [],
    totalDist: 0,
    threshold: 300   // km corridor half-width
};

// ---- State management ----

function openCrossSection() {
    csState.phase    = 1;
    csState.pointA   = null;
    csState.pointB   = null;
    csState.data     = [];
    csState.dragging = null;
    document.getElementById('cs-focus-btn').style.display = 'none';
    document.getElementById('cs-btn').classList.add('active');
    document.getElementById('cs-panel').style.display = 'block';
    _csSetStatus('Click point A on the globe');
}

function closeCrossSection() {
    csState.phase    = 0;
    csState.dragging = null;
    document.getElementById('cs-focus-btn').style.display = 'none';
    document.getElementById('cs-drag-overlay').style.display = 'none';
    document.getElementById('cs-btn').classList.remove('active');
    document.getElementById('cs-panel').style.display = 'none';
}

function _csSetStatus(msg) {
    document.getElementById('cs-status').innerText = msg;
}

// ---- Geometry ----

function _gcDistRad(lat1, lon1, lat2, lon2) {
    const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    const Δφ = φ2 - φ1, Δλ = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
    return 2 * Math.asin(Math.sqrt(Math.min(1, a)));
}

function _bearing(lat1, lon1, lat2, lon2) {
    const φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;
    return Math.atan2(
        Math.sin(Δλ) * Math.cos(φ2),
        Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
    );
}

function _crossAlongTrack(A, B, C) {
    const δ13 = _gcDistRad(A.lat, A.lon, C.lat, C.lon);
    const θ12 = _bearing(A.lat, A.lon, B.lat, B.lon);
    const θ13 = _bearing(A.lat, A.lon, C.lat, C.lon);
    const dxt = Math.asin(Math.max(-1, Math.min(1, Math.sin(δ13) * Math.sin(θ13 - θ12))));
    const cosDxt = Math.cos(dxt);
    const dat = cosDxt < 1e-10 ? 0 : Math.acos(Math.max(-1, Math.min(1, Math.cos(δ13) / cosDxt)));
    return {
        crossTrack: Math.abs(dxt) * EARTH_RADIUS,
        alongTrack: (Math.cos(θ13 - θ12) >= 0 ? 1 : -1) * dat * EARTH_RADIUS
    };
}

// Spherical linear interpolation between two lat/lon points at fraction t.
function _slerp(A, B, t) {
    const toVec = ({ lat, lon }) => {
        const φ = lat * Math.PI / 180, λ = lon * Math.PI / 180;
        return [Math.cos(φ)*Math.cos(λ), Math.cos(φ)*Math.sin(λ), Math.sin(φ)];
    };
    const v1 = toVec(A), v2 = toVec(B);
    let dot = Math.max(-1, Math.min(1, v1[0]*v2[0] + v1[1]*v2[1] + v1[2]*v2[2]));
    const omega = Math.acos(dot);
    if (omega < 1e-10) return A;
    const s = Math.sin(omega);
    const w1 = Math.sin((1 - t) * omega) / s;
    const w2 = Math.sin(t * omega) / s;
    const vt = [w1*v1[0]+w2*v2[0], w1*v1[1]+w2*v2[1], w1*v1[2]+w2*v2[2]];
    return {
        lat: Math.asin(Math.max(-1, Math.min(1, vt[2]))) * 180 / Math.PI,
        lon: Math.atan2(vt[1], vt[0]) * 180 / Math.PI
    };
}

// ---- Ray picking ----

// Cast a ray from screen pixel (sx, sy) and return the lat/lon of the globe surface
// hit, or null if the ray misses. Uses the same camera math as _project3D (inverse).
function _raySphereLatLon(sx, sy, W, H, lc) {
    const ndcX = 2 * sx / W - 1;
    const ndcY = 1 - 2 * sy / H;

    // Camera basis — identical derivation to _project3D in animation.js
    let fx = lc.center.x - lc.eye.x;
    let fy = lc.center.y - lc.eye.y;
    let fz = lc.center.z - lc.eye.z;
    const flen = Math.sqrt(fx*fx + fy*fy + fz*fz);
    fx /= flen; fy /= flen; fz /= flen;

    const ux = lc.up.x, uy = lc.up.y, uz = lc.up.z;
    let rx = fy*uz - fz*uy;
    let ry = fz*ux - fx*uz;
    let rz = fx*uy - fy*ux;
    const rlen = Math.sqrt(rx*rx + ry*ry + rz*rz);
    rx /= rlen; ry /= rlen; rz /= rlen;

    const upx = ry*fz - rz*fy;
    const upy = rz*fx - rx*fz;
    const upz = rx*fy - ry*fx;

    // gl-plot3d default fovY = π/4 → focal = 1/tan(π/8)
    const focal  = 1.0 / Math.tan(Math.PI / 8);
    const aspect = W / H;

    // Ray direction from NDC → camera space → world space
    const cx = ndcX * aspect / focal;
    const cy = ndcY / focal;
    let dx = cx*rx + cy*upx + fx;
    let dy = cx*ry + cy*upy + fy;
    let dz = cx*rz + cy*upz + fz;
    const dlen = Math.sqrt(dx*dx + dy*dy + dz*dz);
    dx /= dlen; dy /= dlen; dz /= dlen;

    // Ray-sphere intersection: sphere at origin, radius PLOT_SCALE
    const ex = lc.eye.x, ey = lc.eye.y, ez = lc.eye.z;
    const b   = ex*dx + ey*dy + ez*dz;
    const c   = ex*ex + ey*ey + ez*ez - PLOT_SCALE*PLOT_SCALE;
    const disc = b*b - c;
    if (disc < 0) return null;

    const t = -b - Math.sqrt(disc); // near intersection
    if (t < 0) return null;

    const hx = ex + t*dx, hy = ey + t*dy, hz = ez + t*dz;
    const s  = EARTH_RADIUS / PLOT_SCALE;
    return {
        lat: Math.asin(Math.max(-1, Math.min(1, hz * s / EARTH_RADIUS))) * 180 / Math.PI,
        lon: Math.atan2(hy * s, hx * s) * 180 / Math.PI
    };
}

// Return 'A' or 'B' if the screen point (sx, sy) is within 25 px of that marker.
function _hitTest(sx, sy, W, H, lc) {
    let nearest = null, minD = 25;
    for (const label of ['A', 'B']) {
        const pt = label === 'A' ? csState.pointA : csState.pointB;
        if (!pt) continue;
        const [x, y, z] = latLonToXYZ(pt.lat, pt.lon, EARTH_RADIUS);
        const p = _project3D(W, H, lc, x, y, z);
        if (!p) continue;
        const px = (p.ndcX + 1) * 0.5 * W;
        const py = (1 - p.ndcY) * 0.5 * H;
        const d  = Math.sqrt((px - sx)**2 + (py - sy)**2);
        if (d < minD) { minD = d; nearest = label; }
    }
    return nearest;
}

// ---- Computation ----

function computeAndDrawCrossSection() {
    const A = csState.pointA, B = csState.pointB;
    if (!A || !B) return;

    const totalDist = _gcDistRad(A.lat, A.lon, B.lat, B.lon) * EARTH_RADIUS;
    if (totalDist < 10) {
        _csSetStatus('Points too close — move them further apart');
        return;
    }
    csState.totalDist = totalDist;

    const data = [];
    for (const q of rawQuakeData) {
        const { crossTrack, alongTrack } = _crossAlongTrack(A, B, q);
        if (crossTrack <= csState.threshold && alongTrack >= 0 && alongTrack <= totalDist) {
            data.push({ q, alongTrack });
        }
    }
    csState.data = data;
    document.getElementById('cs-focus-btn').style.display = 'block';
    _csSetStatus(`${data.length} quakes within ±${csState.threshold} km · drag A or B to adjust`);
    drawCrossSection();
}

// ---- Panel chart ----

function drawCrossSection() {
    const canvas = document.getElementById('cs-canvas');
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const w   = canvas.offsetWidth;
    const h   = canvas.offsetHeight;
    canvas.width  = w * dpr;
    canvas.height = h * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    const pad = { top: 14, right: 20, bottom: 28, left: 42 };
    const cw  = w - pad.left - pad.right;
    const ch  = h - pad.top  - pad.bottom;

    ctx.clearRect(0, 0, w, h);

    if (!csState.data.length) {
        ctx.fillStyle = isLightMode ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('No quakes in corridor', w / 2, h / 2);
        return;
    }

    const maxDepth  = Math.max(...csState.data.map(d => d.q.depth), 50);
    const totalDist = csState.totalDist;
    const fg    = isLightMode ? 'rgba(0,0,0,0.55)'   : 'rgba(255,255,255,0.55)';
    const gridC = isLightMode ? 'rgba(0,0,0,0.07)'   : 'rgba(255,255,255,0.07)';

    const palette   = document.getElementById('color-select').value;
    const colorMode = document.getElementById('color-mode').value;
    const { cmin, cmax } = getColorRange(colorMode);

    // Depth tick interval — round to a clean power-of-10 multiple
    const rawInterval = maxDepth / 5;
    const mag      = Math.pow(10, Math.floor(Math.log10(Math.max(rawInterval, 1))));
    const interval = Math.max(1, Math.ceil(rawInterval / mag) * mag);
    const depthTicks = [];
    for (let d = 0; d <= maxDepth + interval * 0.1; d += interval) depthTicks.push(d);

    // Grid + Y labels
    ctx.lineWidth = 1;
    ctx.font = '9px sans-serif';
    ctx.textAlign = 'right';
    for (const d of depthTicks) {
        const y = pad.top + (d / maxDepth) * ch;
        ctx.strokeStyle = gridC;
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + cw, y); ctx.stroke();
        ctx.fillStyle = fg;
        ctx.fillText(d, pad.left - 3, y + 3);
    }

    // Axes
    ctx.strokeStyle = fg;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, pad.top + ch);
    ctx.lineTo(pad.left + cw, pad.top + ch);
    ctx.stroke();

    // X axis labels
    const xTickCount = Math.min(6, Math.floor(totalDist / 300) + 2);
    ctx.textAlign = 'center';
    ctx.fillStyle = fg;
    ctx.font = '9px sans-serif';
    for (let i = 0; i <= xTickCount; i++) {
        const dist = totalDist * i / xTickCount;
        const x    = pad.left + (dist / totalDist) * cw;
        ctx.fillText(Math.round(dist), x, pad.top + ch + 10);
    }
    ctx.font = '8px sans-serif';
    ctx.fillText('distance (km)', pad.left + cw / 2, pad.top + ch + 22);

    // A / B labels
    ctx.font = 'bold 9px sans-serif';
    ctx.fillStyle = 'rgba(255,200,0,0.9)';
    ctx.textAlign = 'left';  ctx.fillText('A', pad.left + 2, pad.top - 3);
    ctx.textAlign = 'right'; ctx.fillText('B', pad.left + cw, pad.top - 3);

    // Quakes — deep first so shallow dots render on top
    const sorted = [...csState.data].sort((a, b) => b.q.depth - a.q.depth);
    for (const { q, alongTrack } of sorted) {
        const x = pad.left + (alongTrack / totalDist) * cw;
        const y = pad.top  + (q.depth    / maxDepth)  * ch;
        const r = Math.max(1.5, q.realMag * 0.7);
        const colorVal = colorMode === 'depth' ? q.depth : colorMode === 'mag' ? q.realMag : q.time;
        const t = cmax > cmin ? (colorVal - cmin) / (cmax - cmin) : 0.5;
        const [cr, cg, cb] = _csColorFromScale(t, palette);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${cr},${cg},${cb},0.9)`;
        ctx.fill();
    }
}

// ---- Globe overlay (called every rAF frame from animateGlobe) ----

function drawCSOverlay() {
    if (csState.phase === 0) return;
    const canvas = document.getElementById('pulse-canvas');
    if (!canvas) return;

    const gd  = getChartDiv();
    const W   = gd.clientWidth;
    const H   = gd.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width  = W * dpr;
        canvas.height = H * dpr;
    }

    const lc  = getLiveCamera();
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Far-side culling: camera→center direction in km
    const cs = EARTH_RADIUS / PLOT_SCALE;
    const ex = (lc.eye.x - lc.center.x) * cs;
    const ey = (lc.eye.y - lc.center.y) * cs;
    const ez = (lc.eye.z - lc.center.z) * cs;

    // Great-circle arc A → B
    if (csState.pointA && csState.pointB) {
        ctx.beginPath();
        let penUp = true;
        for (let i = 0; i <= 64; i++) {
            const pt = _slerp(csState.pointA, csState.pointB, i / 64);
            const [x, y, z] = latLonToXYZ(pt.lat, pt.lon, EARTH_RADIUS + 20);
            if (x*ex + y*ey + z*ez < 0) { penUp = true; continue; }
            const p = _project3D(W, H, lc, x, y, z);
            if (!p) { penUp = true; continue; }
            const sx = (p.ndcX + 1) * 0.5 * W;
            const sy = (1 - p.ndcY) * 0.5 * H;
            if (penUp) { ctx.moveTo(sx, sy); penUp = false; }
            else ctx.lineTo(sx, sy);
        }
        ctx.strokeStyle = 'rgba(255,200,0,0.5)';
        ctx.lineWidth   = 1.5;
        ctx.setLineDash([5, 5]);
        ctx.stroke();
        ctx.setLineDash([]);
    }

    // Marker helper
    const drawMarker = (pt, label) => {
        if (!pt) return;
        const [x, y, z] = latLonToXYZ(pt.lat, pt.lon, EARTH_RADIUS + 20);
        if (x*ex + y*ey + z*ez < 0) return;
        const p = _project3D(W, H, lc, x, y, z);
        if (!p) return;
        const sx = (p.ndcX + 1) * 0.5 * W;
        const sy = (1 - p.ndcY) * 0.5 * H;

        ctx.beginPath();
        ctx.arc(sx, sy, 9, 0, Math.PI * 2);
        ctx.fillStyle   = 'rgba(255,200,0,0.9)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.5)';
        ctx.lineWidth   = 1.5;
        ctx.stroke();

        ctx.fillStyle     = '#000';
        ctx.font          = 'bold 11px sans-serif';
        ctx.textAlign     = 'center';
        ctx.textBaseline  = 'middle';
        ctx.fillText(label, sx, sy);
    };

    drawMarker(csState.pointA, 'A');
    drawMarker(csState.pointB, 'B');

    ctx.restore();
}

// ---- Event listeners ----

document.getElementById('cs-btn').addEventListener('click', () => {
    if (csState.phase === 0) {
        openCrossSection();
    } else if (csState.phase === 3) {
        // Re-select new profile
        csState.phase  = 1;
        csState.pointA = null;
        csState.pointB = null;
        csState.data   = [];
        document.getElementById('cs-focus-btn').style.display = 'none';
        document.getElementById('cs-btn').classList.add('active');
        _csSetStatus('Click point A on the globe');
    } else {
        closeCrossSection();
    }
});

document.getElementById('cs-close').addEventListener('click', closeCrossSection);

// Phases 1 & 2 and phase 3: all handled via capture-phase listeners on chart-container.
// Drags in phases 1/2 pass straight through to Plotly (no synthetic events), so globe
// rotation works naturally. Only clean clicks (≤ 8 px movement) are intercepted to
// place points. Phase 3 intercepts pointerdown on a marker to start dragging it.
const _csChartDiv = document.getElementById('chart-container');
let _csPlaceStartX = 0, _csPlaceStartY = 0;

_csChartDiv.addEventListener('pointerdown', e => {
    if (!e.isPrimary) return; // ignore a second touch finger (pinch/pan owns multi-touch)
    if (csState.phase === 1 || csState.phase === 2) {
        // Record where the press started; let event propagate to Plotly for globe rotation.
        _csPlaceStartX = e.clientX;
        _csPlaceStartY = e.clientY;
        return;
    }

    if (csState.phase !== 3 || !csState.pointA || !csState.pointB) return;
    const gd  = getChartDiv();
    const W   = gd.clientWidth, H = gd.clientHeight;
    const lc  = getLiveCamera();
    const hit = _hitTest(e.clientX, e.clientY, W, H, lc);
    if (!hit) return;

    csState.dragging = hit;
    stopAutoRotate();
    document.getElementById('cs-drag-overlay').style.display = 'block';
    e.stopImmediatePropagation(); // prevent Plotly rotation
}, { capture: true });

// Clean click in phases 1/2: place the point. Drags are ignored (let Plotly finish).
_csChartDiv.addEventListener('pointerup', e => {
    if (!e.isPrimary) return;
    if (csState.phase !== 1 && csState.phase !== 2) return;
    const dx = e.clientX - _csPlaceStartX, dy = e.clientY - _csPlaceStartY;
    if (Math.sqrt(dx*dx + dy*dy) > 8) return; // drag — Plotly already handled it
    e.stopImmediatePropagation(); // prevent quake popup / executeFlyTo
    const gd = getChartDiv();
    const lc = getLiveCamera();
    const pt = _raySphereLatLon(e.clientX, e.clientY, gd.clientWidth, gd.clientHeight, lc);
    if (!pt) return; // missed the globe
    if (csState.phase === 1) {
        csState.pointA = pt;
        csState.phase  = 2;
        _csSetStatus('Now click point B on the globe');
    } else {
        csState.pointB = pt;
        csState.phase  = 3;
        document.getElementById('cs-btn').classList.remove('active');
        computeAndDrawCrossSection();
    }
}, { capture: true });

let _csDragThrottle = 0;
const _csDragOverlay = document.getElementById('cs-drag-overlay');

_csDragOverlay.addEventListener('pointermove', e => {
    if (!e.isPrimary) return;
    if (!csState.dragging) return;
    const gd = getChartDiv();
    const lc = getLiveCamera();
    const pt = _raySphereLatLon(e.clientX, e.clientY, gd.clientWidth, gd.clientHeight, lc);
    if (!pt) return;

    if (csState.dragging === 'A') csState.pointA = pt;
    else                          csState.pointB = pt;

    // Throttle the heavy profile recomputation; the overlay is redrawn every rAF anyway.
    const now = performance.now();
    if (now - _csDragThrottle > 80) {
        _csDragThrottle = now;
        computeAndDrawCrossSection();
    }
});

_csDragOverlay.addEventListener('pointerup', e => {
    if (!e.isPrimary) return;
    if (!csState.dragging) return;
    csState.dragging = null;
    document.getElementById('cs-drag-overlay').style.display = 'none';
    computeAndDrawCrossSection(); // final update
});

document.getElementById('cs-focus-btn').addEventListener('click', () => {
    if (!csState.pointA || !csState.pointB) return;
    const mid = _slerp(csState.pointA, csState.pointB, 0.5);

    const toVec = ({ lat, lon }) => {
        const φ = lat * Math.PI / 180, λ = lon * Math.PI / 180;
        return [Math.cos(φ)*Math.cos(λ), Math.cos(φ)*Math.sin(λ), Math.sin(φ)];
    };
    const vA = toVec(csState.pointA), vB = toVec(csState.pointB);

    // Pole of the great circle A-B.  Setting camera up = pole makes the A-B
    // arc horizontal on screen (arc tangent = pole × eyeDir = rightward).
    let px = vA[1]*vB[2] - vA[2]*vB[1];
    let py = vA[2]*vB[0] - vA[0]*vB[2];
    let pz = vA[0]*vB[1] - vA[1]*vB[0];
    const plen = Math.sqrt(px*px + py*py + pz*pz);
    if (plen < 1e-10) return; // degenerate — A === B
    px /= plen; py /= plen; pz /= plen;

    const latRad = mid.lat * Math.PI / 180;
    const lonRad = mid.lon * Math.PI / 180;
    const nx = Math.cos(latRad) * Math.cos(lonRad);
    const ny = Math.cos(latRad) * Math.sin(lonRad);
    const nz = Math.sin(latRad);

    // Fit A and B to 80% of horizontal screen width.
    // ndcX = (focal/aspect) * x_cam / depth → solve for eye dist.
    const θ      = _gcDistRad(csState.pointA.lat, csState.pointA.lon, csState.pointB.lat, csState.pointB.lon);
    const focal  = 1.0 / Math.tan(Math.PI / 8);
    const gd     = getChartDiv();
    const aspect = gd.clientWidth / gd.clientHeight;
    const rawDist = PLOT_SCALE * (Math.cos(θ / 2) + focal * Math.sin(θ / 2) / (0.8 * aspect));
    const dist   = Math.max(0.85, Math.min(3.5, rawDist));

    const [tx, ty, tz] = latLonToXYZ(mid.lat, mid.lon, EARTH_RADIUS);
    const center = {
        x: (tx / EARTH_RADIUS) * PLOT_SCALE,
        y: (ty / EARTH_RADIUS) * PLOT_SCALE,
        z: (tz / EARTH_RADIUS) * PLOT_SCALE
    };

    const cam = {
        eye:    { x: nx * dist, y: ny * dist, z: nz * dist },
        center,
        up:     { x: px, y: py, z: pz }
    };
    currentCamera = cam;
    Plotly.relayout('chart-container', { 'scene.camera': cam });
    stopAutoRotate();
});

// Redraw the profile chart when the palette or colour mode changes.
['color-select', 'color-mode'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
        if (csState.phase === 3 && csState.data.length) drawCrossSection();
    });
});
