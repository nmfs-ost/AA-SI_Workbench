import { describe, expect, it } from 'vitest';

import fixture from './fixtures/tilepack.json';
import { inflate, type PackManifest } from '../src/services/echoviewApi';
import {
  cellAt,
  chooseLevel,
  clampView,
  decodeAxis,
  decodeTile,
  fullExtent,
  niceTicks,
  pingAt,
  tileExtent,
  timeAt,
  timeTicks,
  unshuffle16,
  visibleTiles,
  zoomAbout,
  defaultRange,
} from '../src/components/panels/echogram/tiles';
import { lut, paint } from '../src/components/panels/echogram/colormaps';
import {
  depthAt,
  drawOver,
  markSpan,
  normalizeLine,
  offsetLine,
  pointInPolygon,
  rectangle,
  removeSpan,
  sameLine,
  simplify,
  nextRegionId,
} from '../src/components/panels/echogram/shapes';
import { project, scaleBar } from '../src/components/panels/echogram/TrackMap';
import { layers, place } from '../src/components/panels/dataflow/layout';
import { isAnnotation, opensAsEchogram, opensAsResults } from '../src/components/panels/echogram/openers';

/**
 * The echogram's arithmetic, and the one thing two languages must agree on:
 * a tile pack written by aa-tiles (Python) decodes in the browser to the
 * values aalibrary's own reader gives. The fixture is a real 40-ping, two
 * channel pack (tests/fixtures/tilepack.json: one tile's raw zlib bytes and
 * the reader's values for it), so a change to the format on either side fails
 * here rather than as a wrong colour on someone's survey.
 */

const manifest = fixture.manifest as unknown as PackManifest;
const b64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0)).buffer;

describe('tile pack decoding (aa-tiles → browser)', () => {
  it('decodes every fixture tile to the values aalibrary reads', async () => {
    for (const t of fixture.tiles) {
      const values = decodeTile(manifest, await inflate(b64(t.raw)));
      expect(values.length).toBe(manifest.tile * manifest.tile);
      t.values.forEach((want, i) => {
        if (want === null) expect(Number.isNaN(values[i])).toBe(true);
        else expect(values[i]).toBeCloseTo(want, 3);
      });
    }
  });

  it('keeps level-0 values within the quantization step of the source', async () => {
    const t = fixture.tiles[0];
    const values = decodeTile(manifest, await inflate(b64(t.raw)));
    const step = manifest.quant!.scale;
    // Rows are range, columns pings: the source was written transposed the same way.
    fixture.source00.forEach((want, i) => {
      if (want === null) expect(Number.isNaN(values[i])).toBe(true);
      else expect(Math.abs(values[i] - want)).toBeLessThanOrEqual(step / 2 + 1e-4);
    });
  });

  it('reads the time axis', async () => {
    const times = decodeAxis(await inflate(b64(fixture.timeRaw)));
    expect(Array.from(times)).toEqual(fixture.timeMs);
    expect(times[1] - times[0]).toBe(1500);
  });

  it('treats a missing tile as no data', () => {
    const values = decodeTile(manifest, null);
    expect(values.every((v) => Number.isNaN(v))).toBe(true);
  });

  it('unshuffles low bytes then high bytes', () => {
    const out = unshuffle16(new Uint8Array([1, 2, 0, 1]), 2);
    expect(Array.from(out)).toEqual([1, 258]);
  });
});

describe('levels, tiles and cells', () => {
  const ch = manifest.channels[0];
  const T = manifest.tile;

  it('covers the whole data with the full extent', () => {
    const v = fullExtent(manifest);
    expect(v.x0).toBe(0);
    expect(v.x1).toBe(40);
    expect(v.y0).toBeCloseTo(1 - 0.25);
    expect(v.y1).toBeCloseTo(1 + 29.5 * 0.5);
  });

  it('chooses full resolution when zoomed in and coarser levels when not', () => {
    const all = fullExtent(manifest);
    expect(chooseLevel(ch, all, 400, 300)).toBe(0);
    expect(chooseLevel(ch, all, 10, 8)).toBe(2);
    expect(chooseLevel(ch, all, 20, 300)).toBe(1);
  });

  it('lists only the tiles a view touches', () => {
    const tiles = visibleTiles(ch, 0, T, { x0: 0, x1: 10, y0: 0, y1: 5 });
    expect(tiles.map((t) => [t.channel, t.tx, t.ty])).toEqual([[0, 0, 0]]);
    expect(visibleTiles(manifest.channels[1], 0, T, { x0: 0, x1: 10, y0: 0, y1: 5 })[0].channel).toBe(1);
    const all = visibleTiles(ch, 0, T, fullExtent(manifest));
    expect(all.length).toBe(ch.levels[0].tilesX * ch.levels[0].tilesY);
  });

  it('puts a cell where its tile says it is', () => {
    // Sample 20 of ping 17: depth 1 + 20 * 0.5 = 11 m.
    const cell = cellAt(ch, 0, 17.3, 11.1)!;
    expect(cell.cx).toBe(17);
    expect(cell.row).toBe(20);
    const ext = tileExtent(ch, 0, T, Math.floor(cell.cx / T), Math.floor(cell.row / T));
    expect(17.3).toBeGreaterThanOrEqual(ext.x0);
    expect(17.3).toBeLessThan(ext.x1);
    expect(11.1).toBeGreaterThanOrEqual(ext.y0);
    expect(11.1).toBeLessThan(ext.y1);
    expect(cellAt(ch, 0, -1, 11)).toBeNull();
    expect(cellAt(ch, 0, 5, 100)).toBeNull();
  });

  it('starts Sv at Echoview’s -70..-34 dB', () => {
    expect(defaultRange(manifest)).toEqual([-70, -34]);
    expect(defaultRange({ ...manifest, nature: 'mask' })).toEqual([0, 1]);
  });
});

