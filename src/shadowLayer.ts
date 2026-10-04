// Map overlay showing the shadow mask, computed in a worker.
import ImageLayer from 'ol/layer/Image';
import ImageCanvasSource from 'ol/source/ImageCanvas';
import type { Grid } from './grid.ts';
import { CAST, SELF, type SunDir } from './shadow.ts';
import type { WorkerRequest, WorkerResult } from './shadow.worker.ts';

const SHADE_RGBA = [20, 30, 100, 255]; // layer opacity sets the transparency

export class ShadowLayer {
  readonly layer: ImageLayer<ImageCanvasSource>;
  onComputed: (ms: number) => void = () => {};

  private worker = new Worker(new URL('./shadow.worker.ts', import.meta.url), { type: 'module' });
  private terrainId = 0;
  private extent: number[] | null = null; // of the near grid
  private size: [number, number] = [0, 0];
  private maskCanvas = document.createElement('canvas');
  private shown: { terrainId: number; extent: number[] } | null = null;
  private busy = false;
  private pendingSun: SunDir | null = null;

  constructor(opacity = 0.45) {
    const source = new ImageCanvasSource({
      ratio: 1,
      canvasFunction: (extent, _resolution, _pixelRatio, size) => {
        const canvas = document.createElement('canvas');
        canvas.width = size[0];
        canvas.height = size[1];
        const s = this.shown;
        if (s) {
          const k = size[0] / (extent[2] - extent[0]); // px per metre
          const ctx = canvas.getContext('2d')!;
          ctx.imageSmoothingEnabled = k < 1 / 10; // smooth only when zoomed out
          ctx.drawImage(
            this.maskCanvas,
            (s.extent[0] - extent[0]) * k,
            (extent[3] - s.extent[3]) * k,
            (s.extent[2] - s.extent[0]) * k,
            (s.extent[3] - s.extent[1]) * k,
          );
        }
        return canvas;
      },
    });
    this.layer = new ImageLayer({ source, opacity });
    this.worker.onmessage = (e: MessageEvent<WorkerResult>) => this.onResult(e.data);
  }

  /** New terrain: send it to the worker (copied), then recompute with `sun`. */
  setTerrain(near: Grid, far: Grid, sun: SunDir) {
    this.terrainId++;
    this.extent = [near.xmin, near.ymax - near.height * near.res, near.xmin + near.width * near.res, near.ymax];
    this.size = [near.width, near.height];
    this.post({ type: 'terrain', terrainId: this.terrainId, near, far });
    this.busy = false; // results for older terrain are ignored anyway
    this.setSun(sun);
  }

  clear() {
    this.terrainId++;
    this.extent = null;
    this.shown = null;
    this.layer.getSource()!.changed();
  }

  /** Recompute for a new sun position; while busy, only the latest request is kept. */
  setSun(sun: SunDir) {
    if (!this.extent) return;
    if (this.busy) {
      this.pendingSun = sun;
      return;
    }
    this.busy = true;
    this.post({ type: 'shade', terrainId: this.terrainId, sun });
  }

  private post(msg: WorkerRequest) {
    this.worker.postMessage(msg);
  }

  private onResult(r: WorkerResult) {
    if (r.terrainId !== this.terrainId || !this.extent) return;
    this.busy = false;
    const [w, h] = this.size;
    this.maskCanvas.width = w;
    this.maskCanvas.height = h;
    const ctx = this.maskCanvas.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    const px = img.data;
    for (let i = 0; i < r.mask.length; i++) {
      if (r.mask[i] === CAST || r.mask[i] === SELF) px.set(SHADE_RGBA, i * 4);
    }
    ctx.putImageData(img, 0, 0);
    this.shown = { terrainId: r.terrainId, extent: this.extent };
    this.layer.getSource()!.changed();
    this.onComputed(r.ms);
    if (this.pendingSun) {
      const s = this.pendingSun;
      this.pendingSun = null;
      this.setSun(s);
    }
  }
}
