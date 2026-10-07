/**
 * The geography of an echogram's track: how far the ship went, how fast,
 * where it started and ended, which ship and survey, and the map view and
 * grid that show it. Pure functions; TrackCanvas draws with them.
 */

const EARTH_M = 6_371_008.8;
const NMI_M = 1852;

/** Great-circle distance in metres. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const dLat = (lat2 - lat1) * r;
  const dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial bearing from one point to the next, degrees clockwise from north. */
export function bearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const y = Math.sin((lon2 - lon1) * r) * Math.cos(lat2 * r);
  const x = Math.cos(lat1 * r) * Math.sin(lat2 * r) - Math.sin(lat1 * r) * Math.cos(lat2 * r) * Math.cos((lon2 - lon1) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

const ok = (lat: number, lon: number) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90;

/**
 * Longitudes made continuous along the track (a crossing of ±180° stays a
 * short step), so it draws and measures as the ship sailed.
 */
export function unwrap(lon: Float64Array): Float64Array {
  const out = new Float64Array(lon.length);
  let last = NaN;
  let shift = 0;
  for (let i = 0; i < lon.length; i++) {
    const o = lon[i];
    if (!Number.isFinite(o)) {
      out[i] = NaN;
      continue;
    }
    if (Number.isFinite(last)) {
      const d = o + shift - last;
      if (d > 180) shift -= 360;
      else if (d < -180) shift += 360;
    }
    out[i] = o + shift;
    last = out[i];
  }
  return out;
}

export interface TrackStats {
  /** Pings with a position. */
  fixes: number;
  first: number;
  last: number;
  metres: number;
  /** Mean speed over ground, m/s (NaN without times). */
  speed: number;
  durationMs: number;
  lat0: number;
  lat1: number;
  lon0: number;
  lon1: number;
  /** Metres from the first fix to each ping (NaN before it). */
  along: Float64Array;
}

/** Distance, duration, speed and extent of a track. Jumps faster than 40 kn
 *  (a GPS glitch, a gap with the ship elsewhere) are not counted as sailed. */
export function trackStats(lat: Float64Array, lon: Float64Array, times?: Float64Array): TrackStats | null {
  const n = Math.min(lat.length, lon.length);
  const along = new Float64Array(n).fill(NaN);
  let first = -1;
  let last = -1;
  let metres = 0;
  let fixes = 0;
  let lat0 = Infinity;
  let lat1 = -Infinity;
  let lon0 = Infinity;
  let lon1 = -Infinity;
  const ul = unwrap(lon.subarray(0, n));
  for (let i = 0; i < n; i++) {
    if (!ok(lat[i], ul[i])) continue;
    fixes++;
    lat0 = Math.min(lat0, lat[i]);
    lat1 = Math.max(lat1, lat[i]);
    lon0 = Math.min(lon0, ul[i]);
    lon1 = Math.max(lon1, ul[i]);
    if (last >= 0) {
      const d = haversine(lat[last], ul[last], lat[i], ul[i]);
      const dt = times ? (times[i] - times[last]) / 1000 : NaN;
      const glitch = Number.isFinite(dt) && dt > 0 ? d / dt > 40 * 0.514444 : false;
      if (!glitch) metres += d;
    } else first = i;
    along[i] = metres;
    last = i;
  }
  if (fixes < 2) return null;
  const durationMs = times && Number.isFinite(times[first]) && Number.isFinite(times[last]) ? times[last] - times[first] : NaN;
  return {
    fixes,
    first,
    last,
    metres,
    speed: durationMs > 0 ? metres / (durationMs / 1000) : NaN,
    durationMs,
    lat0,
    lat1,
    lon0,
    lon1,
    along,
  };
}

export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres)) return '—';
  const nmi = metres / NMI_M;
  const km = metres / 1000;
  return nmi >= 10 ? `${nmi.toFixed(0)} nmi (${km.toFixed(0)} km)` : `${nmi.toFixed(2)} nmi (${km.toFixed(2)} km)`;
}

