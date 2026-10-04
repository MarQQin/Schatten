// Runs the shadow computation off the main thread.
import { computeShadow, type SunDir } from './shadow.ts';
import type { Grid } from './grid.ts';

export type WorkerRequest =
  | { type: 'terrain'; terrainId: number; near: Grid; far: Grid }
  | { type: 'shade'; terrainId: number; sun: SunDir };

export interface WorkerResult {
  terrainId: number;
  sun: SunDir;
  mask: Uint8Array;
  ms: number;
}

let terrain: { id: number; near: Grid; far: Grid } | null = null;

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  if (msg.type === 'terrain') {
    terrain = { id: msg.terrainId, near: msg.near, far: msg.far };
    return;
  }
  if (!terrain || terrain.id !== msg.terrainId) return;
  const t0 = performance.now();
  const mask = computeShadow(terrain.near, terrain.far, msg.sun);
  const result: WorkerResult = { terrainId: terrain.id, sun: msg.sun, mask, ms: performance.now() - t0 };
  (self as unknown as Worker).postMessage(result, [mask.buffer]);
};
