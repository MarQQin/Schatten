// Info box for a selected point: sun times and a horizon / sun-path chart (SVG).

import { horizonAt, type Horizon, type PathPoint } from './point.ts';

const W = 300, H = 130, PAD_L = 26, PAD_B = 16, PAD_T = 6, PAD_R = 6;

const fmt = (min: number) =>
  `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

const COMPASS = ['N', 'NO', 'O', 'SO', 'S', 'SW', 'W', 'NW'];

export function renderPointInfo(
  box: HTMLElement,
  h: Horizon,
  path: PathPoint[],
  intervals: [number, number][],
  trueNorthInGrid: number,
  nowMinutes: number,
) {
  const day = path.filter((p) => p.elevation > -1);
  const now = path.reduce((a, b) => (Math.abs(b.minutes - nowMinutes) < Math.abs(a.minutes - nowMinutes) ? b : a));

  // chart ranges: azimuth span of the day's sun path, elevation up to sun max / horizon max
  const azMin = Math.max(0, Math.floor((Math.min(...day.map((p) => p.azimuth)) - 15) / 15) * 15);
  const azMax = Math.min(360, Math.ceil((Math.max(...day.map((p) => p.azimuth)) + 15) / 15) * 15);
  const horizonTrue = (az: number) => horizonAt(h, az + trueNorthInGrid);
  let elMax = Math.max(...day.map((p) => p.elevation));
  for (let az = azMin; az <= azMax; az += 1) elMax = Math.max(elMax, horizonTrue(az));
  elMax = Math.ceil((elMax + 3) / 10) * 10;
  const sx = (az: number) => PAD_L + ((az - azMin) / (azMax - azMin)) * (W - PAD_L - PAD_R);
  const sy = (el: number) => H - PAD_B - (Math.max(el, 0) / elMax) * (H - PAD_B - PAD_T);

  let horizonPts = `${sx(azMin)},${sy(0)} `;
  for (let az = azMin; az <= azMax; az += 0.5) horizonPts += `${sx(az).toFixed(1)},${sy(horizonTrue(az)).toFixed(1)} `;
  horizonPts += `${sx(azMax)},${sy(0)}`;

  const sunPts = day.map((p) => `${sx(p.azimuth).toFixed(1)},${sy(p.elevation).toFixed(1)}`).join(' ');
  const hourMarks = day
    .filter((p) => p.minutes % 60 === 0 && p.elevation > 0)
    .map(
      (p) =>
        `<circle cx="${sx(p.azimuth)}" cy="${sy(p.elevation)}" r="1.8" fill="#c77700"/>` +
        `<text x="${sx(p.azimuth)}" y="${sy(p.elevation) - 4}" class="hr">${p.minutes / 60}</text>`,
    )
    .join('');

  let grid = '';
  for (let el = 10; el < elMax; el += 10)
    grid += `<line x1="${PAD_L}" x2="${W - PAD_R}" y1="${sy(el)}" y2="${sy(el)}" class="g"/><text x="${PAD_L - 3}" y="${sy(el) + 3}" class="ax" text-anchor="end">${el}°</text>`;
  for (let az = Math.ceil(azMin / 45) * 45; az <= azMax; az += 45)
    grid += `<text x="${sx(az)}" y="${H - 4}" class="ax" text-anchor="middle">${COMPASS[(az / 45) % 8]}</text>`;

  const nowMark =
    now.elevation > 0 && now.azimuth >= azMin && now.azimuth <= azMax
      ? `<circle cx="${sx(now.azimuth)}" cy="${sy(now.elevation)}" r="5" fill="${now.lit ? '#ffd000' : '#445'}" stroke="#000" stroke-width="1"/>`
      : '';

  const times = intervals.length
    ? intervals.map(([a, b]) => `${fmt(a)}–${fmt(b)}`).join(', ')
    : 'keine';
  const total = intervals.reduce((s, [a, b]) => s + b - a, 0);
  const nowText = now.elevation <= 0 ? 'Sonne unter dem Horizont' : now.lit ? 'Sonne' : 'Schatten';

  box.innerHTML = `
    <button type="button" class="close" aria-label="Schliessen">×</button>
    <div><b>${Math.round(h.x)} / ${Math.round(h.y)}</b>, ${h.z.toFixed(0)} m</div>
    <div>Direkte Sonne: <b>${times}</b>${total ? ` (${Math.floor(total / 60)} h ${total % 60} min)` : ''}</div>
    <div>Um ${fmt(nowMinutes)}: <b>${nowText}</b></div>
    <svg viewBox="0 0 ${W} ${H}" width="100%">
      ${grid}
      <polygon points="${horizonPts}" class="hz"/>
      <polyline points="${sunPts}" class="sun"/>
      ${hourMarks}
      ${nowMark}
    </svg>`;
  box.hidden = false;
}
