/**
 * Client for the Echoview-style services: echograms (tile packs), lines and
 * regions, calibration (ECS), the dataflow around a product, tables, and the
 * tool calls behind them. Mirrors backend api/echogram.py, annotations.py,
 * calibration.py, lineage.py, toolcalls.py and products.py (camelCase on the
 * wire, except the tile pack's own header, which is aalibrary's).
 */

import { ApiError, type ProductInfo } from './pipelinesApi';

const API_BASE = (import.meta.env.VITE_AASI_API_BASE ?? '').replace(/\/$/, '');

/* ------------------------------------------------------------------ */
/* Tile packs                                                          */
/* ------------------------------------------------------------------ */

export interface EchogramStatus {
  uri: string;
  name: string;
  kind: string;
  state: 'ready' | 'making' | 'failed' | 'unsupported';
  tiles: string;
  detail: string;
  callId: string;
  jobId: string;
  log: string[];
}

export interface PackLevel {
  level: number;
  fx: number;
  fy: number;
  width: number;
  height: number;
  tilesX: number;
  tilesY: number;
}

export interface PackChannel {
  index: number;
  id: string;
  label: string;
  frequency: number | null;
  y: { name: string; unit: string; start: number; step: number; count: number };
  levels: PackLevel[];
  stats: { min?: number; max?: number; p02?: number; p50?: number; p98?: number };
}

/** The pack's header (aalibrary/console/_tilepack.py), without its index. */
export interface PackManifest {
  format: string;
  uri: string;
  generation: string;
  tile: number;
  dtype: 'uint16' | 'float32';
  quant: { offset: number; scale: number } | null;
  shuffle: boolean;
  reduce: string;
  lag: number;
  variable: string;
  nature: 'db' | 'mask' | 'value';
  unit: string;
  longName: string;
  x: { count: number; dim: string; start: string; end: string };
  axes: Record<string, unknown>;
  channels: PackChannel[];
  product: { name?: string; uri?: string; hash?: string; kind?: string };
}

/* ------------------------------------------------------------------ */
/* Lines and regions                                                   */
/* ------------------------------------------------------------------ */

export interface LinePoint {
  /** ms since 1970, UTC */
  t: number;
  /** metres */
  depth: number;
  /** 0 none, 1 unverified, 2 bad, 3 good */
  status?: number;
}

export type RegionKind = 'analysis' | 'bad' | 'bad_empty' | 'marker' | 'fishtrack';

export interface RegionShape {
  id: number;
  name: string;
  class: string;
  kind: RegionKind;
  notes?: string[];
  points: { t: number; depth: number }[];
}

export type Shapes =
  | { type: 'line'; name: string; points: LinePoint[]; count?: number; detected?: boolean; uri?: string }
  | { type: 'regions'; name: string; regions: RegionShape[]; uri?: string };

export interface Annotation {
  uri: string;
  name: string;
  kind: 'lines' | 'regions' | 'seafloor';
  label: string;
  productHash: string;
  createdAt: string;
  createdBy: string;
  drawnOn: string;
  sizeBytes: number;
  latest: boolean;
}

export interface AnnotationList {
  uri: string;
  base: string;
  folders: string[];
  items: Annotation[];
  destination: string;
}

/* ------------------------------------------------------------------ */
/* Tool calls, calibration                                             */
/* ------------------------------------------------------------------ */

export interface ToolCall<T = unknown> {
  id: string;
  tool: string;
  label: string;
  state: 'running' | 'succeeded' | 'failed';
  result: T | null;
  output: string;
  error: string;
  jobId: string;
  log: string[];
  startedAt: number;
}

export interface CalibrationValue {
  name: string;
  group: 'cal' | 'env';
  label: string;
  unit: string;
  file: number | string | null;
  used: number | string | null;
  changed: boolean;
  ecs: string;
}

export interface CalibrationReport {
  sonarModel: string;
  source: 'file' | 'ecs' | 'overrides';
  waveformMode: string;
  encodeMode: string;
  input: string;
  ecs: string;
  channels: { channel: string; frequency: number; values: CalibrationValue[] }[];
}

export interface CalibrationFile {
  uri: string;
  name: string;
  productHash: string;
  createdAt: string;
  createdBy: string;
  label: string;
}

/* ------------------------------------------------------------------ */
/* Lineage, tables                                                     */
/* ------------------------------------------------------------------ */

export interface LineageNode {
  id: string;
  uri: string;
  name: string;
  kind: string;
  level: string;
  tool: string;
  productHash: string;
  createdAt: string;
  createdBy: string;
  relation: 'self' | 'up' | 'down';
  stale: boolean;
  staleReason: string;
  inBucket: boolean;
}

