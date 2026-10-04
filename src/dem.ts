// Terrain loader for swissALTIRegio (swisstopo, 10 m DTM incl. border areas).
// Reads only the needed 256×256 internal COG tiles via HTTP range requests and
// keeps decoded tiles in an in-memory LRU cache.

import { fromUrl, type GeoTIFF, type GeoTIFFImage } from 'geotiff';
import type { Grid } from './grid';

export { sample, type Grid } from './grid';

const URL_REGIO =
  'https://data.geo.admin.ch/ch.swisstopo.swissaltiregio/swissaltiregio/swissaltiregio_2056_5728.tif';
const ORIGIN_X = 2385000; // upper-left corner, LV95
const ORIGIN_Y = 1404000;
const TILE = 256;
const NODATA_ABOVE = 1e30; // file nodata is 3.4e38
const MAX_CACHED_TILES = 250; // 256 KB each → ~64 MB

/** Overview levels in the COG: index → resolution in m. */
export const LEVELS = { 10: 0, 40: 1, 80: 2, 160: 3 } as const;
export type Resolution = keyof typeof LEVELS;

let tiffPromise: Promise<GeoTIFF> | null = null;
const images = new Map<number, Promise<GeoTIFFImage>>();
const tileCache = new Map<string, Promise<Float32Array>>();

export const stats = { tilesFetched: 0, bytesDecoded: 0 };

// geotiff.js keeps fetched bytes in a small block cache (~100 × 64 KB). Too many parallel
// tile reads evict blocks before a tile is assembled ("Offset is outside the bounds of the
// DataView"), so reads are limited to a few at a time.
const MAX_PARALLEL = 4;
let active = 0;
const waiting: (() => void)[] = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

function image(level: number): Promise<GeoTIFFImage> {
  tiffPromise ??= fromUrl(URL_REGIO);
  let img = images.get(level);
  if (!img) {
    img = tiffPromise.then((t) => t.getImage(level));
    images.set(level, img);
  }
  return img;
}

function loadTile(res: Resolution, tx: number, ty: number): Promise<Float32Array> {
  const key = `${res}/${tx}/${ty}`;
  const hit = tileCache.get(key);
  if (hit) {
    tileCache.delete(key); // refresh LRU position
    tileCache.set(key, hit);
    return hit;
  }
  const p = (async () => {
    const img = await image(LEVELS[res]);
    const x0 = tx * TILE;
    const y0 = ty * TILE;
    const x1 = Math.min(x0 + TILE, img.getWidth());
    const y1 = Math.min(y0 + TILE, img.getHeight());
    const read = () =>
      limited(() => img.readRasters({ window: [x0, y0, x1, y1], interleave: true })) as unknown as Promise<Float32Array>;
    const raster = await read().catch(read); // one retry
    // pad partial edge tiles to TILE×TILE, convert nodata to NaN
    const out = new Float32Array(TILE * TILE).fill(NaN);
    const w = x1 - x0;
    for (let r = 0; r < y1 - y0; r++) {
      for (let c = 0; c < w; c++) {
        const v = raster[r * w + c];
        out[r * TILE + c] = v > NODATA_ABOVE ? NaN : v;
      }
    }
    stats.tilesFetched++;
    stats.bytesDecoded += out.byteLength;
    return out;
  })();
  p.catch(() => tileCache.delete(key)); // retry on next request
  tileCache.set(key, p);
  while (tileCache.size > MAX_CACHED_TILES) tileCache.delete(tileCache.keys().next().value!);
  return p;
}

/**
 * Elevation grid covering [xmin, ymin, xmax, ymax] (LV95), snapped outward to the
 * pixel grid of the requested resolution.
 */
export async function loadGrid(res: Resolution, extent: number[]): Promise<Grid> {
  const [xmin, ymin, xmax, ymax] = extent;
  const c0 = Math.floor((xmin - ORIGIN_X) / res);
  const c1 = Math.ceil((xmax - ORIGIN_X) / res);
  const r0 = Math.floor((ORIGIN_Y - ymax) / res);
  const r1 = Math.ceil((ORIGIN_Y - ymin) / res);
  const width = c1 - c0;
  const height = r1 - r0;
  const data = new Float32Array(width * height).fill(NaN);

  const jobs: Promise<void>[] = [];
  for (let ty = Math.floor(r0 / TILE); ty <= Math.floor((r1 - 1) / TILE); ty++) {
    for (let tx = Math.floor(c0 / TILE); tx <= Math.floor((c1 - 1) / TILE); tx++) {
      if (tx < 0 || ty < 0) continue;
      jobs.push(
        loadTile(res, tx, ty).then((tile) => {
          // copy the overlap of this tile into the output grid
          const rs = Math.max(r0, ty * TILE), re = Math.min(r1, (ty + 1) * TILE);
          const cs = Math.max(c0, tx * TILE), ce = Math.min(c1, (tx + 1) * TILE);
          for (let r = rs; r < re; r++) {
            const src = (r - ty * TILE) * TILE + (cs - tx * TILE);
            data.set(tile.subarray(src, src + (ce - cs)), (r - r0) * width + (cs - c0));
          }
        }),
      );
    }
  }
  await Promise.all(jobs);
  return { data, width, height, xmin: ORIGIN_X + c0 * res, ymax: ORIGIN_Y - r0 * res, res };
}