export function formatSpeed(ms: number): string {
  return Number.isFinite(ms) ? `${(ms / 0.514444).toFixed(1)} kn` : '—';
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h >= 48) return `${(h / 24).toFixed(1)} days`;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min ${String(s % 60).padStart(2, '0')} s`;
}

/** 41°30.123′N — degrees and decimal minutes, as a chart or a GPS reads. */
export function formatLat(lat: number): string {
  return dm(lat, 'N', 'S', 2);
}

export function formatLon(lon: number): string {
  const wrapped = ((((lon + 180) % 360) + 360) % 360) - 180;
  return dm(wrapped, 'E', 'W', 3);
}

function dm(value: number, pos: string, neg: string, pad: number): string {
  if (!Number.isFinite(value)) return '—';
  const a = Math.abs(value);
  let d = Math.floor(a);
  let m = (a - d) * 60;
  if (Number(m.toFixed(3)) >= 60) {
    d += 1;
    m = 0;
  }
  return `${String(d).padStart(pad, '0')}°${m.toFixed(3).padStart(6, '0')}′${value < 0 ? neg : pos}`;
}

/* ------------------------------------------------------------------ */
/* Where a product's data were collected                               */
/* ------------------------------------------------------------------ */

export interface TrackContext {
  vessel: string;
  survey: string;
  product: string;
}

/**
 * The ship and survey, from where the product sits in the bucket: products
 * are kept under derived_products/<user>/<vessel>/<survey>/ (Prepare
 * EchoData's layout), and an NCEI path names them the same way. '' when the
 * path does not say.
 */
export function trackContext(uri: string, productName = ''): TrackContext {
  const parts = uri.replace(/^gs:\/\/[^/]+\//, '').split('/').filter(Boolean);
  const product = productName || parts[parts.length - 1] || '';
  const at = parts.indexOf('derived_products');
  if (at >= 0 && parts.length > at + 3) {
    return { vessel: parts[at + 2].replace(/_/g, ' '), survey: parts[at + 3], product };
  }
  const raw = parts.indexOf('raw');
  if (raw >= 0 && parts.length > raw + 2) {
    return { vessel: parts[raw + 1].replace(/_/g, ' '), survey: parts[raw + 2], product };
  }
  return { vessel: '', survey: '', product };
}

/* ------------------------------------------------------------------ */
/* The map's view and grid                                             */
/* ------------------------------------------------------------------ */

/** A map view: its centre and its scale (pixels per degree of latitude). */
export interface MapView {
  lon: number;
  lat: number;
  scale: number;
}

/** Local equirectangular: true to distance near the centre, as a chart is. */
export function toPx(view: MapView, w: number, h: number, lon: number, lat: number): [number, number] {
  const k = Math.cos((view.lat * Math.PI) / 180);
  return [w / 2 + (lon - view.lon) * k * view.scale, h / 2 - (lat - view.lat) * view.scale];
}

export function fromPx(view: MapView, w: number, h: number, x: number, y: number): [number, number] {
  const k = Math.max(0.05, Math.cos((view.lat * Math.PI) / 180));
  return [view.lon + (x - w / 2) / (k * view.scale), view.lat - (y - h / 2) / view.scale];
}

/** The view that fits a box, with a margin of `pad` pixels. */
export function fitView(lat0: number, lat1: number, lon0: number, lon1: number, w: number, h: number, pad = 18): MapView {
  const lat = (lat0 + lat1) / 2;
  const lon = (lon0 + lon1) / 2;
  const k = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  // At least ~600 m across, so a ship holding station is still a picture.
  const spanLat = Math.max(lat1 - lat0, 0.006);
  const spanLon = Math.max((lon1 - lon0) * k, 0.006);
  const scale = Math.min((h - 2 * pad) / spanLat, (w - 2 * pad) / spanLon);
  return { lon, lat, scale: clampScale(scale, h) };
}

/** Between the whole world and a few metres. */
export function clampScale(scale: number, h: number): number {
  return Math.max(h / 170, Math.min(scale, 200_000));
}

const STEPS = [30, 20, 10, 5, 2, 1, 0.5, 0.25, 10 / 60, 5 / 60, 2 / 60, 1 / 60, 0.5 / 60, 0.25 / 60, 0.1 / 60];

/** Graticule spacing in degrees: the finest round step whose lines are at
 *  least 0.7 × `targetPx` apart at this scale (pixels per degree). */
export function gridStep(scale: number, targetPx = 90): number {
  const wide = STEPS.filter((s) => s * scale >= targetPx * 0.7);
  return wide.length ? wide[wide.length - 1] : STEPS[0];
}

/** A grid line's label: 41°N, 41°30′N, 41°30.5′N, as fine as the step. */
export function gridLabel(value: number, step: number, axis: 'lat' | 'lon'): string {
  const [pos, neg] = axis === 'lat' ? ['N', 'S'] : ['E', 'W'];
  let v = value;
  if (axis === 'lon') v = ((((v + 180) % 360) + 360) % 360) - 180;
  const hemi = Math.abs(v) < 1e-9 ? '' : v < 0 ? neg : pos;
  const a = Math.abs(v);
  const d = Math.floor(a + 1e-9);
  const m = (a - d) * 60;
  if (step >= 1) return `${d}°${hemi}`;
  const mm = step >= 1 / 60 ? Math.round(m).toString() : m.toFixed(1);
  return Math.abs(m) < 1e-6 ? `${d}°${hemi}` : `${d}°${mm.padStart(2, '0')}′${hemi}`;
}

/** A round length (m, km or nmi) about `maxPx` long at this scale. */
export function scaleBar(metresPerPx: number, maxPx: number): { px: number; label: string } {
  const max = metresPerPx * maxPx;
  const nmiSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
  const nmi = [...nmiSteps].reverse().find((v) => v * 1852 <= max);
  if (nmi !== undefined && max >= 185) return { px: (nmi * 1852) / metresPerPx, label: `${nmi} nmi` };
  const mSteps = [10, 20, 50, 100, 200, 500, 1000];
  const m = [...mSteps].reverse().find((v) => v <= max) ?? 10;
  return { px: m / metresPerPx, label: m >= 1000 ? `${m / 1000} km` : `${m} m` };
}

/** Lat/lon to an equal-distance local plane fitted into width x height. */
export function project(lat: Float64Array, lon: Float64Array, width: number, height: number) {
  const n = Math.min(lat.length, lon.length);
  let la0 = Infinity;
  let la1 = -Infinity;
  let lo0 = Infinity;
  let lo1 = -Infinity;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const a = lat[i];
    const o = lon[i];
    if (!Number.isFinite(a) || !Number.isFinite(o) || Math.abs(a) > 90) continue;
    la0 = Math.min(la0, a);
    la1 = Math.max(la1, a);
    lo0 = Math.min(lo0, o);
    lo1 = Math.max(lo1, o);
    count++;
  }
  if (count < 2) return null;
  const midLat = (la0 + la1) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  const spanX = Math.max((lo1 - lo0) * kx, 50);
  const spanY = Math.max((la1 - la0) * ky, 50);
  const pad = 14;
  const s = Math.min((width - 2 * pad) / spanX, (height - 2 * pad - 10) / spanY);
  const ox = pad + (width - 2 * pad - spanX * s) / 2;
  const oy = pad + (height - 2 * pad - 10 - spanY * s) / 2;
  const at = (i: number) => {
    if (i < 0 || i >= n) return null;
    const a = lat[i];
    const o = lon[i];
    if (!Number.isFinite(a) || !Number.isFinite(o)) return null;
    return { x: ox + (o - lo0) * kx * s, y: oy + (la1 - a) * ky * s };
  };
  const nearest = (px: number, py: number) => {
    let best = 0;
    let dist = Infinity;
    const step = Math.max(1, Math.floor(n / 4000));
    for (let i = 0; i < n; i += step) {
      const p = at(i);
      if (!p) continue;
      const d = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    return best;
  };
  return { at, nearest, metresPerPx: 1 / s };
}
