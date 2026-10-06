/**
 * Colour schemes for echograms, as 256-entry RGBA lookup tables.
 *
 * EK500 is the Simrad EK500 colour table, the scheme Echoview, pyEcholab and
 * a generation of acousticians read echograms in: thirteen discrete steps,
 * white (weakest) through greys, blues, greens, yellow, orange, pink, red to
 * browns (strongest). The others are continuous.
 */

export type ColormapId = 'ek500' | 'viridis' | 'inferno' | 'ocean' | 'grey';

export const COLORMAPS: { id: ColormapId; label: string }[] = [
  { id: 'ek500', label: 'EK500' },
  { id: 'viridis', label: 'Viridis' },
  { id: 'inferno', label: 'Inferno' },
  { id: 'ocean', label: 'Ocean' },
  { id: 'grey', label: 'Grey' },
];

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

const VIRIDIS: RGB[] = [
  [68, 1, 84],
  [72, 40, 120],
  [62, 74, 137],
  [49, 104, 142],
  [38, 130, 142],
  [31, 158, 137],
  [53, 183, 121],
  [109, 205, 89],
  [180, 222, 44],
  [253, 231, 37],
];

const INFERNO: RGB[] = [
  [0, 0, 4],
  [31, 12, 72],
  [85, 15, 109],
  [136, 34, 106],
  [186, 54, 85],
  [227, 89, 51],
  [249, 140, 10],
  [249, 201, 50],
  [252, 255, 164],
];

const OCEAN: RGB[] = [
  [10, 20, 40],
  [16, 52, 96],
  [20, 96, 140],
  [30, 150, 160],
  [110, 200, 150],
  [210, 230, 120],
  [255, 220, 90],
  [255, 150, 60],
  [230, 70, 50],
];

const GREY: RGB[] = [
  [20, 20, 20],
  [245, 245, 245],
];

function continuous(stops: RGB[]): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(256 * 4);
  for (let i = 0; i < 256; i++) {
    const f = (i / 255) * (stops.length - 1);
    const a = Math.floor(f);
    const b = Math.min(stops.length - 1, a + 1);
    const t = f - a;
    for (let k = 0; k < 3; k++) lut[i * 4 + k] = stops[a][k] + (stops[b][k] - stops[a][k]) * t;
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

const cache = new Map<ColormapId, Uint8ClampedArray>();

export function lut(id: ColormapId): Uint8ClampedArray {
  let table = cache.get(id);
  if (!table) {
    table =
      id === 'ek500'
        ? discrete(EK500)
        : continuous({ viridis: VIRIDIS, inferno: INFERNO, ocean: OCEAN, grey: GREY }[id]);
    cache.set(id, table);
  }
  return table;
}

/** A CSS gradient of a scheme, for the colour bar. */
export function cssGradient(id: ColormapId, direction = 'to right'): string {
  const table = lut(id);
  const stops: string[] = [];
  const n = id === 'ek500' ? EK500.length : 12;
  for (let i = 0; i < n; i++) {
    const a = Math.round((i / n) * 255);
    const b = Math.round(((i + 1) / n) * 255) - 1;
    const color = (k: number) => `rgb(${table[k * 4]},${table[k * 4 + 1]},${table[k * 4 + 2]})`;
    if (id === 'ek500') stops.push(`${color(a)} ${(i / n) * 100}%`, `${color(a)} ${((i + 1) / n) * 100}%`);
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
