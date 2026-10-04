// Elevation grid type and sampling, free of dependencies (used in the worker and tests).

/** Elevation raster on a regular LV95 grid; NaN = no data. Pixel centres at xmin + (i+0.5)·res. */
export interface Grid {
  data: Float32Array;
  width: number;
  height: number;
  xmin: number;
  ymax: number;
  res: number;
}

/** Bilinear elevation at an LV95 point, or NaN outside the grid / in no-data. */
export function sample(g: Grid, x: number, y: number): number {
  const fx = (x - g.xmin) / g.res - 0.5;
  const fy = (g.ymax - y) / g.res - 0.5;
  const c = Math.floor(fx), r = Math.floor(fy);
  if (c < 0 || r < 0 || c + 1 >= g.width || r + 1 >= g.height) return NaN;
  const ax = fx - c, ay = fy - r, i = r * g.width + c, d = g.data;
  return (
    (d[i] * (1 - ax) + d[i + 1] * ax) * (1 - ay) +
    (d[i + g.width] * (1 - ax) + d[i + g.width + 1] * ax) * ay
  );
}
