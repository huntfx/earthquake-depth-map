// --- Constants ---
const EARTH_RADIUS = 6371;
const USGS_BASE_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=magnitude";
const NOTABLE_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query?format=geojson&orderby=magnitude&minmagnitude=7.5&minsig=800&limit=100&starttime=1900-01-01";
const BORDERS_URL = "https://raw.githubusercontent.com/johan/world.geo.json/master/countries.geo.json";
const PLATES_URL = "https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json";
const VOLCANOES_URL = "https://raw.githubusercontent.com/plotly/datasets/master/volcano_db.csv";

// --- Configuration Constants ---
// These are the single source of truth for widths. Change them here to update everywhere.
const BASE_BORDER_WIDTH = 3;
const BASE_PLATE_WIDTH = 4;

const ROTATION_SPEED = -0.001;

// --- State ---
let rawQuakeData = [];
let rawVolcanoData = [];
let rawNotableData = [];
let stats = { maxMag: 0, maxDepth: 0, minTime: 0, maxTime: 0, avgMag: 0 };

let pulseState = null; // Stores pulse animation state
let selectedQuake = null; // Current selected object for simulation

let staticBorderArrays = { x: [], y: [], z: [] };
let staticLabelArrays = { x: [], y: [], z: [], text: [] };
let staticPlateArrays = { x: [], y: [], z: [] };
let staticGridArrays = { x: [], y: [], z: [] };

// Seismic Bookmarks Config - Display Names
const seismicBookmarks = {
    "Ring of Fire (Pacific)": { lat: 0, lon: 180, zoom: 2.2 },
    "Japan Trench": { lat: 36, lon: 138, zoom: 1.2 },
    "Indonesia / Philippines": { lat: 5, lon: 120, zoom: 1.3 },
    "San Andreas Fault": { lat: 35, lon: -120, zoom: 1.2 },
    "Andes (South America)": { lat: -20, lon: -70, zoom: 1.2 },
    "Himalayas (Collision Zone)": { lat: 30, lon: 85, zoom: 1.2 },
    "Mid-Atlantic Ridge": { lat: 0, lon: -30, zoom: 1.8 }
};

// Single Source of Truth for Camera
let currentCamera = {
    eye: {x: 1.5, y: 1.5, z: 1.5},
    center: {x: 0, y: 0, z: 0},
    up: {x: 0, y: 0, z: 1}
};

let autoRotate = true;
let isLightMode = false;
let rotationTimeout = null;
let _globePointerDown = false;  // true while pointer is held on the globe
let _tlPausedForDrag  = false;  // true if we paused the timelapse due to a drag

// --- Time Lapse State ---
let tlState = {
    active: false,
    playing: false,
    currentTime: 0,
    startTime: 0,
    endTime: 0,
    speed: 86400000, // ms per tick (default 1 day)
    windowSize: 345600000, // ms (default 4 days)
    popEnabled: true, // Default to true
    soundEnabled: false,
    lastSoundTime: 0,
    sortedData: [],
    lastDrawTime: 0,
    drawInterval: 25, // ms (10 FPS limit for visual chart updates)
    animationFrameId: null
};
