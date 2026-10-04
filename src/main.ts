import 'ol/ol.css';
import './style.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import ScaleLine from 'ol/control/ScaleLine';
import { defaults as defaultControls } from 'ol/control/defaults';
import { lv95, LV95_EXTENT, RESOLUTIONS, lv95ToWgs84, trueNorthInGrid, wmtsSource } from './swisstopo';
import { sunPosition, zurichNow, zurichToDate } from './sun';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const dateInput = $<HTMLInputElement>('date');
const timeInput = $<HTMLInputElement>('time');
const timeLabel = $<HTMLOutputElement>('timelabel');
const layerSelect = $<HTMLSelectElement>('baselayer');
const sunInfo = $<HTMLDivElement>('sun');

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
const map = new Map({
  target: 'map',
  layers: [baseLayer],
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
map.on('moveend', update);
update();

export { map };
