/**
 * Lines and regions as the Echogram panel edits them, before they are saved
 * as Echoview files (aa-annotate). Pure functions, tested on their own.
 *
 * A line is a list of points (time ms, depth m, status), in time order. It is
 * edited the way Echoview's line pick is: draw over a stretch of it and the
 * points in that stretch are replaced by what was drawn; drag a point to move
 * it; mark a stretch bad or good.
 *
 * Regions are polygons in (time, depth), with a class (the species, say), a
 * type (analysis, bad data, marker...) and a name.
 */

import type { LinePoint, RegionKind, RegionShape } from '../../../services/echoviewApi';

export interface Pt {
  x: number;
  y: number;
}

export const REGION_KINDS: { id: RegionKind; label: string; help: string }[] = [
  { id: 'analysis', label: 'Analysis', help: 'Integrated by region (aa-integrate --regions).' },
  { id: 'bad', label: 'Bad data (no data)', help: 'Left out of integration: no data.' },
  { id: 'bad_empty', label: 'Bad data (empty water)', help: 'Integrated as empty water (zero).' },
  { id: 'marker', label: 'Marker', help: 'A note on the echogram; not used in analysis.' },
  { id: 'fishtrack', label: 'Fish track', help: 'A tracked target.' },
];

export const LINE_STATUS = [
  { id: 3, label: 'Good' },
  { id: 1, label: 'Unverified' },
  { id: 2, label: 'Bad' },
  { id: 0, label: 'None' },
];

/** Points in time order, duplicates in time dropped (the later wins). */
export function normalizeLine(points: LinePoint[]): LinePoint[] {
  const sorted = [...points].filter((p) => Number.isFinite(p.t) && Number.isFinite(p.depth));
  sorted.sort((a, b) => a.t - b.t);
  const out: LinePoint[] = [];
  for (const p of sorted) {
    if (out.length && out[out.length - 1].t === p.t) out[out.length - 1] = p;
    else out.push(p);
  }
  return out;
}

/**
 * Draw over a line: the points between the drawn stretch's first and last
 * times are replaced by the drawn ones (Echoview's line pick). With no line
 * yet, the drawn points are the line.
 */
export function drawOver(line: LinePoint[], drawn: LinePoint[]): LinePoint[] {
  const stroke = normalizeLine(drawn);
  if (stroke.length === 0) return line;
  const t0 = stroke[0].t;
  const t1 = stroke[stroke.length - 1].t;
  const kept = line.filter((p) => p.t < t0 || p.t > t1);
  return normalizeLine([...kept, ...stroke]);
}

/** Set the status of the points in [t0, t1] (bad stretches, verified ones). */
export function markSpan(line: LinePoint[], t0: number, t1: number, status: number): LinePoint[] {
  const [a, b] = t0 <= t1 ? [t0, t1] : [t1, t0];
  return line.map((p) => (p.t >= a && p.t <= b ? { ...p, status } : p));
}

export function removeSpan(line: LinePoint[], t0: number, t1: number): LinePoint[] {
  const [a, b] = t0 <= t1 ? [t0, t1] : [t1, t0];
  return line.filter((p) => p.t < a || p.t > b);
}

/** Shift every point (or those in a span) by `dz` metres. */
export function offsetLine(line: LinePoint[], dz: number, span?: [number, number]): LinePoint[] {
  return line.map((p) =>
    !span || (p.t >= Math.min(...span) && p.t <= Math.max(...span)) ? { ...p, depth: p.depth + dz } : p,
  );
}

/** The line's depth at a time (linear between points, flat past the ends). */
export function depthAt(line: LinePoint[], t: number): number {
  if (line.length === 0) return NaN;
  if (t <= line[0].t) return line[0].depth;
  const last = line[line.length - 1];
  if (t >= last.t) return last.depth;
  let lo = 0;
  let hi = line.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (line[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = line[lo];
  const b = line[hi];
  return a.depth + ((t - a.t) / (b.t - a.t || 1)) * (b.depth - a.depth);
}

/** Ramer-Douglas-Peucker in screen space: a freehand stroke, thinned. */
export function simplify(points: Pt[], tolerance: number): number[] {
  if (points.length <= 2) return points.map((_, i) => i);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let worst = -1;
    let dist = 0;
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance(points[i], points[a], points[b]);
      if (d > dist) {
        dist = d;
        worst = i;
      }
    }
    if (worst >= 0 && dist > tolerance) {
      keep[worst] = 1;
      stack.push([a, worst], [worst, b]);
    }
  }
  const out: number[] = [];
  keep.forEach((k, i) => k && out.push(i));
  return out;
}

export function segmentDistance(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

/** The vertex of a polyline within `tol` pixels of p (the nearest), or -1. */
export function nearestVertex(points: Pt[], p: Pt, tol: number): number {
  let best = -1;
  let dist = tol;
  points.forEach((q, i) => {
    const d = Math.hypot(q.x - p.x, q.y - p.y);
    if (d <= dist) {
      dist = d;
      best = i;
    }
  });
  return best;
}

/** Is p within `tol` pixels of the polyline? */
export function nearPolyline(points: Pt[], p: Pt, tol: number): boolean {
  for (let i = 1; i < points.length; i++) if (segmentDistance(p, points[i - 1], points[i]) <= tol) return true;
  return false;
}

export function pointInPolygon(p: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y || 1e-12) + a.x) inside = !inside;
  }
  return inside;
}

export function nextRegionId(regions: RegionShape[]): number {
  return regions.reduce((m, r) => Math.max(m, r.id), 0) + 1;
}

/** A rectangle region from two corners (time, depth). */
export function rectangle(
  id: number,
  a: { t: number; depth: number },
  b: { t: number; depth: number },
  patch: Partial<RegionShape> = {},
): RegionShape {
  const t0 = Math.min(a.t, b.t);
  const t1 = Math.max(a.t, b.t);
  const d0 = Math.min(a.depth, b.depth);
  const d1 = Math.max(a.depth, b.depth);
  return {
    id,
    name: `Region ${id}`,
    class: '',
    kind: 'analysis',
    notes: [],
    points: [
      { t: t0, depth: d0 },
      { t: t1, depth: d0 },
      { t: t1, depth: d1 },
      { t: t0, depth: d1 },
    ],
    ...patch,
  };
}

/** Region fill colours by type; analysis regions by class (stable per name). */
export function regionColor(region: Pick<RegionShape, 'kind' | 'class'>): string {
  if (region.kind === 'bad') return '#e5534b';
  if (region.kind === 'bad_empty') return '#d9a441';
  if (region.kind === 'marker') return '#c9b6ea';
  if (region.kind === 'fishtrack') return '#7cbdd0';
  const palette = ['#4d8df0', '#3fb950', '#e879b9', '#f2cc60', '#56d4dd', '#ff8c42', '#a371f7', '#9be9a8'];
  let h = 0;
  for (const ch of region.class || '') h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return palette[h % palette.length];
}

export function lineColor(label: string, detected = false): string {
  const l = label.toLowerCase();
  if (l.includes('surface') || l.includes('top')) return '#56d4dd';
  if (detected || l.includes('bottom') || l.includes('seafloor')) return '#ff6b5b';
  return '#f2cc60';
}

/** Are two lines the same (points and statuses)? */
export function sameLine(a: LinePoint[], b: LinePoint[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((p, i) => p.t === b[i].t && p.depth === b[i].depth && (p.status ?? 3) === (b[i].status ?? 3));
}
