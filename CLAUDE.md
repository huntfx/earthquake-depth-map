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
  plot.js           fetchDataAndPlot, updatePlot (builds all 10 Plotly traces), updateStaticTracesForTimelapse
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
```
Pulse/shockwave animation is a separate canvas overlay (`#pulse-canvas`), not a Plotly trace. It is drawn by `drawPulses()` in `animation.js` every rAF frame using a manual perspective projection from `getLiveCamera()`.

## Critical: camera logic is brittle
The camera/rotation system (`searchLocation`, `searchVolcano`, `searchZone`, GPS handler, `animateGlobe` rotation, `plotly_relayout` tracking, and `executeFlyTo`) is known to be fragile. It works correctly but has broken repeatedly when modified, even when changes seemed unrelated. **Do not refactor camera logic without explicit instruction.** If asked to refactor it, treat it as a dedicated task.

### Camera state rules (learned from debugging)
- **`currentCamera` is the authoritative camera state.** It is a plain JS object maintained by the `plotly_relayout` event handler in `app.js`. Always read from it, never from Plotly internals.
- **Do not read from `_fullLayout.scene.camera` for live state.** Plotly only updates `_fullLayout.scene.camera` on programmatic `Plotly.relayout`/`Plotly.react` calls — it is NOT updated when the user manually orbits or zooms the scene. Reading it will silently return a stale camera, causing jumps.
- **Always send a full camera object to `Plotly.relayout`.** Passing a partial key like `'scene.camera.eye'` (instead of `'scene.camera'`) bypasses the `plotly_relayout` handler's Case 1 path and leaves `_fullLayout.scene.camera` stale. The animation loop (`animateGlobe`) does this correctly — don't change it back to a partial key.
- **`executeFlyTo` and `cameraGoTo` have different behaviours** — `cameraGoTo` reorients the globe to face the location; `executeFlyTo` only shifts the center (look-at point) while keeping eye fixed. They must remain separate.

### Plotly 2.27.0 camera internals (verified by debugging)
- **`gd._fullLayout.scene.setCamera` does not exist** in Plotly 2.27.0. Neither does `gd._fullLayout.scene._scene.setCamera`. Do not try to patch or call `setCamera` — it will silently fail.
- **The actual camera-move primitive is `gd._fullLayout.scene._scene.glplot.camera.lookAt(eye, center, up)`** — this is what Plotly calls internally to re-apply `_fullLayout.scene.camera` after every `Plotly.restyle()`, causing the camera snap.
- **`gd._fullLayout.scene._scene`** is the gl-plot3d inner scene (no Plotly wrapper methods). **`gd._fullLayout.scene._scene.glplot.camera`** is the camera-3d instance with `lookAt`, `rotate`, `translate`, etc.
- **`gd._fullLayout.scene._scene.getCamera()`** exists in Plotly 2.27.0 and returns the live WebGL camera position during drag. `getLiveCamera()` uses this as its primary path and falls back to `currentCamera` if unavailable. This is only useful for rendering (pulse projection, frame capture) — do not use it for inertia detection, as it is unreliable once the user releases.
- **`gd._fullLayout.scene._scene.glplot.camera.params`** is stale — it is only updated when `lookAt` is called programmatically, not during interactive orbit. It was removed from `getLiveCamera()` for this reason.

### Timelapse camera snap — how it works and how it is fixed
- **Root cause:** Every `Plotly.restyle()` call triggers an internal `glplot.camera.lookAt(_fullLayout.scene.camera)`. After a drag + inertia, `_fullLayout.scene.camera` holds the drag-release position, so the first restyle after timelapse resumes snaps the camera back to that stale position.
- **Fix (in `app.js`):** `_applySetCameraGuard()` patches `glplot.camera.lookAt` with a guard that checks the module-level flag `_tlRestyling`. When `_tlRestyling = true` (set in `updateTimeLapseFrame` around every `Plotly.restyle` call), `lookAt` is a no-op — the camera cannot be moved by a restyle. The guard is applied on `startTimeLapse()` and re-applied on every `pointerdown` in case the camera object was recreated.
- **`_tlRestyling`** is the flag (declared in `app.js`). It is `true` only while a timelapse restyle is in-flight. It is `false` at all other times, so auto-rotation relayouts and user interaction still move the camera normally.
- Do not remove or bypass the `_tlRestyling = true / false` wrapping around restyles in `updateTimeLapseFrame` — doing so will immediately re-introduce the snap.

## Known quirks
- `render.js` crash-resume exists because the renderer has a memory leak on long runs — the session system lets the user restart mid-sequence without losing progress. Keep this in mind before simplifying it.
- The timelapse system (`timelapse.js`) does not touch auto-rotation state — it runs alongside whatever the globe is already doing.
- **Never call `Plotly.react` during timelapse to update static traces.** `Plotly.react` processes the full layout and fires `plotly_relayout` with a camera value that races with `animateGlobe`'s continuous `Plotly.relayout` calls, causing the camera to snap. Use `updateStaticTracesForTimelapse()` (in `plot.js`) instead — it uses `Plotly.restyle` which only touches trace data and never fires camera events. Checkbox listeners in `app.js` already route through this function when `tlState.active`.

## Stack
- [Plotly.js 2.27.0](https://cdn.plot.ly/plotly-2.27.0.min.js) — loaded from CDN, available as global `Plotly`
- USGS Earthquake API for live data
- Web Audio API for seismic sound synthesis
- File System Access API for frame export (Chromium only)
