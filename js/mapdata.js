function latLonToXYZ(lat, lon, radius) {
    const latRad = lat * Math.PI / 180;
    const lonRad = lon * Math.PI / 180;
    const x = radius * Math.cos(latRad) * Math.cos(lonRad);
    const y = radius * Math.cos(latRad) * Math.sin(lonRad);
    const z = radius * Math.sin(latRad);
    return [x, y, z];
}

function processBorders(geojson) {
    const bx = [], by = [], bz = [];
    const lx = [], ly = [], lz = [], lt = [];

    geojson.features.forEach(feature => {
        const geometry = feature.geometry;
        if (!geometry) return;

        const name = feature.properties ? feature.properties.name : null;
        const type = geometry.type;

        const candidates = [];

        const processRing = (ring) => {
            let rMinLat = 90, rMaxLat = -90, rMinLon = 180, rMaxLon = -180;
            let count = 0;

            ring.forEach(pt => {
                const lon = pt[0];
                const lat = pt[1];

                const [x, y, z] = latLonToXYZ(lat, lon, EARTH_RADIUS);
                bx.push(x); by.push(y); bz.push(z);

                if (lat < rMinLat) rMinLat = lat;
                if (lat > rMaxLat) rMaxLat = lat;
                if (lon < rMinLon) rMinLon = lon;
                if (lon > rMaxLon) rMaxLon = lon;
                count++;
            });
            bx.push(null); by.push(null); bz.push(null);

            if (count === 0) return null;

            const latSpan = rMaxLat - rMinLat;
            const lonSpan = rMaxLon - rMinLon;
            const area = latSpan * lonSpan;

            return {
                lat: (rMinLat + rMaxLat) / 2,
                lon: (rMinLon + rMaxLon) / 2,
                area: area
            };
        };

        if (type === 'Polygon') {
            const ring = geometry.coordinates[0];
            const data = processRing(ring);
            if (data) candidates.push(data);
        } else if (type === 'MultiPolygon') {
            geometry.coordinates.forEach(poly => {
                const ring = poly[0];
                const data = processRing(ring);
                if (data) candidates.push(data);
            });
        }

        if (name && candidates.length > 0) {
            candidates.sort((a, b) => b.area - a.area);
            const largest = candidates[0];
            const [cx, cy, cz] = latLonToXYZ(largest.lat, largest.lon, EARTH_RADIUS * 1.01);
            lx.push(cx); ly.push(cy); lz.push(cz);
            lt.push(name);
        }
    });

    return {
        borders: { x: bx, y: by, z: bz },
        labels: { x: lx, y: ly, z: lz, text: lt }
    };
}

function processPlates(geojson) {
    const px = [], py = [], pz = [];
    geojson.features.forEach(feature => {
        const geometry = feature.geometry;
        const type = geometry.type;
        let lines = [];

        if (type === 'LineString') {
            lines = [geometry.coordinates];
        } else if (type === 'MultiLineString') {
            lines = geometry.coordinates;
        }

        lines.forEach(line => {
            line.forEach(pt => {
                const [x, y, z] = latLonToXYZ(pt[1], pt[0], EARTH_RADIUS + 2);
                px.push(x); py.push(y); pz.push(z);
            });
            px.push(null); py.push(null); pz.push(null);
        });
    });
    return { x: px, y: py, z: pz };
}

function processVolcanoes(csvText) {
    const data = [];
    const lines = csvText.split('\n');
    // Header is: Number,Volcano Name,Country,Region,Latitude,Longitude,Elevation (m),Type,Status,Last Known Eruption
    // We start at index 1 to skip header
    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        // Simple CSV split (handling simple commas)
        // Note: This specific dataset has simple fields usually, but regex is safer for quoted fields
        const cols = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);

        if (cols.length < 7) continue;

        // Remove quotes if present
        const clean = (str) => str ? str.replace(/^"|"$/g, '') : '';

        const name = clean(cols[1]);
        const lat = parseFloat(cols[4]);
        const lon = parseFloat(cols[5]);
        // Parse Elev as float
        let elev = parseFloat(clean(cols[6]));
        if(isNaN(elev)) elev = 0;

        const type = clean(cols[7]);
        const status = clean(cols[8]);

        if (isNaN(lat) || isNaN(lon)) continue;

        data.push({ name, lat, lon, elev, type, status });
    }
    return data;
}

function generateWireframeGrid() {
    const gx = [], gy = [], gz = [];
    for (let lat = -90; lat <= 90; lat += 15) {
        for (let lon = -180; lon <= 180; lon += 5) {
            const [x, y, z] = latLonToXYZ(lat, lon, EARTH_RADIUS);
            gx.push(x); gy.push(y); gz.push(z);
        }
        gx.push(null); gy.push(null); gz.push(null);
    }
    for (let lon = -180; lon <= 180; lon += 30) {
        for (let lat = -90; lat <= 90; lat += 5) {
            const [x, y, z] = latLonToXYZ(lat, lon, EARTH_RADIUS);
            gx.push(x); gy.push(y); gz.push(z);
        }
        gx.push(null); gy.push(null); gz.push(null);
    }
    return { x: gx, y: gy, z: gz };
}
