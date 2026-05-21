# Earthquake Depth Map — Claude Context

## Project overview
A single-page 3D earthquake visualisation. No build step, no package manager. Open `index.html` directly in a browser. Deployed at earthquakes.peterhunt.uk via the `CNAME` file.

## File layout
```
index.html          HTML shell only — no logic
styles.css          All CSS
js/
  state.js          Global constants (EARTH_RADIUS, URLs, widths) and all mutable state
  audio.js          Web Audio synthesis
  mapdata.js        latLonToXYZ + GeoJSON/CSV processing for borders, plates, volcanoes, grid
  helpers.js        calculateScaledSizes, showError, setDefaultDates, applyPreset, updateLabels
  camera.js         searchLocation/Volcano/Zone, calculateResponsiveCamera, save/restoreRenderCamera
  render.js         RenderSession (crash-resume), renderFrames, resumeRender
  timelapse.js      startTimeLapse, stopTimeLapse, updateTimeLapseFrame + timelapse event listeners
  plot.js           fetchDataAndPlot, updatePlot (builds all 11 Plotly traces)
  animation.js      animateGlobe (rAF loop), getCirclePoints (pulse wave)
  app.js            initApp, initResumeCheck, all remaining UI event listeners
```

Scripts are loaded as plain `<script>` tags in dependency order — **not ES modules**. All functions and state are global. This is intentional to avoid breaking cross-file references.

## Trace index (Plotly)
`updatePlot` builds traces in this fixed order — several files reference traces by index number:
```
0  gridTrace        lat/lon wireframe
1  coreTrace        occlusion billboard at earth centre
2  borderTrace      country borders
3  plateTrace       tectonic plates
4  labelTrace       country name text
5  volcanoTrace     volcano markers
6  surfaceLineTrace depth lines (earthquakes)
7  volcanoLineTrace depth lines (volcanoes)
8  quakeTrace       earthquake markers (main data trace)
9  ghostTrace       invisible oversized markers for hover hit area
10 pulseTrace       seismic wave ring animation
```

## Critical: camera logic is brittle
The camera/rotation system (`searchLocation`, `searchVolcano`, `searchZone`, GPS handler, `animateGlobe` rotation, `plotly_relayout` tracking, and `executeFlyTo` inside `initApp`) is known to be fragile. It works correctly but has broken repeatedly when modified, even when changes seemed unrelated. **Do not refactor camera logic without explicit instruction.** If asked to refactor it, treat it as a dedicated task.

## Known quirks
- `render-btn` has two event listeners (one in `render.js` at top level, one inside `initApp` in `app.js`). This is preserved from the original code — do not deduplicate without checking behaviour.
- `stopRotation` is a closure defined inside `initApp` — intentional, it's only used within that scope.
- `saveRenderCamera` / `restoreRenderCamera` in `camera.js` are not wired to any UI button — they're debug utilities.
- `RENDER_SESSION_KEY` in `state.js` is defined but not currently used.

## Stack
- [Plotly.js 2.27.0](https://cdn.plot.ly/plotly-2.27.0.min.js) — loaded from CDN, available as global `Plotly`
- USGS Earthquake API for live data
- Web Audio API for seismic sound synthesis
- File System Access API for frame export (Chromium only)
