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
  camera.js         PLOT_SCALE constant, stopAutoRotate, currentEyeDist, cameraGoTo, searchLocation/Volcano/Zone, calculateResponsiveCamera
  render.js         RenderSession (crash-resume), renderFrames, resumeRender
  timelapse.js      startTimeLapse, stopTimeLapse, updateTimeLapseFrame + timelapse event listeners
  plot.js           fetchDataAndPlot, updatePlot (builds all 11 Plotly traces)
  animation.js      triggerPulse, animateGlobe (rAF loop), getCirclePoints (pulse wave)
  app.js            executeFlyTo (top-level), initApp, initResumeCheck, all remaining UI event listeners
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
The camera/rotation system (`searchLocation`, `searchVolcano`, `searchZone`, GPS handler, `animateGlobe` rotation, `plotly_relayout` tracking, and `executeFlyTo`) is known to be fragile. It works correctly but has broken repeatedly when modified, even when changes seemed unrelated. **Do not refactor camera logic without explicit instruction.** If asked to refactor it, treat it as a dedicated task.

### Camera state rules (learned from debugging)
- **`currentCamera` is the authoritative camera state.** It is a plain JS object maintained by the `plotly_relayout` event handler in `app.js`. Always read from it, never from Plotly internals.
- **Do not read from `_fullLayout.scene.camera` for live state.** Plotly only updates `_fullLayout.scene.camera` on programmatic `Plotly.relayout`/`Plotly.react` calls — it is NOT updated when the user manually orbits or zooms the scene. Reading it will silently return a stale camera, causing jumps.
- **Always send a full camera object to `Plotly.relayout`.** Passing a partial key like `'scene.camera.eye'` (instead of `'scene.camera'`) bypasses the `plotly_relayout` handler's Case 1 path and leaves `_fullLayout.scene.camera` stale. The animation loop (`animateGlobe`) does this correctly — don't change it back to a partial key.
- **`executeFlyTo` and `cameraGoTo` have different behaviours** — `cameraGoTo` reorients the globe to face the location; `executeFlyTo` only shifts the center (look-at point) while keeping eye fixed. They must remain separate.

## Known quirks
- `render.js` crash-resume exists because the renderer has a memory leak on long runs — the session system lets the user restart mid-sequence without losing progress. Keep this in mind before simplifying it.
- The timelapse system (`timelapse.js`) does not touch auto-rotation state — it runs alongside whatever the globe is already doing.

## Stack
- [Plotly.js 2.27.0](https://cdn.plot.ly/plotly-2.27.0.min.js) — loaded from CDN, available as global `Plotly`
- USGS Earthquake API for live data
- Web Audio API for seismic sound synthesis
- File System Access API for frame export (Chromium only)