export interface LineageGraph {
  uri: string;
  nodes: LineageNode[];
  edges: { source: string; target: string; role: string }[];
  folders: string[];
  truncated: boolean;
}

export interface ProductTable {
  uri: string;
  columns: string[];
  /** Rows of `frequency` (the first `limit` of `total`). */
  rows: string[][];
  total: number;
  truncated: boolean;
  /** Every frequency in the file (kHz, as written) and the one shown. */
  frequencies: string[];
  frequency: string;
  /** [interval, NASC summed over its layers], over every row of `frequency`. */
  perInterval: [number, number][];
  /** The column summed: PRC_NASC in region-cell exports, else NASC. */
  nascColumn: string;
  detail: string;
}

/* ------------------------------------------------------------------ */
/* Calls                                                               */
/* ------------------------------------------------------------------ */

async function raw(path: string, init?: RequestInit, signal?: AbortSignal): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      signal,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    throw new Error('Could not reach the Workbench server.');
  }
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      /* the status line is all there is */
    }
    throw new ApiError(detail, response.status);
  }
  return response;
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  return (await (await raw(path, init)).json()) as T;
}

const post = <T>(path: string, body: unknown) =>
  json<T>(path, { method: 'POST', body: JSON.stringify(body) });

const q = (uri: string) => `uri=${encodeURIComponent(uri)}`;

/** Inflate a zlib (RFC 1950) blob, as the tile pack stores them. */
export async function inflate(data: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate'));
  return new Response(stream).arrayBuffer();
}

/** A blob from the pack, inflated; null for "no data" (HTTP 204). */
async function blob(path: string, signal?: AbortSignal): Promise<ArrayBuffer | null> {
  const response = await raw(path, undefined, signal);
  if (response.status === 204) return null;
  return inflate(await response.arrayBuffer());
}

export const echogramApi = {
  open: (uri: string, force = false) => post<EchogramStatus>('/api/echogram/open', { uri, force }),
  status: (uri: string) => json<EchogramStatus>(`/api/echogram/status?${q(uri)}`),
  manifest: (tiles: string) => json<PackManifest>(`/api/echogram/manifest?${q(tiles)}`),
  tile: (tiles: string, generation: string, c: number, level: number, x: number, y: number, signal?: AbortSignal) =>
    blob(
      `/api/echogram/tile?${q(tiles)}&g=${encodeURIComponent(generation)}&c=${c}&level=${level}&x=${x}&y=${y}`,
      signal,
    ),
  axis: (tiles: string, generation: string, name: 'time' | 'latitude' | 'longitude') =>
    blob(`/api/echogram/axis?${q(tiles)}&g=${encodeURIComponent(generation)}&name=${name}`),
};

export const annotationsApi = {
  list: (uri: string) => json<AnnotationList>(`/api/annotations?${q(uri)}`),
  /** One line, regions or bottom file, with the product it was drawn on. */
  one: (uri: string) => json<Annotation>(`/api/annotations/one?${q(uri)}`),
  shapes: (uri: string) => json<Shapes>(`/api/annotations/shapes?${q(uri)}`),
  save: (reference: string, shapes: Shapes, dest = '') =>
    post<ProductInfo>('/api/annotations/save', { reference, shapes, dest }),
};

export const toolCallsApi = {
  get: <T>(id: string) => json<ToolCall<T>>(`/api/toolcalls/${encodeURIComponent(id)}`),
  /** Follow a call until it ends. */
  async wait<T>(id: string, onTick?: (call: ToolCall<T>) => void, signal?: AbortSignal): Promise<ToolCall<T>> {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const call = await toolCallsApi.get<T>(id);
      onTick?.(call);
      if (call.state !== 'running') return call;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  },
};

export const calibrationApi = {
  report: (uri: string, ecs = '', waveformMode = '', encodeMode = '') =>
    post<ToolCall<CalibrationReport>>('/api/calibration/report', { uri, ecs, waveformMode, encodeMode }),
  write: (body: {
    uri: string;
    values: { channels: { frequency: number; values: Record<string, number> }[] };
    ecs?: string;
    label?: string;
    waveformMode?: string;
    encodeMode?: string;
  }) => post<ToolCall>('/api/calibration/write', body),
  files: (uri: string) =>
    json<{ uri: string; items: CalibrationFile[]; destination: string }>(`/api/calibration/files?${q(uri)}`),
};

export const lineageApi = {
  graph: (uri: string) => json<LineageGraph>(`/api/lineage?${q(uri)}`),
};

export const tablesApi = {
  table: (uri: string, frequency = '', limit = 5000) =>
    json<ProductTable>(`/api/products/table?${q(uri)}&limit=${limit}&frequency=${encodeURIComponent(frequency)}`),
};
