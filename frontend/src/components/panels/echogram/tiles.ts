/**
 * The arithmetic of the echogram: which tiles a view needs, what a tile's
 * bytes are, where a ping and a depth land on the screen. No DOM here, so it
 * is tested on its own (tests/echogram.test.ts).
 *
 * Coordinates. x is the ping axis: ping i covers [i, i + 1). y is metres
 * (depth, or range when the product has no depth): sample k of a channel
 * covers [start + (k - ½)·step, start + (k + ½)·step). A view is a window
 * {x0, x1, y0, y1} in those units, shared by every channel row.
 *
 * A level l cell averages fx pings by fy samples; tile (tx, ty) of a level
 * holds T×T cells, rows = range (top first), columns = pings.
 */

import type { PackChannel, PackLevel, PackManifest } from '../../../services/echoviewApi';

export interface View {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface TileKey {
  channel: number;
  level: number;
  tx: number;
  ty: number;
}

export const keyOf = (k: TileKey) => `${k.channel}/${k.level}/${k.tx}/${k.ty}`;

/* ------------------------------------------------------------------ */
/* Decoding                                                            */
/* ------------------------------------------------------------------ */

/** Undo the pack's byte shuffle (all low bytes, then all high bytes). */
export function unshuffle16(bytes: Uint8Array, count: number): Uint16Array {
  const out = new Uint16Array(count);
  for (let i = 0; i < count; i++) out[i] = bytes[i] | (bytes[count + i] << 8);
  return out;
}

/** A tile's inflated bytes as values (NaN: no data). */
export function decodeTile(manifest: Pick<PackManifest, 'dtype' | 'quant' | 'shuffle' | 'tile'>, data: ArrayBuffer | null): Float32Array {
  const n = manifest.tile * manifest.tile;
  const out = new Float32Array(n);
  if (!data) {
    out.fill(NaN);
    return out;
  }
  if (manifest.dtype === 'float32') {
    out.set(new Float32Array(data.slice(0, n * 4)));
    return out;
  }
  const bytes = new Uint8Array(data);
  const q = manifest.shuffle ? unshuffle16(bytes, n) : new Uint16Array(data.slice(0, n * 2));
  const { offset, scale } = manifest.quant ?? { offset: 0, scale: 1 };
  for (let i = 0; i < n; i++) {
    const v = q[i];
    out[i] = v === 0 ? NaN : offset + (v - 1) * scale;
  }
  return out;
}

/** Ms-since-1970 values (or degrees) of an axis blob. */
export function decodeAxis(data: ArrayBuffer | null): Float64Array {
  return data ? new Float64Array(data) : new Float64Array(0);
}

/* ------------------------------------------------------------------ */
/* Levels and visible tiles                                            */
/* ------------------------------------------------------------------ */

/** The extent, in view units, of one cell row/column edge of a level. */
export function cellEdges(ch: PackChannel, lv: PackLevel) {
  return {
    /** x of the left edge of cell column cx. */
    x: (cx: number) => cx * lv.fx,
    /** y of the top edge of cell row r. */
    y: (r: number) => ch.y.start + (r * lv.fy - 0.5) * ch.y.step,
  };
}

/**
 * The level to draw: the coarsest one still at least as fine as the screen
 * (a cell no larger than ~1.5 pixels each way). Zoomed past full resolution:
 * level 0.
 */
export function chooseLevel(ch: PackChannel, view: View, widthPx: number, heightPx: number): number {
  const pingsPerPx = Math.max((view.x1 - view.x0) / Math.max(1, widthPx), 1e-9);
  const samplesPerPx = Math.max((view.y1 - view.y0) / ch.y.step / Math.max(1, heightPx), 1e-9);
  for (let i = ch.levels.length - 1; i >= 0; i--) {
    const lv = ch.levels[i];
    // A factor of 1 is as fine as that axis gets, so it is always fine enough:
    // a long stretch in a tall panel still uses a level averaged in time.
    if (lv.fx <= Math.max(1, pingsPerPx * 1.5) && lv.fy <= Math.max(1, samplesPerPx * 1.5)) return i;
  }
  return 0;
}

/** The tiles of one level a view touches, row-major, nearest the centre first. */
export function visibleTiles(ch: PackChannel, level: number, tile: number, view: View): TileKey[] {
  const lv = ch.levels[level];
  if (!lv) return [];
  const cx0 = Math.floor(view.x0 / lv.fx);
  const cx1 = Math.ceil(view.x1 / lv.fx);
  const rowOf = (y: number) => (y - ch.y.start) / ch.y.step / lv.fy + 0.5 / lv.fy;
  const r0 = Math.floor(rowOf(view.y0));
  const r1 = Math.ceil(rowOf(view.y1));
  const tx0 = Math.max(0, Math.floor(cx0 / tile));
  const tx1 = Math.min(lv.tilesX - 1, Math.floor((cx1 - 1) / tile));
  const ty0 = Math.max(0, Math.floor(r0 / tile));
  const ty1 = Math.min(lv.tilesY - 1, Math.floor((r1 - 1) / tile));
  const out: TileKey[] = [];
  for (let ty = ty0; ty <= ty1; ty++)
    for (let tx = tx0; tx <= tx1; tx++) out.push({ channel: ch.index, level, tx, ty });
  const mx = (tx0 + tx1) / 2;
  const my = (ty0 + ty1) / 2;
  return out.sort((a, b) => Math.hypot(a.tx - mx, a.ty - my) - Math.hypot(b.tx - mx, b.ty - my));
}

/** Where a tile lands, in view units: {x0, x1, y0, y1}. */
export function tileExtent(ch: PackChannel, level: number, tile: number, tx: number, ty: number): View {
  const lv = ch.levels[level];
  const edge = cellEdges(ch, lv);
  return {
    x0: edge.x(tx * tile),
    x1: edge.x((tx + 1) * tile),
    y0: edge.y(ty * tile),
    y1: edge.y((ty + 1) * tile),
  };
}

/** The cell of a level under a view point, or null outside the data. */
export function cellAt(ch: PackChannel, level: number, x: number, y: number) {
  const lv = ch.levels[level];
  if (!lv) return null;
  const cx = Math.floor(x / lv.fx);
  const row = Math.floor((y - ch.y.start) / ch.y.step / lv.fy + 0.5 / lv.fy);
  if (cx < 0 || row < 0 || cx >= lv.width || row >= lv.height) return null;
  return { cx, row, lv };
}

/** The whole data extent of a pack, in view units. */
export function fullExtent(manifest: PackManifest): View {
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const ch of manifest.channels) {
    y0 = Math.min(y0, ch.y.start - ch.y.step / 2);
    y1 = Math.max(y1, ch.y.start + (ch.y.count - 0.5) * ch.y.step);
  }
  if (!Number.isFinite(y0)) [y0, y1] = [0, 1];
  return { x0: 0, x1: Math.max(1, manifest.x.count), y0, y1 };
}

