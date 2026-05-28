const LIVE_FEED_URL   = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_hour.geojson';
const LIVE_WAVE_SPEED = 6;                         // km/s — seismic P-wave
const LIVE_MAX_RADIUS = Math.PI * EARTH_RADIUS;    // ~20,015 km — wave dies at antipode

async function startLive() {
    if (liveState.active) return;
    liveState.active = true;
    await seedLive();
    liveState.pollInterval = setInterval(pollLive, 60000);
}

function stopLive() {
    liveState.active = false;
    clearInterval(liveState.pollInterval);
    liveState.pollInterval = null;
    pulseStates = pulseStates.filter(p => !p.live);
}

// On first activation: record all existing event IDs and emit in-flight waves
// for any quakes whose wave hasn't yet reached the antipode.
async function seedLive() {
    const data = await fetchLiveFeed();
    if (!data) return;

    liveState.knownIds.clear();
    liveState.lastPollTime = Date.now();

    if (!data.features.length) return;

    const perfNow = performance.now();
    const realNow = Date.now();

    for (const feature of data.features) {
        liveState.knownIds.add(feature.id);
        const elapsedMs = realNow - feature.properties.time;
        if (elapsedMs < 0) continue;
        const [lon, lat] = feature.geometry.coordinates;
        const mag       = feature.properties.mag || 2.5;
        const maxRadius = Math.max(500, Math.exp(mag / 1.5) * 20);
        if ((elapsedMs / 1000) * LIVE_WAVE_SPEED >= maxRadius) continue;
        pulseStates.push({ startTime: perfNow - elapsedMs, lat, lon, maxRadius, mag, speed: LIVE_WAVE_SPEED, live: true });
    }
}

async function pollLive() {
    const data = await fetchLiveFeed();
    if (!data) return;

    liveState.lastPollTime = Date.now();

    for (const feature of data.features) {
        if (!liveState.knownIds.has(feature.id)) {
            liveState.knownIds.add(feature.id);
            const [lon, lat] = feature.geometry.coordinates;
            const mag = feature.properties.mag || 2.5;
            _triggerLivePulse(lat, lon, mag);
        }
    }
}

function _triggerLivePulse(lat, lon, mag, startTime = performance.now()) {
    const maxRadius = Math.max(500, Math.exp(mag / 1.5) * 20);
    pulseStates.push({ startTime, lat, lon, maxRadius, mag, speed: LIVE_WAVE_SPEED, live: true });
}

async function fetchLiveFeed() {
    try {
        const res = await fetch(LIVE_FEED_URL);
        return await res.json();
    } catch (e) {
        console.error('[live] feed fetch failed', e);
        return null;
    }
}


