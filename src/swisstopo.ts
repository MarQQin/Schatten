import proj4 from 'proj4';
import { register } from 'ol/proj/proj4';
import { get as getProjection } from 'ol/proj';
import TileGrid from 'ol/tilegrid/TileGrid';
import XYZ from 'ol/source/XYZ';

proj4.defs(
  'EPSG:2056',
  '+proj=somerc +lat_0=46.9524055555556 +lon_0=7.43958333333333 +k_0=1 ' +
    '+x_0=2600000 +y_0=1200000 +ellps=bessel +towgs84=674.374,15.056,405.346,0,0,0,0 +units=m +no_defs',
);
register(proj4);

export const LV95_EXTENT = [2420000, 1030000, 2900000, 1350000];
export const lv95 = getProjection('EPSG:2056')!;
lv95.setExtent(LV95_EXTENT);

// swisstopo WMTS tile matrix set 2056 (same as map.geo.admin.ch)
export const RESOLUTIONS = [
  4000, 3750, 3500, 3250, 3000, 2750, 2500, 2250, 2000, 1750, 1500, 1250, 1000, 750, 650, 500, 250,
  100, 50, 20, 10, 5, 2.5, 2, 1.5, 1, 0.5, 0.25, 0.1,
];

const tileGrid = new TileGrid({
  origin: [LV95_EXTENT[0], LV95_EXTENT[3]],
  resolutions: RESOLUTIONS,
  extent: LV95_EXTENT,
});

export function wmtsSource(layer: string): XYZ {
  return new XYZ({
    projection: lv95,
    tileGrid,
    url: `https://wmts.geo.admin.ch/1.0.0/${layer}/default/current/2056/{z}/{x}/{y}.jpeg`,
    attributions: '© <a href="https://www.swisstopo.admin.ch/" target="_blank">swisstopo</a>',
    crossOrigin: 'anonymous',
  });
}

/** LV95 easting/northing to WGS84 [lon, lat]. */
export function lv95ToWgs84(e: number, n: number): [number, number] {
  return proj4('EPSG:2056', 'EPSG:4326', [e, n]) as [number, number];
}

/**
 * Angle of true north measured clockwise from LV95 grid north, in degrees
 * (meridian convergence; negative east of Bern). Grid azimuth = true azimuth + this.
 */
export function trueNorthInGrid(e: number, n: number): number {
  const [lon, lat] = lv95ToWgs84(e, n);
  const [e1, n1] = proj4('EPSG:4326', 'EPSG:2056', [lon, lat + 0.01]);
  return (Math.atan2(e1 - e, n1 - n) * 180) / Math.PI;
}
