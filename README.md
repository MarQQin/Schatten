# Schatten

Terrain shadow map for Switzerland: is a spot in the sun or shaded by mountains at a given
date and time? Personal project.

- Base map: swisstopo WMTS (LV95)
- Terrain: swisstopo swissALTIRegio (10 m, 40 m far field), read directly via HTTP range requests
- Shadow: line sweep along the sunlight in a Web Worker; tap a point for its horizon and sun times

Data © swisstopo.

```
npm install
npm run dev     # local dev server
npm test        # synthetic-terrain tests
npm run build   # static site in dist/
```
