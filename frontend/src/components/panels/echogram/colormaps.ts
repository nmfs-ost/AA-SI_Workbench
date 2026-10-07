/**
 * Colour schemes for echograms, as 256-entry RGBA lookup tables.
 *
 * EK500 is the Simrad EK500 colour table, the scheme Echoview, pyEcholab and
 * a generation of acousticians read echograms in: thirteen discrete steps,
 * white (weakest) through greys, blues, greens, yellow, orange, pink, red to
 * browns (strongest). The rest are Matplotlib's own tables, generated from
 * matplotlib (theme/colormaps.generated.ts), so the viewer draws an Sv in
 * exactly the colours aa-graph --cmap draws it in.
 *
 * "theme" is the colormap of the colormap theme in force (View ▸ Viridis
 * Theme …), and EK500 under the other themes.
 */

import { MATPLOTLIB_COLORMAPS, MATPLOTLIB_TABLES } from '../../../theme/colormaps.generated';

/** 'theme', 'ek500', or a Matplotlib colormap name ('viridis' …). */
export type ColormapId = string;

export const COLORMAPS: { id: ColormapId; label: string }[] = [
  { id: 'ek500', label: 'EK500' },
  ...MATPLOTLIB_COLORMAPS.map(([id, label]) => ({ id, label })),
];

/** Names that earlier versions stored. */
const ALIASES: Record<string, string> = { grey: 'gray' };

/** A colormap the viewer can draw ('ek500' for anything unknown). */
export function knownColormap(id: string): string {
  const name = ALIASES[id] ?? id;
  return name === 'ek500' || name in MATPLOTLIB_TABLES ? name : 'ek500';
}

/** What 'theme' means under a theme: its colormap, or EK500. */
export function resolveColormap(id: ColormapId, themeColormap: string): string {
  return id === 'theme' ? knownColormap(themeColormap || 'ek500') : knownColormap(id);
}

type RGB = [number, number, number];

const EK500: RGB[] = [
  [255, 255, 255],
  [159, 159, 159],
  [95, 95, 95],
  [0, 0, 255],
  [0, 0, 127],
  [0, 191, 0],
  [0, 127, 0],
  [255, 255, 0],
  [255, 127, 0],
  [255, 0, 191],
  [255, 0, 0],
  [166, 83, 60],
  [120, 60, 40],
];

function fromHex(packed: string): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    for (let k = 0; k < 3; k++) lut[i * 4 + k] = parseInt(packed.slice(i * 6 + k * 2, i * 6 + k * 2 + 2), 16);
    lut[i * 4 + 3] = 255;
  }
  return lut;
}

function discrete(stops: RGB[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const k = Math.min(stops.length - 1, Math.floor((i / 256) * stops.length));
    lut.set([...stops[k], 255], i * 4);
  }
  return lut;
}

const cache = new Map<string, Uint8ClampedArray>();

/** The table for a colormap ('theme' must be resolved first). */
export function lut(id: ColormapId): Uint8ClampedArray {
  const name = knownColormap(id);
  let table = cache.get(name);
  if (!table) {
    table = name === 'ek500' ? discrete(EK500) : fromHex(MATPLOTLIB_TABLES[name]);
    cache.set(name, table);
  }
  return table;
}

/** A CSS gradient of a scheme, for the colour bar. */
export function cssGradient(id: ColormapId, direction = 'to right'): string {
  const table = lut(id);
  const stops: string[] = [];
  const name = knownColormap(id);
  const n = name === 'ek500' ? EK500.length : 16;
  for (let i = 0; i < n; i++) {
    const a = Math.round((i / n) * 255);
    const b = Math.round(((i + 1) / n) * 255) - 1;
    const color = (k: number) => `rgb(${table[k * 4]},${table[k * 4 + 1]},${table[k * 4 + 2]})`;
    if (name === 'ek500') stops.push(`${color(a)} ${(i / n) * 100}%`, `${color(a)} ${((i + 1) / n) * 100}%`);
    else stops.push(`${color(Math.min(255, Math.max(0, b)))} ${((i + 0.5) / n) * 100}%`);
  }
  return `linear-gradient(${direction}, ${stops.join(', ')})`;
}

export interface Paint {
  colormap: ColormapId;
  vmin: number;
  vmax: number;
  /** Below the minimum: transparent (the background shows), or the lowest colour. */
  belowMin: 'background' | 'lowest';
  /** Draw a mask: True samples in the accent colour, the rest clear. */
  mask?: [number, number, number];
}

/**
 * Colour a tile's values into RGBA pixels (row-major, tile x tile).
 * NaN (no data) is transparent; so is a value below the minimum unless
 * `belowMin` is 'lowest'.
 */
export function paint(values: Float32Array, out: Uint8ClampedArray, p: Paint): void {
  const table = lut(p.colormap);
  const span = p.vmax - p.vmin || 1;
  const n = values.length;
  if (p.mask) {
    const [r, g, b] = p.mask;
    for (let i = 0; i < n; i++) {
      const v = values[i];
      const o = i * 4;
      if (v !== v || v <= 0) {
        out[o + 3] = 0;
        continue;
      }
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = Math.round(60 + 170 * Math.min(1, v));
    }
    return;
  }
  for (let i = 0; i < n; i++) {
    const v = values[i];
    const o = i * 4;
    if (v !== v || (v < p.vmin && p.belowMin === 'background')) {
      out[o + 3] = 0;
      continue;
    }
    let k = Math.floor(((v - p.vmin) / span) * 256);
    if (k < 0) k = 0;
    else if (k > 255) k = 255;
    const t = k * 4;
    out[o] = table[t];
    out[o + 1] = table[t + 1];
    out[o + 2] = table[t + 2];
    out[o + 3] = 255;
  }
}
