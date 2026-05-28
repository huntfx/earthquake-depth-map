
let _pulseNow         = performance.now();
let _pulseWasFrozen   = false;
let _pulseFreezeStart = 0;

// Recreate pulses that would be in-flight at the current scrub position.
// sortedData is ascending by time; iterate forward so older (larger-radius)
// pulses are included alongside newer ones. The radius < maxRadius check is
// the natural cap — no arbitrary count limit needed.
function restoreActivePulses() {
    pulseStates = [];
    if (!wavesEnabled || !tlState.sortedData || !tlState.sortedData.length) return;

    const T              = tlState.currentTime;
    const realMsPerSimMs = 1000 / tlState.speed;
    const now            = performance.now();
    const speed          = tlState.waveSpeed > 0 ? tlState.waveSpeed : LIVE_WAVE_SPEED * tlState.speed / 1000;

    const maxPossibleRadius = Math.max(500, Math.exp(stats.maxMag / 1.5) * 20);
    const pulseWindowStart  = T - (maxPossibleRadius / speed) * 1000 / realMsPerSimMs;

    for (const q of tlState.sortedData) {
        if (q.time > T) break;
        if (q.time <= pulseWindowStart) continue;
        const maxRadius = Math.max(500, Math.exp(q.realMag / 1.5) * 20);
        const realAge   = (T - q.time) * realMsPerSimMs;
        const radius    = (realAge / 1000) * speed;
        if (radius < maxRadius) {
            pulseStates.push({ startTime: now - realAge, lat: q.lat, lon: q.lon, maxRadius, mag: q.realMag, speed });
        }
    }

    // Reset freeze tracking: the freshly-restored startTimes are relative to `now`,
    // so the pause-compensation in animateGlobe must not offset them on next play.
    _pulseNow         = now;
    _pulseWasFrozen   = false;
    _pulseFreezeStart = 0;
}

// Initialise the pulse animation for a clicked earthquake.
function triggerPulse(q) {
    if (!q || q.type === 'volcano') return;
    const speed     = tlState.waveSpeed > 0 ? tlState.waveSpeed : LIVE_WAVE_SPEED * tlState.speed / 1000;
    const maxRadius = Math.max(500, Math.exp(q.realMag / 1.5) * 20);
    pulseStates.push({ startTime: performance.now(), lat: q.lat, lon: q.lon, maxRadius, mag: q.realMag, speed });
}

// Helper function to generate circle points on sphere
function getCirclePoints(lat, lon, radiusKm) {
    const points = { x: [], y: [], z: [] };
    const angularDistance = radiusKm / EARTH_RADIUS; // radians

    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;

    const sinLat = Math.sin(latRad);
    const cosLat = Math.cos(latRad);

    // Generate 64 points for the circle
    for (let i = 0; i <= 64; i++) {
        const bearing = (i / 64) * 2 * Math.PI;
        const sinBearing = Math.sin(bearing);
        const cosBearing = Math.cos(bearing);

        const sinLat2 = sinLat * Math.cos(angularDistance) + cosLat * Math.sin(angularDistance) * cosBearing;
        const lat2 = Math.asin(sinLat2);

        const y = sinBearing * Math.sin(angularDistance) * cosLat;
        const x = Math.cos(angularDistance) - sinLat * sinLat2;
        const lon2 = lonRad + Math.atan2(y, x);

        // Convert back to Cartesian
        // Using EARTH_RADIUS + small offset to prevent z-fighting
        const R = EARTH_RADIUS + 20; // Increased to 20 to prevent z-fighting
        points.x.push(R * Math.cos(lat2) * Math.cos(lon2));
        points.y.push(R * Math.cos(lat2) * Math.sin(lon2));
        points.z.push(R * Math.sin(lat2));
    }

    return points;
}

