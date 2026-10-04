// Horizon profile at a single point and the resulting direct-sun times for a day.

import { sample, type Grid } from './grid.ts';
import { CURV } from './shadow.ts';
import { sunPosition, zurichToDate } from './sun.ts';

export const AZ_STEP = 0.5; // degrees
const NEAR_LIMIT = 2000; // m: use the 10 m grid up to here (where available)
const OBSERVER = 1; // m above ground, avoids self-occlusion by grid noise

export interface Horizon {
  x: number;
  y: number;
  z: number;
  /** horizon elevation angle in degrees per grid azimuth i·AZ_STEP */
  angles: Float32Array;
}

export function computeHorizon(near: Grid, far: Grid, x: number, y: number): Horizon | null {
  const zGround = sample(near, x, y);
  if (Number.isNaN(zGround)) return null;
  const z0 = zGround + OBSERVER;
  const n = Math.round(360 / AZ_STEP);
  const angles = new Float32Array(n);
  const farReach = Math.min(
    x - far.xmin, far.xmin + far.width * far.res - x,
    far.ymax - y, y - (far.ymax - far.height * far.res),
  );
  for (let i = 0; i < n; i++) {
    const a = (i * AZ_STEP * Math.PI) / 180;
    const dx = Math.sin(a), dy = Math.cos(a);
    let best = -90;
    for (let d = near.res; d < farReach; d += d < NEAR_LIMIT ? near.res : far.res) {
      const px = x + d * dx, py = y + d * dy;
      let z = d < NEAR_LIMIT ? sample(near, px, py) : NaN;
      if (Number.isNaN(z)) z = sample(far, px, py);
      if (Number.isNaN(z)) continue;
      const ang = Math.atan2(z - z0 - CURV * d * d, d);
      if (ang > best) best = ang;
    }
    angles[i] = (best * 180) / Math.PI;
  }
  return { x, y, z: zGround, angles };
}

/** Horizon angle at a grid azimuth (degrees), linearly interpolated. */
export function horizonAt(h: Horizon, gridAz: number): number {
  const n = h.angles.length;
  const f = ((((gridAz % 360) + 360) % 360) / AZ_STEP);
  const i = Math.floor(f) % n;
  const t = f - Math.floor(f);
  return h.angles[i] * (1 - t) + h.angles[(i + 1) % n] * t;
}

export interface PathPoint {
  minutes: number;
  /** true azimuth and elevation */
  azimuth: number;
  elevation: number;
  lit: boolean;
}

/** Sun path over the day (local Swiss time) every `step` minutes, with lit flag. */
export function sunPath(
  h: Horizon, isoDate: string, lat: number, lon: number, trueNorthInGrid: number, step = 2,
): PathPoint[] {
  const out: PathPoint[] = [];
  for (let m = 0; m <= 1440; m += step) {
    const s = sunPosition(zurichToDate(isoDate, m), lat, lon);
    const lit = s.elevation > 0 && s.elevation > horizonAt(h, s.azimuth + trueNorthInGrid);
    out.push({ minutes: m, azimuth: s.azimuth, elevation: s.elevation, lit });
  }
  return out;
}

/** Contiguous lit intervals [start, end] in minutes. */
export function litIntervals(path: PathPoint[]): [number, number][] {
  const res: [number, number][] = [];
  let start: number | null = null;
  for (let i = 0; i < path.length; i++) {
    if (path[i].lit && start === null) start = path[i].minutes;
    if (!path[i].lit && start !== null) {
      res.push([start, path[i - 1].minutes]);
      start = null;
    }
  }
  if (start !== null) res.push([start, path[path.length - 1].minutes]);
  return res;
}