describe('view changes', () => {
  const bounds = { x0: 0, x1: 1000, y0: 0, y1: 200 };

  it('zooms about the cursor, keeping it in place', () => {
    const v = zoomAbout({ x0: 100, x1: 300, y0: 10, y1: 110 }, 150, 60, 0.5, 0.5, bounds);
    expect(v).toEqual({ x0: 125, x1: 225, y0: 35, y1: 85 });
  });

  it('stays inside the data and no smaller than a few pings', () => {
    expect(clampView({ x0: -50, x1: 50, y0: 0, y1: 10 }, bounds)).toEqual({ x0: 0, x1: 100, y0: 0, y1: 10 });
    const tiny = clampView({ x0: 10, x1: 11, y0: 5, y1: 5.1 }, bounds);
    expect(tiny.x1 - tiny.x0).toBe(8);
    expect(tiny.y1 - tiny.y0).toBe(0.5);
    const huge = clampView({ x0: -1e6, x1: 1e6, y0: -1e6, y1: 1e6 }, bounds);
    expect(huge).toEqual(bounds);
  });
});

describe('time', () => {
  const times = new Float64Array([1000, 2000, 3000, 5000]);

  it('maps pings to times and back', () => {
    expect(timeAt(times, 0.5)).toBe(1000);
    expect(timeAt(times, 1.0)).toBe(1500);
    expect(timeAt(times, 3.5)).toBe(5000);
    for (const t of [1000, 1700, 3000, 4200, 5000]) expect(timeAt(times, pingAt(times, t))).toBeCloseTo(t);
  });

  it('makes round ticks', () => {
    expect(niceTicks(0, 100, 5)).toEqual([0, 20, 40, 60, 80, 100]);
    expect(niceTicks(3, 7.2, 4)).toEqual([4, 6]);
    const ticks = timeTicks(Date.UTC(2024, 0, 1, 12, 3, 10), Date.UTC(2024, 0, 1, 12, 40), 4);
    expect(ticks.every((t) => t % (10 * 60_000) === 0)).toBe(true);
    expect(ticks.length).toBe(4);
  });
});

describe('colour', () => {
  const p = { colormap: 'ek500' as const, vmin: -70, vmax: -34, belowMin: 'background' as const };

  it('leaves no data and below-threshold samples clear', () => {
    const out = new Uint8ClampedArray(4 * 4);
    paint(new Float32Array([NaN, -80, -70, -20]), out, p);
    expect(out[3]).toBe(0);
    expect(out[7]).toBe(0);
    expect(out[11]).toBe(255);
    expect(out[15]).toBe(255);
    const table = lut('ek500');
    expect(Array.from(out.slice(8, 11))).toEqual(Array.from(table.slice(0, 3)));
    expect(Array.from(out.slice(12, 15))).toEqual(Array.from(table.slice(255 * 4, 255 * 4 + 3)));
  });

  it('can show below-threshold samples in the lowest colour', () => {
    const out = new Uint8ClampedArray(4);
    paint(new Float32Array([-90]), out, { ...p, belowMin: 'lowest' });
    expect(out[3]).toBe(255);
  });
});