/* ------------------------------------------------------------------ */
/* View changes                                                        */
/* ------------------------------------------------------------------ */

/** Zoom by `factor` (<1: in) about (cx, cy), each axis optionally. */
export function zoomAbout(view: View, cx: number, cy: number, fx: number, fy: number, bounds: View): View {
  const next = {
    x0: cx - (cx - view.x0) * fx,
    x1: cx + (view.x1 - cx) * fx,
    y0: cy - (cy - view.y0) * fy,
    y1: cy + (view.y1 - cy) * fy,
  };
  return clampView(next, bounds);
}

export function panBy(view: View, dx: number, dy: number, bounds: View): View {
  return clampView({ x0: view.x0 + dx, x1: view.x1 + dx, y0: view.y0 + dy, y1: view.y1 + dy }, bounds);
}

/**
 * Keep a view inside the data (a little margin allowed) and no smaller than
 * a handful of pings by a few samples, nor larger than the data.
 */
export function clampView(view: View, bounds: View, minW = 8, minH = 0.5): View {
  let { x0, x1, y0, y1 } = view;
  const bw = bounds.x1 - bounds.x0;
  const bh = bounds.y1 - bounds.y0;
  const w = Math.min(Math.max(x1 - x0, minW), bw);
  const h = Math.min(Math.max(y1 - y0, minH), bh);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  x0 = cx - w / 2;
  x1 = cx + w / 2;
  y0 = cy - h / 2;
  y1 = cy + h / 2;
  if (x0 < bounds.x0) [x0, x1] = [bounds.x0, bounds.x0 + w];
  if (x1 > bounds.x1) [x0, x1] = [bounds.x1 - w, bounds.x1];
  if (y0 < bounds.y0) [y0, y1] = [bounds.y0, bounds.y0 + h];
  if (y1 > bounds.y1) [y0, y1] = [bounds.y1 - h, bounds.y1];
  return { x0, x1, y0, y1 };
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

/** The time (ms) at a fractional ping position (the middle of ping i is i + ½). */
export function timeAt(times: Float64Array, x: number): number {
  const n = times.length;
  if (n === 0) return NaN;
  const p = x - 0.5;
  if (p <= 0) return times[0] + (n > 1 ? p * (times[1] - times[0]) : 0);
  if (p >= n - 1) return times[n - 1] + (n > 1 ? (p - (n - 1)) * (times[n - 1] - times[n - 2]) : 0);
  const i = Math.floor(p);
  return times[i] + (p - i) * (times[i + 1] - times[i]);
}

/** The fractional ping position of a time (inverse of timeAt; times increase). */
export function pingAt(times: Float64Array, t: number): number {
  const n = times.length;
  if (n === 0) return NaN;
  if (n === 1) return 0.5;
  if (t <= times[0]) return 0.5 + (t - times[0]) / (times[1] - times[0] || 1);
  if (t >= times[n - 1]) return n - 0.5 + (t - times[n - 1]) / (times[n - 1] - times[n - 2] || 1);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  const span = times[hi] - times[lo];
  return 0.5 + lo + (span > 0 ? (t - times[lo]) / span : 0);
}

/* ------------------------------------------------------------------ */
/* Axis ticks                                                          */
/* ------------------------------------------------------------------ */

/** Round tick values between a and b, about `count` of them. */
export function niceTicks(a: number, b: number, count: number): number[] {
  if (!(b > a)) return [];
  const raw = (b - a) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step) out.push(Number(v.toFixed(10)));
  return out;
}

