import 'ol/ol.css';
import './style.css';
import Map from 'ol/Map';
import View from 'ol/View';
import TileLayer from 'ol/layer/Tile';
import ScaleLine from 'ol/control/ScaleLine';
import { defaults as defaultControls } from 'ol/control/defaults';
import { lv95, LV95_EXTENT, RESOLUTIONS, wmtsSource } from './swisstopo';

const baseLayer = new TileLayer({ source: wmtsSource('ch.swisstopo.pixelkarte-farbe') });

const map = new Map({
  target: 'map',
  layers: [baseLayer],
  controls: defaultControls().extend([new ScaleLine()]),
  view: new View({
    projection: lv95,
    extent: LV95_EXTENT,
    resolutions: RESOLUTIONS,
    center: [2676500, 1176200], // Sustenpass
    zoom: 20,
    constrainOnlyCenter: true,
  }),
});

const select = document.getElementById('baselayer') as HTMLSelectElement;
select.addEventListener('change', () => baseLayer.setSource(wmtsSource(select.value)));

export { map };
