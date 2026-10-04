# Schatten – terrain shadow map for Switzerland (plan v2)

Goal: a map like map.geo.admin.ch (swisstopo topographic base map) with a date/time input and a
**binary shadow overlay**: is this spot lit by the sun, or does a mountain block it? The shadow is
cast from the sun position and an elevation model (no cosmetic hillshading).

Example question: *Is there sun on the Susten road on a November morning?*

## Scope (decided 2026-10-04)
- **Rough simulation.** The answer doesn't need to be minute-accurate.
- **Terrain only.** No trees, no buildings, no atmospheric refraction.
- **Map window ≤ 10–20 km.** Shadow search radius 15 km around the view. No whole-Switzerland
  processing.
- **Hosting: GitHub Pages, public repo.** The app is pure static files, with no server-side code.
- **Locus Map: on hold.**
- iPad and Android through the browser. Desktop works too.

## Data (verified)
- **swissALTIRegio** (swisstopo, 10 m DTM, also covers the border areas). One cloud-optimised
  GeoTIFF (COG) with overviews at 40/80/160 m:
  `https://data.geo.admin.ch/ch.swisstopo.swissaltiregio/swissaltiregio/swissaltiregio_2056_5728.tif`
- `data.geo.admin.ch` allows browser access from other sites (CORS `*`) and partial downloads
  (`Range` requests). The browser reads exactly the window it needs with **geotiff.js**, so no DEM
  hosting is needed.
- Base maps: swisstopo WMTS in LV95 (`pixelkarte-farbe`, `pixelkarte-grau`, `swissimage`), with the
  attribution "© swisstopo".
- Optional later: swissALTI3D 2 m, if 10 m turns out to be too coarse for narrow gorges or road cuts.

## How it works
1. **Sun position** from date, time and location: a small NOAA/Meeus-style function, accurate to well
   under 0.1°. Convert local time Europe/Zurich, including daylight saving, to UTC. Rotate azimuth to
   LV95 grid north (meridian convergence, one line of code: up to 2° in eastern CH).
2. **Terrain**:
   - the view extent at **10 m** (≤ 2000×2000 px, ≤ ~16 MB per first load, then cached);
   - a 15 km ring around it at **40 m** (the overview level).
3. **Shadow**, shaded if either applies:
   - **self-shadow**: the slope faces away from the sun;
   - **cast shadow**: terrain toward the sun, within 15 km, rises above the sun ray.

   It is computed with a **line sweep along the sun direction** in a Web Worker. Cost is O(N),
   expected well under 1 s. Earth curvature is included for free (≈15 m drop at 15 km). If it turns
   out too slow on the iPad, switch to a WebGL2 shader (per-pixel ray march).
4. **Overlay**: shaded pixels in semi-transparent dark blue, lit pixels transparent. Opacity slider.
   Re-rendered on pan/zoom (with debounce) and on any time change.

## Stack
- Vite + TypeScript, **OpenLayers in EPSG:2056** (like map.geo.admin.ch) + proj4, geotiff.js.
- GitHub Actions → GitHub Pages.
- Cache API (service worker) for downloaded DEM windows, plus a PWA manifest for the home screen.

## Steps
1. **Skeleton**: repo, Vite/TS/OpenLayers, swisstopo LV95 base map, layer switch, GitHub Pages
   deploy.
2. **Sun module** + UI: date picker, time slider (10 min steps), "now", sun azimuth/elevation
   readout, state in the URL (bookmarkable).
3. **DEM loader**: read the 10 m view window plus the 40 m ring from the COG, with caching.
4. **Shadow worker**: sweep + self-shadow → overlay canvas.
   **Unit tests** on synthetic terrain (cone, wall) against analytic shadows.
5. **Sanity check**: Susten pass road on a November morning, plus 2–3 known spots, compared against
   PeakFinder or webcam photos.
6. **Nice-to-have**: tap a point to get its horizon profile with the day's sun path, plus the times
   the sun appears and disappears behind terrain. Animation "play day".

## Later / on hold
- Locus Map overlays (MBTiles) – on hold.
- swissALTI3D 2 m near field, penumbra state, trees/buildings (swissSURFACE3D) – not planned.

## Limitations
- Bare-earth terrain: forests and buildings don't cast shadows.
- 10 m terrain smooths small features: narrow gorges, overhangs, road cuts.
- Mountains more than 15 km away are ignored. That only matters at very low sun (< ~5°).

## Status / validation (2026-10-04)
Steps 1–4 and 6 (point info) are done. Step 5 results:
- **Map vs. point method**: the map sweep and the per-point horizon ray march agree on 293–298 of 300
  random points (Susten area, 15 Nov, 4 times of day). Remaining differences are on steep, rough
  ground at sub-pixel scale. This check found and fixed a false self-shadow on crests (the
  centred-difference normal was replaced by a one-cell probe toward the sun).
- **Webcam, Sustenpass summit** (livecam.sustenpass.ch via guidle, 48 h archive, 30 min frames),
  3 and 4 October 2026:

  | Spot (LV95) | App: first sun | Webcam |
  |---|---|---|
  | Slope NE of car park (2677260/1176035) | 09:06 | lit at 09:10 |
  | Lake (2676933/1175850) | 09:11 | shadow edge at 09:10 |
  | Car park (2677086/1175861) | 09:16 | shaded 09:10, lit 09:30/09:40 |

  Agreement within the frame spacing, roughly ±10 min. The near road stays in the summit
  building's shadow, which is expected: buildings are not modelled.