describe('lines and regions', () => {
  const line = [
    { t: 0, depth: 50 },
    { t: 10, depth: 52 },
    { t: 20, depth: 54 },
    { t: 30, depth: 56 },
  ];

  it('replaces the drawn-over stretch, keeping the rest', () => {
    const out = drawOver(line, [
      { t: 18, depth: 40 },
      { t: 12, depth: 41 },
    ]);
    expect(out.map((p) => p.t)).toEqual([0, 10, 12, 18, 20, 30]);
    expect(depthAt(out, 15)).toBeCloseTo(40.5);
  });

  it('interpolates depth and holds it past the ends', () => {
    expect(depthAt(line, 5)).toBe(51);
    expect(depthAt(line, -5)).toBe(50);
    expect(depthAt(line, 99)).toBe(56);
  });

  it('marks, removes and shifts stretches', () => {
    expect(markSpan(line, 25, 5, 2).map((p) => p.status ?? 3)).toEqual([3, 2, 2, 3]);
    expect(removeSpan(line, 5, 25).map((p) => p.t)).toEqual([0, 30]);
    expect(offsetLine(line, -1, [10, 20]).map((p) => p.depth)).toEqual([50, 51, 53, 56]);
    expect(sameLine(line, normalizeLine([...line].reverse()))).toBe(true);
  });

  it('thins a stroke but keeps its corners', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0.1 },
      { x: 2, y: 0 },
      { x: 3, y: 5 },
      { x: 4, y: 0 },
    ];
    expect(simplify(pts, 0.5)).toEqual([0, 2, 3, 4]);
  });

  it('makes rectangles and finds what is inside', () => {
    const r = rectangle(nextRegionId([]), { t: 20, depth: 9 }, { t: 10, depth: 3 });
    expect(r.id).toBe(1);
    expect(r.points[0]).toEqual({ t: 10, depth: 3 });
    const poly = r.points.map((q) => ({ x: q.t, y: q.depth }));
    expect(pointInPolygon({ x: 15, y: 5 }, poly)).toBe(true);
    expect(pointInPolygon({ x: 25, y: 5 }, poly)).toBe(false);
    expect(nextRegionId([r, { ...r, id: 7 }])).toBe(8);
  });
});

describe('track map', () => {
  it('projects a track and picks a round scale', () => {
    const lat = new Float64Array([45, 45.05, 45.1]);
    const lon = new Float64Array([-125, -125, -125]);
    const proj = project(lat, lon, 200, 160)!;
    const a = proj.at(0)!;
    const c = proj.at(2)!;
    expect(c.y).toBeLessThan(a.y); // north is up
    const metres = Math.hypot(c.x - a.x, c.y - a.y) * proj.metresPerPx;
    expect(metres).toBeGreaterThan(10_900);
    expect(metres).toBeLessThan(11_200);
    expect(proj.nearest(c.x, c.y)).toBe(2);
    expect(scaleBar(50, 80)).toEqual({ px: (2 * 1852) / 50, label: '2 nmi' });
    expect(scaleBar(1, 80).label).toBe('50 m');
  });

  it('gives up on a track with no positions', () => {
    expect(project(new Float64Array([NaN]), new Float64Array([NaN]), 100, 100)).toBeNull();
  });
});

describe('dataflow layout', () => {
  const nodes = ['raw', 'ed', 'sv', 'evl', 'csv', 'mvbs'].map((id) => ({ id }));
  const edges = [
    { source: 'raw', target: 'ed' },
    { source: 'ed', target: 'sv' },
    { source: 'sv', target: 'csv' },
    { source: 'evl', target: 'csv' },
    { source: 'sv', target: 'mvbs' },
  ];

  it('puts each product below its deepest input', () => {
    const d = layers(nodes, edges);
    expect(d.get('raw')).toBe(0);
    expect(d.get('evl')).toBe(0);
    expect(d.get('sv')).toBe(2);
    expect(d.get('csv')).toBe(3);
  });

  it('lays rows out inside the width without overlap', () => {
    const { placed, height } = place(nodes, edges, 300);
    const rows = new Map<number, typeof placed>();
    placed.forEach((p) => rows.set(p.row, [...(rows.get(p.row) ?? []), p]));
    for (const row of rows.values()) {
      row.sort((a, b) => a.x - b.x);
      row.forEach((p, i) => {
        expect(p.x).toBeGreaterThanOrEqual(0);
        expect(p.x + p.w).toBeLessThanOrEqual(300);
        if (i) expect(p.x).toBeGreaterThanOrEqual(row[i - 1].x + row[i - 1].w);
      });
    }
    expect(height).toBeGreaterThan(0);
  });

  it('survives a cycle', () => {
    const d = layers([{ id: 'a' }, { id: 'b' }], [
      { source: 'a', target: 'b' },
      { source: 'b', target: 'a' },
    ]);
    expect(d.size).toBe(2);
  });
});

describe('what opens where', () => {
  it('routes products to the right panel', () => {
    expect(opensAsEchogram('sv')).toBe(true);
    expect(opensAsEchogram('', 'x.tiles')).toBe(true);
    expect(opensAsEchogram('echodata')).toBe(false);
    expect(opensAsResults('integration')).toBe(true);
    expect(opensAsResults('', 'cells.csv')).toBe(true);
    expect(isAnnotation('', 'bottom.evl')).toBe(true);
    expect(isAnnotation('sv')).toBe(false);
  });
});
