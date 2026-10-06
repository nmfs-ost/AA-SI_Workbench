/**
 * Tiles in the browser: fetched once, decoded once, painted once per colour
 * setting, kept while there is room.
 *
 * Fetching is limited to a few requests at a time, newest view first: when
 * the view moves on, tiles it no longer needs are dropped from the queue
 * before they are asked for.
 */

import { echogramApi, type PackManifest } from '../../../services/echoviewApi';
import { paint, type Paint } from './colormaps';
import { decodeTile, keyOf, type TileKey } from './tiles';

const MAX_VALUES = 600;
const MAX_PAINTED = 400;
const CONCURRENT = 6;

interface Pending {
  key: TileKey;
  id: string;
}

type Canvas = HTMLCanvasElement | OffscreenCanvas;

export class TileStore {
  readonly manifest: PackManifest;
  private values = new Map<string, Float32Array>();
  private painted = new Map<string, Canvas>();
  private inflight = new Set<string>();
  private failed = new Set<string>();
  private queue: Pending[] = [];
  private listeners = new Set<() => void>();
  private aborter = new AbortController();
  private closed = false;

  /** Called once when the server says the pack was made again (HTTP 409). */
  private onStale: (() => void) | undefined;

  constructor(manifest: PackManifest, onStale?: () => void) {
    this.manifest = manifest;
    this.onStale = onStale;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close(): void {
    this.closed = true;
    this.aborter.abort();
    this.queue = [];
    this.listeners.clear();
  }

  /** The decoded values of a tile, or undefined until it has arrived. */
  get(key: TileKey): Float32Array | undefined {
    const id = keyOf(key);
    const v = this.values.get(id);
    if (v) {
      // Most recently used last.
      this.values.delete(id);
      this.values.set(id, v);
    }
    return v;
  }

  /** Ask for the tiles a view needs (in order of importance); drop the rest. */
  want(keys: TileKey[]): void {
    const needed = keys.filter((k) => {
      const id = keyOf(k);
      return !this.values.has(id) && !this.inflight.has(id) && !this.failed.has(id);
    });
    this.queue = needed.map((key) => ({ key, id: keyOf(key) }));
    this.pump();
  }

  private pump(): void {
    while (!this.closed && this.inflight.size < CONCURRENT && this.queue.length) {
      const next = this.queue.shift()!;
      if (this.values.has(next.id) || this.inflight.has(next.id)) continue;
      this.inflight.add(next.id);
      const { channel, level, tx, ty } = next.key;
      echogramApi
        .tile(this.manifest.uri, this.manifest.generation, channel, level, tx, ty, this.aborter.signal)
        .then((data) => {
          if (this.closed) return;
          this.values.set(next.id, decodeTile(this.manifest, data));
          this.trim();
          this.listeners.forEach((l) => l());
        })
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return;
          this.failed.add(next.id);
          if ((e as { status?: number }).status === 409 && this.onStale) {
            const stale = this.onStale;
            this.onStale = undefined;
            stale();
          }
        })
        .finally(() => {
          this.inflight.delete(next.id);
          this.pump();
        });
    }
  }

  private trim(): void {
    while (this.values.size > MAX_VALUES) {
      const oldest = this.values.keys().next().value as string;
      this.values.delete(oldest);
      for (const k of [...this.painted.keys()]) if (k.startsWith(`${oldest}|`)) this.painted.delete(k);
    }
  }

  /** A tile painted with these colours (a canvas to draw scaled), cached. */
  image(key: TileKey, p: Paint): Canvas | undefined {
    const values = this.get(key);
    if (!values) return undefined;
    const id = `${keyOf(key)}|${p.colormap}|${p.vmin}|${p.vmax}|${p.belowMin}|${p.mask?.join(',') ?? ''}`;
    let canvas = this.painted.get(id);
    if (canvas) {
      this.painted.delete(id);
      this.painted.set(id, canvas);
      return canvas;
    }
    const n = this.manifest.tile;
    canvas = makeCanvas(n, n);
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) return undefined;
    const pixels = ctx.createImageData(n, n);
    paint(values, pixels.data, p);
    ctx.putImageData(pixels, 0, 0);
    this.painted.set(id, canvas);
    while (this.painted.size > MAX_PAINTED) this.painted.delete(this.painted.keys().next().value as string);
    return canvas;
  }

  /** Forget painted tiles (the colours changed). Values stay. */
  repaint(): void {
    this.painted.clear();
  }

  pending(): number {
    return this.inflight.size + this.queue.length;
  }
}

function makeCanvas(w: number, h: number): Canvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
