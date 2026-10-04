// Synthetic terrain with analytically known shadows. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeShadow, CURV, LIT, CAST, SELF } from '../src/shadow.ts';
import type { Grid } from '../src/grid.ts';

/** Square grid centred on (cx, cy) with elevation f(x, y). */
function makeGrid(cx: number, cy: number, size: number, res: number, f: (x: number, y: number) => number): Grid {
  const n = Math.round(size / res);
  const g: Grid = { data: new Float32Array(n * n), width: n, height: n, xmin: cx - size / 2, ymax: cy + size / 2, res };
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) g.data[r * n + c] = f(g.xmin + (c + 0.5) * res, g.ymax - (r + 0.5) * res);
  return g;
}
const at = (g: Grid, m: Uint8Array, x: number, y: number) =>
  m[Math.floor((g.ymax - y) / g.res) * g.width + Math.floor((x - g.xmin) / g.res)];

const CX = 2600000, CY = 1200000;

test('E-W wall, sun from south at 45°: 100 m shadow to the north', () => {
  const wall = (x: number, y: number) => (Math.abs(y - CY) < 20 ? 1100 : 1000);
  const near = makeGrid(CX, CY, 2000, 10, wall);
  const far = makeGrid(CX, CY, 8000, 40, () => 1000);
  const m = computeShadow(near, far, { gridAzimuth: 180, elevation: 45 });
  // wall top edge at CY+20; shadow reaches CY+20+100
  for (const dy of [40, 70, 110]) assert.equal(at(near, m, CX, CY + dy), CAST, `dy=${dy}`);
  for (const dy of [140, 300]) assert.equal(at(near, m, CX, CY + dy), LIT, `dy=${dy}`);
  assert.equal(at(near, m, CX, CY - 200), LIT, 'sunny side');
});

test('sun from east: N-S wall shades the west side', () => {
  const near = makeGrid(CX, CY, 2000, 10, (x) => (Math.abs(x - CX) < 20 ? 1050 : 1000));
  const m = computeShadow(near, null, { gridAzimuth: 90, elevation: 26.57 }); // tan = 0.5 → 100 m
  assert.equal(at(near, m, CX - 80, CY), CAST);
  assert.equal(at(near, m, CX - 150, CY), LIT);
  assert.equal(at(near, m, CX + 80, CY), LIT);
});

test('diagonal sun (SE): tower shadow falls to the NW', () => {
  const near = makeGrid(CX, CY, 2000, 10, (x, y) => (Math.hypot(x - CX, y - CY) < 30 ? 1200 : 1000));
  const m = computeShadow(near, null, { gridAzimuth: 135, elevation: 30 }); // length 200/tan30 = 346 m
  const d = 200 / Math.SQRT2; // 200 m along the NW diagonal
  assert.equal(at(near, m, CX - d, CY + d), CAST);
  assert.equal(at(near, m, CX + d, CY - d), LIT);
  assert.equal(at(near, m, CX - d, CY - d), LIT);
  assert.equal(at(near, m, CX - 280, CY + 280), LIT); // 396 m: beyond the shadow tip
});

test('self-shadow: north-facing 30° slope, sun from south', () => {
  const slope = (x: number, y: number) => 1000 - Math.tan(Math.PI / 6) * (y - CY); // falls to north
  const near = makeGrid(CX, CY, 1000, 10, slope);
  assert.equal(at(near, computeShadow(near, null, { gridAzimuth: 180, elevation: 20 }), CX, CY), SELF);
  assert.equal(at(near, computeShadow(near, null, { gridAzimuth: 180, elevation: 40 }), CX, CY), LIT);
});

test('distant peak from the far grid, with Earth curvature', () => {
  // 3000 m peak 14 km south of a flat 1000 m valley. Without curvature the shadow surface
  // would be 5 m above the valley floor; curvature lowers it by CURV·d² ≈ 13 m → lit.
  const d = 14000;
  const drop = CURV * d * d;
  assert.ok(drop > 10 && drop < 16);
  const peak = (x: number, y: number) => (Math.hypot(x - CX, y - (CY - d)) < 60 ? 3000 : 1000);
  const near = makeGrid(CX, CY, 1000, 10, () => 1000);
  const far = makeGrid(CX, CY - 7000, 32000, 40, peak);
  const tanE = (3000 - 1005) / (d - 40); // grazes 5 m above the valley at CX, CY (peak edge ~40 m closer)
  const elev = (Math.atan(tanE) * 180) / Math.PI;
  const m1 = computeShadow(near, far, { gridAzimuth: 180, elevation: elev });
  assert.equal(at(near, m1, CX, CY), LIT, 'curvature lowers the shadow below the valley');
  const m2 = computeShadow(near, far, { gridAzimuth: 180, elevation: elev - 0.1 });
  assert.equal(at(near, m2, CX, CY), CAST, 'slightly lower sun: shaded');
});

test('sun below horizon: everything shaded', () => {
  const near = makeGrid(CX, CY, 500, 10, () => 1000);
  const m = computeShadow(near, null, { gridAzimuth: 180, elevation: -1 });
  assert.ok(m.every((v) => v === CAST));
});

test('summit and ridge crest stay lit (no false self-shadow)', () => {
  // sharp pyramid peak and a sharp E-W ridge, sun from the SE / S
  const peak = makeGrid(CX, CY, 1000, 10, (x, y) => 1500 - 0.8 * Math.max(Math.abs(x - CX), Math.abs(y - CY)));
  assert.equal(at(peak, computeShadow(peak, null, { gridAzimuth: 146, elevation: 18 }), CX + 1, CY + 1), LIT);
  const ridge = makeGrid(CX, CY, 1000, 10, (_x, y) => 1500 - 0.8 * Math.abs(y - CY));
  assert.equal(at(ridge, computeShadow(ridge, null, { gridAzimuth: 180, elevation: 18 }), CX, CY + 1), LIT);
  assert.equal(at(ridge, computeShadow(ridge, null, { gridAzimuth: 180, elevation: 18 }), CX, CY + 100), SELF);
});
