# Earthquake Depth Map

Interactive version: [earthquakes.peterhunt.uk](https://earthquakes.peterhunt.uk) (works better on PC than mobile)

Source: [earthquake.usgs.gov](https://earthquake.usgs.gov)

---

I was inspired by a museum in Miyazaki — it had a glass cube showing the 3D origin of major earthquakes underneath Japan, and you could clearly see where the edges of the tectonic plates were.

I'd had the idea sitting in the back of my head but never got around to attempting it, primarily because I've no experience in this style of visualisation. We get AI tools provided via work, so I thought it'd be a good test of fully "vibe coding" something and completely taking my hands off the architecture while I just provided direction.

Gemini got me to a 3,000 line monolith before it reached its context limit. Claude was then able to split that out into multiple files.

What I found interesting was that "bugs" with vibe coding are not bugs in the traditional sense, but are more so things that are unstable and may break when updated. For example the camera caused a lot of grief, even though every commit to this repo it's been working correctly. Because I was doing this totally hands off, I had no idea what was going on under the hood, and all I could do was test the functionality and mention if changes broke it.

## What it does

Fetches real earthquake data from the USGS API and renders it as an interactive 3D globe using Plotly.js. The earthquake magnitude affects the colour and size of each point, ranging from tiny and red to huge and white. The depth of each point is exaggerated by 2.5x so it's slightly easier to see from the global scale, and the blue lines on the globe are the tectonic plate boundaries.

**Features:**
- Live USGS data with configurable filters (magnitude, depth, date range, result limit)
- 3D globe with country borders, tectonic plate boundaries, volcanoes, and lat/lon grid
- Click any earthquake to see details and simulate a seismic wave propagation
- Timelapse mode: watch earthquakes appear over time with fading trail and optional sound
- Search by country, volcano, or seismic zone
- GPS button to centre on your location
- Light/dark mode
- Frame renderer: export a 360° rotating sequence as PNG/JPEG/WEBP images, with crash resume (entirely optional — the rest of the app works without it)

## File structure

```
index.html          HTML shell
styles.css          All CSS
js/
  state.js          Global constants and mutable state
  audio.js          Web Audio synthesis (tones mapped to C Major Pentatonic)
  mapdata.js        GeoJSON/CSV processing for borders, plates, volcanoes, grid
  helpers.js        Small utility functions (sizes, labels, dates, error display)
  camera.js         Search/navigate functions (country, volcano, seismic zone, GPS)
  render.js         Frame renderer and crash-resume session management
  timelapse.js      Timelapse playback, scrubber, and sound triggering
  plot.js           Plotly trace construction and USGS data fetch
  animation.js      requestAnimationFrame loop (rotation, pulse wave, timelapse tick)
  app.js            App initialisation, UI wiring, click/drag interaction handling
```

## Running locally

Open `index.html` directly in a browser — no build step needed. The frame renderer requires a Chromium-based browser for the File System Access API.
