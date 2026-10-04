import 'ol/ol.css';
import './style.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import ScaleLine from 'ol/control/ScaleLine';
import { defaults as defaultControls } from 'ol/control/defaults';
import { lv95, LV95_EXTENT, RESOLUTIONS, lv95ToWgs84, trueNorthInGrid, wmtsSource } from './swisstopo';
import { buffer, getHeight, getWidth } from 'ol/extent';
import { sunPosition, zurichNow, zurichToDate } from './sun';
import { loadGrid, sample, stats, type Grid } from './dem';
import { ShadowLayer } from './shadowLayer.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const dateInput = $<HTMLInputElement>('date');
const timeInput = $<HTMLInputElement>('time');
const timeLabel = $<HTMLOutputElement>('timelabel');
const layerSelect = $<HTMLSelectElement>('baselayer');
const sunInfo = $<HTMLDivElement>('sun');
const terrainInfo = $<HTMLDivElement>('terrain');
const heightInfo = $<HTMLDivElement>('height');
const opacityInput = $<HTMLInputElement>('opacity');

const SHADOW_RADIUS = 15000; // m: terrain further away is ignored
const MAX_VIEW_SIZE = 25000; // m: beyond this, no shadow computation

// --- state from URL hash: #d=2026-11-15&t=08:30&x=2676500&y=1176200&z=20&l=... ---
const params = new URLSearchParams(location.hash.slice(1));
const now = zurichNow();
const parseTime = (s: string | null) => {
  const m = s?.match(/^(\d{1,2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
dateInput.value = params.get('d') ?? now.isoDate;
timeInput.value = String(parseTime(params.get('t')) ?? Math.floor(now.minutes / 5) * 5);
if (params.get('l')) layerSelect.value = params.get('l')!;

const baseLayer = new TileLayer({ source: wmtsSource(layerSelect.value) });
const view = new View({
  projection: lv95,
  extent: LV95_EXTENT,
  resolutions: RESOLUTIONS,
  center: [Number(params.get('x') ?? 2676500), Number(params.get('y') ?? 1176200)], // Sustenpass
  zoom: Number(params.get('z') ?? 20),
  constrainOnlyCenter: true,
});
const shadow = new ShadowLayer();
const map = new Map({
  target: 'map',
  layers: [baseLayer, shadow.layer],
  controls: defaultControls().extend([new ScaleLine()]),
  view,
});

const fmtTime = (min: number) =>
  `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

function writeHash() {
  const [x, y] = view.getCenter()!;
  const p = [
    `d=${dateInput.value}`,
    `t=${fmtTime(Number(timeInput.value))}`,
    `x=${x.toFixed(0)}`,
    `y=${y.toFixed(0)}`,
    `z=${view.getZoom()}`,
    `l=${layerSelect.value}`,
  ];
  history.replaceState(null, '', '#' + p.join('&'));
}

/** Sun direction for the current time at the map centre, azimuth in LV95 grid terms. */
export function currentSun() {
  const [x, y] = view.getCenter()!;
  const [lon, lat] = lv95ToWgs84(x, y);
  const instant = zurichToDate(dateInput.value, Number(timeInput.value));
  const sun = sunPosition(instant, lat, lon);
  return { ...sun, gridAzimuth: (sun.azimuth + trueNorthInGrid(x, y) + 360) % 360, instant };
}

function update() {
  timeLabel.value = fmtTime(Number(timeInput.value));
  const sun = currentSun();
  sunInfo.textContent =
    sun.elevation > 0
      ? `Sonne: Azimut ${sun.azimuth.toFixed(1)}°, Höhe ${sun.elevation.toFixed(1)}°`
      : `Sonne unter dem Horizont (${sun.elevation.toFixed(1)}°)`;
  shadow.setSun(sun);
  writeHash();
}

dateInput.addEventListener('change', update);
timeInput.addEventListener('input', update);
$<HTMLButtonElement>('now').addEventListener('click', () => {
  const n = zurichNow();
  dateInput.value = n.isoDate;
  timeInput.value = String(Math.floor(n.minutes / 5) * 5);
  update();
});
layerSelect.addEventListener('change', () => {
  baseLayer.setSource(wmtsSource(layerSelect.value));
  writeHash();
});
// --- terrain: view at 10 m, view + shadow radius at 40 m ---
let terrain: { near: Grid; far: Grid } | null = null;
let terrainGen = 0;
let terrainText = '';
shadow.onComputed = (ms) => {
  terrainInfo.textContent = `${terrainText}, Schatten ${ms.toFixed(0)} ms`;
};

async function loadTerrain() {
  const extent = view.calculateExtent(map.getSize());
  if (Math.max(getWidth(extent), getHeight(extent)) > MAX_VIEW_SIZE) {
    terrain = null;
    shadow.clear();
    terrainInfo.textContent = 'Gelände: zum Berechnen weiter hineinzoomen';
    return;
  }
  const gen = ++terrainGen;
  const t0 = performance.now();
  const bytes0 = stats.bytesDecoded;
  terrainInfo.textContent = 'Gelände: lädt …';
  try {
    const [near, far] = await Promise.all([
      loadGrid(10, buffer(extent, 100)),
      loadGrid(40, buffer(extent, SHADOW_RADIUS)),
    ]);
    if (gen !== terrainGen) return; // superseded by a newer view
    terrain = { near, far };
    shadow.setTerrain(near, far, currentSun());
    const mb = (stats.bytesDecoded - bytes0) / 1e6;
    terrainInfo.textContent =
      `Gelände: 10 m ${near.width}×${near.height}, 40 m ${far.width}×${far.height}` +
      ` (${mb.toFixed(1)} MB neu, ${((performance.now() - t0) / 1000).toFixed(1)} s)`;
    terrainText = terrainInfo.textContent;
  } catch (err) {
    if (gen !== terrainGen) return;
    console.error(err);
    terrainInfo.textContent = 'Gelände: Fehler beim Laden';
  }
}

function showHeight(coord: number[]) {
  const h = terrain ? sample(terrain.near, coord[0], coord[1]) : NaN;
  heightInfo.textContent = Number.isNaN(h) ? '' : `Höhe am Zeiger: ${h.toFixed(0)} m`;
}
opacityInput.addEventListener('input', () => shadow.layer.setOpacity(Number(opacityInput.value) / 100));
shadow.layer.setOpacity(Number(opacityInput.value) / 100);

map.on('pointermove', (e) => showHeight(e.coordinate));
map.on('click', (e) => showHeight(e.coordinate));

map.on('moveend', () => {
  update();
  loadTerrain();
});
update();

export { map };
