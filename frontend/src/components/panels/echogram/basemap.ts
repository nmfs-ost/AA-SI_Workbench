/**
 * Land outlines for the track map: Natural Earth, as the world-atlas package
 * ships it (TopoJSON), served by the Workbench from public/basemap/ (see the
 * README there). Nothing is fetched from outside the workstation.
 *
 * Three scales: 1:110m for the whole world, 1:50m for a region, 1:10m for a
 * survey close up. The 10m file is 3 MB and is read only when a map zooms in
 * that far; until it arrives the 50m outline stands in.
 */

export type LandLevel = '110m' | '50m' | '10m';

/** One closed ring of a land polygon: lon, lat interleaved, and its box. */
export interface Ring {
  pts: Float64Array;
  lon0: number;
  lat0: number;
  lon1: number;
  lat1: number;
}

interface Topology {
  transform?: { scale: [number, number]; translate: [number, number] };
  arcs: number[][][];
  objects: Record<string, TopoObject>;
}

type TopoObject =
  | { type: 'GeometryCollection'; geometries: TopoObject[] }
  | { type: 'Polygon'; arcs: number[][] }
  | { type: 'MultiPolygon'; arcs: number[][][] }
  | { type: string; arcs?: unknown };

/** The arcs as absolute lon/lat (quantized topologies are delta-encoded). */
function decodeArcs(topology: Topology): Float64Array[] {
  const t = topology.transform;
  return topology.arcs.map((arc) => {
    const out = new Float64Array(arc.length * 2);
    let x = 0;
    let y = 0;
    for (let i = 0; i < arc.length; i++) {
      if (t) {
        x += arc[i][0];
        y += arc[i][1];
        out[i * 2] = x * t.scale[0] + t.translate[0];
        out[i * 2 + 1] = y * t.scale[1] + t.translate[1];
      } else {
        out[i * 2] = arc[i][0];
        out[i * 2 + 1] = arc[i][1];
      }
    }
    return out;
  });
}

/** A ring from its arcs: ~i is arc i reversed; shared end points once. */
function ringOf(indexes: number[], arcs: Float64Array[]): Ring {
  const coords: number[] = [];
  for (const index of indexes) {
    const arc = arcs[index < 0 ? ~index : index];
    const n = arc.length / 2;
    for (let k = 0; k < n; k++) {
      const j = index < 0 ? n - 1 - k : k;
      if (k === 0 && coords.length) continue;
      coords.push(arc[j * 2], arc[j * 2 + 1]);
    }
  }
  // Rings that cross the antimeridian (Fiji, Chukotka) are cut at ±180°
  // in the data; drawn as stored they would close with a line across the
  // world. Made continuous instead (177°..181°), and drawn shifted by 360°
  // where the map needs them. A ring around a pole (Antarctica) spans the
  // whole circle either way and is kept as it is.
  const unwrapped = coords.slice();
  for (let i = 2; i < unwrapped.length; i += 2) {
    const d = unwrapped[i] - unwrapped[i - 2];
    if (d > 180) for (let k = i; k < unwrapped.length; k += 2) unwrapped[k] -= 360;
    else if (d < -180) for (let k = i; k < unwrapped.length; k += 2) unwrapped[k] += 360;
  }
  let span = 0;
  {
    let a = Infinity;
    let b = -Infinity;
    for (let i = 0; i < unwrapped.length; i += 2) {
      a = Math.min(a, unwrapped[i]);
      b = Math.max(b, unwrapped[i]);
    }
    span = b - a;
  }
  const pts = Float64Array.from(span < 350 ? unwrapped : coords);
  let lon0 = Infinity;
  let lat0 = Infinity;
  let lon1 = -Infinity;
  let lat1 = -Infinity;
  for (let i = 0; i < pts.length; i += 2) {
    lon0 = Math.min(lon0, pts[i]);
    lon1 = Math.max(lon1, pts[i]);
    lat0 = Math.min(lat0, pts[i + 1]);
    lat1 = Math.max(lat1, pts[i + 1]);
  }
  return { pts, lon0, lat0, lon1, lat1 };
}

/** Every ring of every land polygon in a topology. */
export function decodeLand(topology: Topology, object = 'land'): Ring[] {
  const arcs = decodeArcs(topology);
  const rings: Ring[] = [];
  const walk = (geometry: TopoObject) => {
    if (geometry.type === 'GeometryCollection') {
      for (const g of (geometry as { geometries: TopoObject[] }).geometries) walk(g);
    } else if (geometry.type === 'Polygon') {
      for (const ring of (geometry as { arcs: number[][] }).arcs) rings.push(ringOf(ring, arcs));
    } else if (geometry.type === 'MultiPolygon') {
      for (const polygon of (geometry as { arcs: number[][][] }).arcs) {
        for (const ring of polygon) rings.push(ringOf(ring, arcs));
      }
    }
  };
  const root = topology.objects[object];
  if (root) walk(root);
  return rings;
}

const cache = new Map<LandLevel, Promise<Ring[]>>();

/** The land at a scale, read once per page. */
export function loadLand(level: LandLevel): Promise<Ring[]> {
  let found = cache.get(level);
  if (!found) {
    const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
    found = fetch(`${base}basemap/land-${level}.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`basemap ${level}: ${r.status}`);
        return r.json() as Promise<Topology>;
      })
      .then((topology) => decodeLand(topology));
    // A failed read is tried again next time, not remembered.
    found.catch(() => cache.delete(level));
    cache.set(level, found);
  }
  return found;
}

/** The scale of outline to draw for a map spanning this many degrees of latitude. */
export function levelFor(spanLat: number): LandLevel {
  if (spanLat > 40) return '110m';
  if (spanLat > 3) return '50m';
  return '10m';
}
