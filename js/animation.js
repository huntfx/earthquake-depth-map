// Initialise the pulse animation for a clicked earthquake.
function triggerPulse(q) {
    if (!q || q.type === 'volcano') return;
    // Exponential scale: roughly M4=140km, M5=280km, M7=1000km, M9=4000km
    const animMaxRadius = Math.max(500, Math.exp(q.realMag / 1.5) * 20);
    pulseState = {
        startTime: performance.now(),
        lat: q.lat,
        lon: q.lon,
        maxRadius: animMaxRadius
    };
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

function tickTimeLapse() {
    const now = performance.now();

    tlState.currentTime += tlState.speed / 60;

    if (tlState.currentTime >= tlState.endTime) {
        tlState.currentTime = tlState.startTime;
        tlState.lastSoundTime = tlState.startTime;
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

    if (now - tlState.lastDrawTime > tlState.drawInterval) {
        updateTimeLapseFrame();
        tlState.lastDrawTime = now;
    }
}

function animateGlobe() {
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

    // Handle Active Pulse Animation
    if (pulseState) {
        const now = performance.now();
        // Physics Speed: km per second
        const speed = 300; // Reduced to 300 as requested

        // Elapsed time in seconds
        const elapsedSeconds = (now - pulseState.startTime) / 1000;

        // Current radius in km
        const currentRadius = elapsedSeconds * speed;

        // Calculate progress (0 to 1)
        const progress = currentRadius / pulseState.maxRadius;

        if (progress < 1) {
            // Generate circle
            const circle = getCirclePoints(pulseState.lat, pulseState.lon, currentRadius);

            // Fade out
            // Use a slightly gentler fade so it stays visible longer
            const opacity = 1 - Math.pow(progress, 1.5);
            // Fade the width too (Simulates thinning/dissipating wave)
            const width = 5 * opacity;

            // RGBA Color String for proper opacity handling
            const colorString = `rgba(255, 255, 255, ${opacity.toFixed(2)})`;

            Plotly.restyle('chart-container', {
                'x': [circle.x],
                'y': [circle.y],
                'z': [circle.z],
                'line.color': colorString,
                'line.width': [width],
                'visible': true
            }, [10]);
        } else {
            // Animation Complete - Ensure it's fully transparent/hidden
            Plotly.restyle('chart-container', {'visible': false}, [10]);
            pulseState = null;
        }
    }

    if (tlState.active && tlState.playing) {
        tickTimeLapse();
        drawMagChart();
    }

    requestAnimationFrame(animateGlobe);
}
