// Sun position after the NOAA solar calculator (Meeus), accuracy ~0.01°.
// No atmospheric refraction: the elevation is geometric.

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

export interface SunPosition {
  /** Degrees clockwise from true north. */
  azimuth: number;
  /** Degrees above the (flat, geometric) horizon. */
  elevation: number;
}

const mod360 = (a: number) => ((a % 360) + 360) % 360;

export function sunPosition(date: Date, latDeg: number, lonDeg: number): SunPosition {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545) / 36525;

  const L0 = mod360(280.46646 + T * (36000.76983 + T * 0.0003032));
  const M = (357.52911 + T * (35999.05029 - 0.0001537 * T)) * RAD;
  const C =
    Math.sin(M) * (1.914602 - T * (0.004817 + 0.000014 * T)) +
    Math.sin(2 * M) * (0.019993 - 0.000101 * T) +
    Math.sin(3 * M) * 0.000289;
  const omega = (125.04 - 1934.136 * T) * RAD;
  const lambda = (L0 + C - 0.00569 - 0.00478 * Math.sin(omega)) * RAD;
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = (eps0 + 0.00256 * Math.cos(omega)) * RAD;

  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = mod360(280.46061837 + 360.98564736629 * (jd - 2451545) + T * T * (0.000387933 - T / 38710000));
  const H = (gmst + lonDeg) * RAD - ra;

  const lat = latDeg * RAD;
  const elevation = Math.asin(Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H));
  const azimuth = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat));

  return { azimuth: mod360(azimuth * DEG + 180), elevation: elevation * DEG };
}

/** UTC offset of Europe/Zurich at the given instant, in minutes (60 or 120). */
function zurichOffsetMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Zurich',
    hourCycle: 'h23',
    year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric',
  }).formatToParts(instant);
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'));
  return Math.round((asUtc - instant.getTime()) / 60000);
}

/** Local Swiss wall-clock time (date "YYYY-MM-DD", minutes after midnight) to an instant. */
export function zurichToDate(isoDate: string, minutes: number): Date {
  const [y, m, d] = isoDate.split('-').map(Number);
  const naive = Date.UTC(y, m - 1, d, 0, minutes);
  let utc = naive - 60 * 60000; // first guess: CET
  utc = naive - zurichOffsetMinutes(new Date(utc)) * 60000;
  return new Date(utc);
}

/** Current Swiss date and minutes after midnight. */
export function zurichNow(): { isoDate: string; minutes: number } {
  const now = new Date();
  const local = new Date(now.getTime() + zurichOffsetMinutes(now) * 60000);
  return {
    isoDate: local.toISOString().slice(0, 10),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
  };
}