// Project a raw data point (km) to NDC [-1,1] using the live camera state.
// Builds view + perspective from getLiveCamera() so no Plotly internals needed.
// Returns {ndcX, ndcY} or null if behind the camera.
function _project3D(W, H, lc, x, y, z) {
    // Point relative to camera eye, in scene units.
    const s  = PLOT_SCALE / EARTH_RADIUS;
    const px = x * s - lc.eye.x;
    const py = y * s - lc.eye.y;
    const pz = z * s - lc.eye.z;

    // Forward direction f = normalize(center - eye).
    let fx = lc.center.x - lc.eye.x;
    let fy = lc.center.y - lc.eye.y;
    let fz = lc.center.z - lc.eye.z;
    const flen = Math.sqrt(fx*fx + fy*fy + fz*fz);
    fx /= flen; fy /= flen; fz /= flen;

    const depth = fx*px + fy*py + fz*pz; // positive = in front of camera
    if (depth <= 0) return null;

    // Camera right r = normalize(f × up).
    const ux = lc.up.x, uy = lc.up.y, uz = lc.up.z;
    let rx = fy*uz - fz*uy;
    let ry = fz*ux - fx*uz;
    let rz = fx*uy - fy*ux;
    const rlen = Math.sqrt(rx*rx + ry*ry + rz*rz);
    rx /= rlen; ry /= rlen; rz /= rlen;

    // Camera up u = r × f.
    const upx = ry*fz - rz*fy;
    const upy = rz*fx - rx*fz;
    const upz = rx*fy - ry*fx;

    // Project onto camera plane.
    const cam_x = rx*px  + ry*py  + rz*pz;
    const cam_y = upx*px + upy*py + upz*pz;

    // Perspective — gl-plot3d default fovY = π/4.
    const focal  = 1.0 / Math.tan(Math.PI / 8); // 1/tan(22.5°) ≈ 2.414
    const aspect = W / H;

    return {
        ndcX: (focal / aspect) * cam_x / depth,
        ndcY: focal * cam_y / depth
    };
}


// Draw all active pulse waves onto the canvas overlay.
function drawPulses() {
    const canvas = document.getElementById('pulse-canvas');
    if (!canvas) return;
    if (!wavesEnabled || pulseStates.length === 0) {
        canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        return;
    }

    const gd  = getChartDiv();
    if (!gd._fullLayout) return;

    const W   = gd.clientWidth;
    const H   = gd.clientHeight;
    const dpr = window.devicePixelRatio || 1;

    if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
        canvas.width  = W * dpr;
        canvas.height = H * dpr;
    }

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const now = _pulseNow;

    // Camera state for projection and far-side culling.
    const lc = getLiveCamera();
    const cs = EARTH_RADIUS / PLOT_SCALE;
    const ex = (lc.eye.x - lc.center.x) * cs;
    const ey = (lc.eye.y - lc.center.y) * cs;
    const ez = (lc.eye.z - lc.center.z) * cs;

    pulseStates = pulseStates.filter(pulse => {
        const elapsed  = (now - pulse.startTime) / 1000;
        if (elapsed < 0) return true; // not yet fired — keep pending
        if (pulse.live && !pulse.fired) {
            console.log(`[live] Wave fired: M${pulse.mag.toFixed(1)} lat=${pulse.lat.toFixed(3)} lon=${pulse.lon.toFixed(3)}`);
            pulse.fired = true;
        }
        const radius   = elapsed * pulse.speed;
        const progress = radius / pulse.maxRadius;
        if (progress >= 1) return false;

        const opacity = 0.9 * (1 - Math.pow(progress, 1.5));

        const [r, g, b] = isLightMode ? [50, 50, 50] : [255, 255, 255];

        const pts = getCirclePoints(pulse.lat, pulse.lon, radius);
        ctx.beginPath();
        let penUp = true;
        for (let i = 0; i < pts.x.length; i++) {
            if (pts.x[i] * ex + pts.y[i] * ey + pts.z[i] * ez < 0) { penUp = true; continue; }
            const p = _project3D(W, H, lc, pts.x[i], pts.y[i], pts.z[i]);
            if (!p) { penUp = true; continue; }
            const cx = (p.ndcX + 1) * 0.5 * W;
            const cy = (1 - p.ndcY) * 0.5 * H;
            if (penUp) { ctx.moveTo(cx, cy); penUp = false; }
            else ctx.lineTo(cx, cy);
        }
        ctx.strokeStyle = `rgba(${r},${g},${b},${opacity.toFixed(2)})`;
        ctx.lineWidth   = Math.max(0.5, pulse.mag * 0.3);
        ctx.stroke();
        return true;
    });
}

