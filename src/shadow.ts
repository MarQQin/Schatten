// Terrain shadow by line sweep along the light direction.
//
// The terrain is resampled on a lattice rotated so that its rows run parallel to the
// sunlight. Walking each row from the sun side, we keep the dominant occluder (zo, to):
// its shadow surface at position t is  zo − d·tan(elev) − CURV·d²  with d = t − to.
// Including Earth curvature this way is exact: two occluders' surfaces differ by a
// linear function of t, so once a later occluder is higher, it stays higher.
//
// Two passes: the far grid (40 m, view + 15 km) first, then the near grid (10 m, view)
// with each row starting from the far result at its entry point.

import { sample, type Grid } from './grid.ts';

export const LIT = 0;
export const CAST = 1; // shaded by other terrain
export const SELF = 2; // slope faces away from the sun
export const NODATA = 255;

/** Earth curvature with terrestrial refraction (k = 0.13): drop = CURV · d². */
export const CURV = (1 - 0.13) / (2 * 6371000);
/** Terrain must be this far below the shadow surface to count as shaded (m). */
const EPS = 1;
const NONE = -1e9;

export interface SunDir {
  /** Degrees clockwise from LV95 grid north. */
  gridAzimuth: number;
  /** Degrees above the horizon. */
  elevation: number;
}

interface Sweep {
  /** origin used for lattice coordinates */
  ox: number;
  oy: number;
  tmin: number;
  vmin: number;
  step: number;
  nu: number;
  nv: number;
  /** shadow surface height from upstream occluders at each lattice point (NONE = none) */
  H: Float32Array;
  /** dominant occluder after each lattice point: elevation and position t */
  OZ: Float32Array;
  OT: Float32Array;
}

/** Light travel direction L (away from the sun) and across direction P, in (E, N). */
function directions(sun: SunDir) {
  const a = (sun.gridAzimuth * Math.PI) / 180;
  return { Lx: -Math.sin(a), Ly: -Math.cos(a), Px: Math.cos(a), Py: -Math.sin(a) };
}

function sweep(
  g: Grid,
  sun: SunDir,
  ox: number,
  oy: number,
  init?: (t: number, v: number) => { z: number; t: number } | null,
): Sweep {
  const { Lx, Ly, Px, Py } = directions(sun);
  const tanE = Math.tan((sun.elevation * Math.PI) / 180);
  const step = g.res;
  const xmax = g.xmin + g.width * g.res;
  const ymin = g.ymax - g.height * g.res;
  let tmin = Infinity, tmax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const [x, y] of [[g.xmin, ymin], [g.xmin, g.ymax], [xmax, ymin], [xmax, g.ymax]]) {
    const t = (x - ox) * Lx + (y - oy) * Ly;
    const v = (x - ox) * Px + (y - oy) * Py;
    tmin = Math.min(tmin, t); tmax = Math.max(tmax, t);
    vmin = Math.min(vmin, v); vmax = Math.max(vmax, v);
  }
  const nu = Math.ceil((tmax - tmin) / step) + 1;
  const nv = Math.ceil((vmax - vmin) / step) + 1;
  const H = new Float32Array(nu * nv);
  const OZ = new Float32Array(nu * nv);
  const OT = new Float32Array(nu * nv);

  for (let iv = 0; iv < nv; iv++) {
    const v = vmin + iv * step;
    let zo = NONE, to = 0, started = false;
    for (let iu = 0; iu < nu; iu++) {
      const t = tmin + iu * step;
      const idx = iv * nu + iu;
      const z = sample(g, ox + t * Lx + v * Px, oy + t * Ly + v * Py);
      if (!started && !Number.isNaN(z)) {
        started = true;
        const o = init?.(t, v);
        if (o) { zo = o.z; to = o.t; }
      }
      const d = t - to;
      const s = zo === NONE ? NONE : zo - d * tanE - CURV * d * d;
      H[idx] = s;
      if (z >= s) { zo = z; to = t; }
      OZ[idx] = zo;
      OT[idx] = to;
    }
  }
  return { ox, oy, tmin, vmin, step, nu, nv, H, OZ, OT };
}

/** Bilinear shadow-surface height of a sweep at lattice coordinates (t, v). */
function surfaceAt(s: Sweep, t: number, v: number): number {
  const fu = (t - s.tmin) / s.step, fv = (v - s.vmin) / s.step;
  const iu = Math.floor(fu), iv = Math.floor(fv);
  if (iu < 0 || iv < 0 || iu + 1 >= s.nu || iv + 1 >= s.nv) return NONE;
  const a = fu - iu, b = fv - iv, i = iv * s.nu + iu, H = s.H;
  const h00 = H[i], h10 = H[i + 1], h01 = H[i + s.nu], h11 = H[i + s.nu + 1];
  if (h00 === NONE || h10 === NONE || h01 === NONE || h11 === NONE) {
    return H[(b < 0.5 ? i : i + s.nu) + (a < 0.5 ? 0 : 1)]; // nearest at row starts
  }
  return (h00 * (1 - a) + h10 * a) * (1 - b) + (h01 * (1 - a) + h11 * a) * b;
}

/**
 * Shadow mask for every pixel of `near` (LIT / CAST / SELF / NODATA).
 * `far` must cover `near` plus the shadow search radius; it may be omitted.
 */
export function computeShadow(near: Grid, far: Grid | null, sun: SunDir): Uint8Array {
  const mask = new Uint8Array(near.width * near.height);
  if (sun.elevation <= 0) {
    for (let i = 0; i < mask.length; i++) mask[i] = Number.isNaN(near.data[i]) ? NODATA : CAST;
    return mask;
  }
  const ox = near.xmin + (near.width * near.res) / 2;
  const oy = near.ymax - (near.height * near.res) / 2;

  let init: ((t: number, v: number) => { z: number; t: number } | null) | undefined;
  if (far) {
    const fs = sweep(far, sun, ox, oy);
    // occluder state of the far lattice point one to two cells upstream of (t, v)
    init = (t, v) => {
      const iu = Math.floor((t - fs.tmin) / fs.step) - 1;
      const iv = Math.round((v - fs.vmin) / fs.step);
      if (iu < 0 || iv < 0 || iu >= fs.nu || iv >= fs.nv) return null;
      const i = iv * fs.nu + iu;
      return fs.OZ[i] === NONE ? null : { z: fs.OZ[i], t: fs.OT[i] };
    };
  }
  const ns = sweep(near, sun, ox, oy, init);

  const { Lx, Ly, Px, Py } = directions(sun);
  const tanE = Math.tan((sun.elevation * Math.PI) / 180);
  const { width: w, height: h, data: z, res } = near;
  // self-shadow probe: one cell toward the sun (−L)
  const probeX = -Lx * res, probeY = -Ly * res, probeRise = res * tanE;

  for (let r = 0; r < h; r++) {
    const y = near.ymax - (r + 0.5) * res;
    for (let c = 0; c < w; c++) {
      const i = r * w + c;
      const zc = z[i];
      if (Number.isNaN(zc)) { mask[i] = NODATA; continue; }
      const x = near.xmin + (c + 0.5) * res;
      // self-shadow: the ground one cell toward the sun rises steeper than the sun
      // (a centred-difference normal fails on crests and in gullies)
      if (sample(near, x + probeX, y + probeY) - zc > probeRise) { mask[i] = SELF; continue; }
      const t = (x - ox) * Lx + (y - oy) * Ly;
      const v = (x - ox) * Px + (y - oy) * Py;
      mask[i] = zc < surfaceAt(ns, t, v) - EPS ? CAST : LIT;
    }
  }
  return mask;
}