const TIME_STEPS_S = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400];

/** Clock-aligned ticks (ms) between t0 and t1, about `count` of them. */
export function timeTicks(t0: number, t1: number, count: number): number[] {
  if (!(t1 > t0)) return [];
  const raw = (t1 - t0) / 1000 / Math.max(1, count);
  const step = (TIME_STEPS_S.find((s) => s >= raw) ?? 86400) * 1000;
  const out: number[] = [];
  for (let t = Math.ceil(t0 / step) * step; t <= t1; t += step) out.push(t);
  return out;
}

export function formatTime(ms: number, withSeconds = true): string {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return withSeconds ? `${hm}:${pad(d.getUTCSeconds())}` : hm;
}

export function formatDateTime(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  const d = new Date(ms);
  return `${d.toISOString().slice(0, 10)} ${formatTime(ms)}.${String(d.getUTCMilliseconds()).padStart(3, '0')} UTC`;
}

/* ------------------------------------------------------------------ */
/* Display defaults                                                    */
/* ------------------------------------------------------------------ */

/** Starting thresholds: Echoview's familiar -70..-34 dB for Sv; the data's
 *  own 2-98% for anything else; 0..1 for a mask. */
export function defaultRange(manifest: PackManifest): [number, number] {
  if (manifest.nature === 'mask') return [0, 1];
  if (manifest.nature === 'db') {
    if (['Sv', 'Sv_corrected', 'MVBS', 'Sv_clean'].includes(manifest.variable)) return [-70, -34];
    const p02 = Math.min(...manifest.channels.map((c) => c.stats.p02 ?? -90));
    const p98 = Math.max(...manifest.channels.map((c) => c.stats.p98 ?? -30));
    return [Math.round(p02), Math.round(p98)];
  }
  const lo = Math.min(...manifest.channels.map((c) => c.stats.min ?? 0));
  const hi = Math.max(...manifest.channels.map((c) => c.stats.max ?? 1));
  return [lo, hi > lo ? hi : lo + 1];
}