function tickTimeLapse() {
    const now = performance.now();

    tlState.currentTime += tlState.speed / 60;

    if (tlState.currentTime >= tlState.endTime) {
        tlState.currentTime = tlState.startTime;
        tlState.lastSoundTime = tlState.startTime;
        tlState.lastPulseTime = tlState.startTime;
    }

    document.getElementById('tl-date-display').innerText =
        new Date(tlState.currentTime).toISOString().slice(0, 16).replace('T', ' ');
    document.getElementById('tl-scrubber').value =
        ((tlState.currentTime - tlState.startTime) / (tlState.endTime - tlState.startTime)) * 100;

    if (tlState.soundEnabled) {
        let checkTime = tlState.lastSoundTime;
        if (tlState.currentTime < tlState.lastSoundTime) {
            checkTime = tlState.startTime - 1000;
            tlState.lastSoundTime = checkTime;
        }

        const newQuakes = tlState.sortedData.filter(q =>
            q.time > checkTime && q.time <= tlState.currentTime
        );

        if (newQuakes.length > 0) {
            newQuakes.sort((a, b) => b.realMag - a.realMag);
            const simDuration = tlState.currentTime - checkTime;
            let delay = 0;
            if (simDuration > 0) {
                const quakeOffset = newQuakes[0].time - checkTime;
                delay = (quakeOffset / simDuration) * (1 / 60);
            }
            playQuakeSound(newQuakes[0], delay);
        }

        tlState.lastSoundTime = tlState.currentTime;
    }

    {
        let checkTime = tlState.lastPulseTime;
        if (tlState.currentTime < checkTime) checkTime = tlState.startTime - 1000;
        if (wavesEnabled) {
            tlState.sortedData
                .filter(q => q.time > checkTime && q.time <= tlState.currentTime)
                .forEach(q => triggerPulse(q));
        }
        tlState.lastPulseTime = tlState.currentTime;
    }

    if (now - tlState.lastDrawTime > tlState.drawInterval) {
        updateTimeLapseFrame();
        tlState.lastDrawTime = now;
    }
}

function animateGlobe() {
    const _freezePulse = tlState.active && !tlState.playing;
    if (!_freezePulse) {
        if (_pulseWasFrozen) {
            const pauseMs = performance.now() - _pulseFreezeStart;
            pulseStates.forEach(p => { p.startTime += pauseMs; });
            _pulseWasFrozen = false;
        }
        _pulseNow = performance.now();
    } else if (!_pulseWasFrozen) {
        _pulseFreezeStart = performance.now();
        _pulseWasFrozen = true;
    }

    const graphDiv = document.getElementById('chart-container');
    const scene = graphDiv._fullLayout ? graphDiv._fullLayout.scene : null;

    // Handle Camera Rotation
    if (scene && scene.camera && autoRotate) {
        const cos = Math.cos(ROTATION_SPEED);
        const sin = Math.sin(ROTATION_SPEED);

        const currentEye = currentCamera.eye;
        let currentCenter = currentCamera.center;
        if (!currentCenter || typeof currentCenter.x === 'undefined') {
            currentCenter = {x: 0, y: 0, z: 0};
        }

        const dx = currentEye.x - currentCenter.x;
        const dy = currentEye.y - currentCenter.y;

        const newDx = dx * cos - dy * sin;
        const newDy = dx * sin + dy * cos;

        const newEye = {
            x: currentCenter.x + newDx,
            y: currentCenter.y + newDy,
            z: currentEye.z
        };

        currentCamera.eye = newEye;

        // Send the full camera object so _fullLayout.scene.camera stays in sync.
        // A partial 'scene.camera.eye' key bypasses the plotly_relayout handler's
        // Case 1 path and leaves Plotly's stored camera stale, causing a 1-frame
        // snap whenever the next action reads it.
        Plotly.relayout('chart-container', {
            'scene.camera': { eye: newEye, center: currentCenter, up: currentCamera.up }
        });
    }

    drawPulses();

    if (tlState.active && tlState.playing) {
        tickTimeLapse();
        drawMagChart();
    }

    requestAnimationFrame(animateGlobe);
}
