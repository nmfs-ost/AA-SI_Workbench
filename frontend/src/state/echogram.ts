import { useSyncExternalStore } from 'react';

import {
  annotationsApi,
  echogramApi,
  type Annotation,
  type EchogramStatus,
  type LinePoint,
  type PackManifest,
  type RegionShape,
  type Shapes,
} from '../services/echoviewApi';
import { ApiError } from '../services/pipelinesApi';
import { revealInDerived } from './derivedReveal';
import type { ColormapId } from '../components/panels/echogram/colormaps';
import { TileStore } from '../components/panels/echogram/tileStore';
import { decodeAxis, defaultRange, fullExtent, type View } from '../components/panels/echogram/tiles';
import { normalizeLine, sameLine } from '../components/panels/echogram/shapes';

/**
 * The Echogram panel: the product open, its tile pack, the view, the colours,
 * and the lines and regions drawn on it. Held outside React, like the other
 * panels' state, so a hidden tab keeps its view and its unsaved drawing.
 */

export type Tool = 'pan' | 'zoom' | 'line' | 'region' | 'polygon' | 'select';

export interface Layer {
  /** The file's gs:// URI, or new:<n> before it is first saved. */
  key: string;
  type: 'line' | 'regions';
  /** The name it is saved under: bottom, surface, schools. */
  label: string;
  /** The product it was read from (null: drawn here, not saved yet). */
  source: Annotation | null;
  /** Read from a detected bottom (aa-detect-seafloor): saving makes a line file. */
  detected: boolean;
  /** Read thinned (more points than can be edited here): shown, not editable. */
  thinned: number;
  points: LinePoint[];
  regions: RegionShape[];
  /** What was read or last saved, to tell an edit from none. */
  saved: string;
  visible: boolean;
  loading: boolean;
  saving: boolean;
  error: string;
}

export interface EchogramState {
  uri: string;
  status: EchogramStatus | null;
  manifest: PackManifest | null;
  store: TileStore | null;
  times: Float64Array;
  latitude: Float64Array;
  longitude: Float64Array;
  error: string;
  view: View | null;
  bounds: View | null;
  channelsOn: boolean[];
  colormap: ColormapId;
  vmin: number;
  vmax: number;
  belowMin: 'background' | 'lowest';
  tool: Tool;
  layers: Layer[];
  activeLayer: string;
  selected: { layer: string; region: number } | null;
  available: Annotation[];
  availableError: string;
  /** Where a new line or region file is saved. */
  destination: string;
}

const initial: EchogramState = {
  uri: '',
  status: null,
  manifest: null,
  store: null,
  times: new Float64Array(0),
  latitude: new Float64Array(0),
  longitude: new Float64Array(0),
  error: '',
  view: null,
  bounds: null,
  channelsOn: [],
  colormap: 'ek500',
  vmin: -70,
  vmax: -34,
  belowMin: 'background',
  tool: 'pan',
  layers: [],
  activeLayer: '',
  selected: null,
  available: [],
  availableError: '',
  destination: '',
};

let state: EchogramState = initial;
const listeners = new Set<() => void>();

function set(patch: Partial<EchogramState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getEchogram(): EchogramState {
  return state;
}

export function useEchogram(): EchogramState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

const COLOURS_KEY = 'aa-si.echogram.colours';

function rememberedColours(): Partial<EchogramState> {
  try {
    const raw = localStorage.getItem(COLOURS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { colormap?: ColormapId; belowMin?: 'background' | 'lowest' };
    return { colormap: parsed.colormap ?? 'ek500', belowMin: parsed.belowMin ?? 'background' };
  } catch {
    return {};
  }
}

/* ------------------------------------------------------------------ */
/* Opening                                                             */
/* ------------------------------------------------------------------ */

let opening = 0;

/** Open a product (an Sv, MVBS, mask, or a .tiles pack) as an echogram. */
export async function openEchogram(uri: string, force = false): Promise<void> {
  if (!uri) return;
  if (uri === state.uri && state.manifest && !force) return;
  const mine = ++opening;
  state.store?.close();
  set({
    ...initial,
    ...rememberedColours(),
    uri,
    tool: state.tool === 'pan' || state.tool === 'zoom' ? state.tool : 'pan',
  });
  try {
    let status = await echogramApi.open(uri, force);
    if (mine !== opening) return;
    set({ status });
    while (status.state === 'making') {
      await new Promise((r) => setTimeout(r, 1200));
      if (mine !== opening) return;
      status = await echogramApi.status(uri);
      if (mine !== opening) return;
      set({ status });
    }
    if (status.state !== 'ready') {
      set({ error: status.detail || 'The echogram could not be made.' });
      return;
    }
    const manifest = await echogramApi.manifest(status.tiles);
    if (mine !== opening) return;
    const [times, latitude, longitude] = await Promise.all(
      (['time', 'latitude', 'longitude'] as const).map(async (name) =>
        decodeAxis(await echogramApi.axis(status.tiles, manifest.generation, name)),
      ),
    );
    if (mine !== opening) return;
    const [vmin, vmax] = defaultRange(manifest);
    const bounds = fullExtent(manifest);
    set({
      manifest,
      store: storeFor(manifest, uri),
      times,
      latitude,
      longitude,
      bounds,
      view: bounds,
      vmin,
      vmax,
      channelsOn: manifest.channels.map(() => true),
    });
    void loadAnnotations(true);
  } catch (e) {
    if (mine !== opening) return;
    set({ error: e instanceof Error ? e.message : String(e) });
  }
}

function storeFor(manifest: PackManifest, uri: string): TileStore {
  return new TileStore(manifest, () => {
    if (state.uri === uri) set({ error: 'The tiles were made again since this echogram was opened.' });
  });
}

/** Load the pack again (it was remade), keeping the view and the drawing. */
export async function reloadPack(): Promise<void> {
  const uri = state.uri;
  if (!uri) return;
  try {
    const status = await echogramApi.open(uri, false);
    if (state.uri !== uri) return;
    if (status.state !== 'ready') {
      set({ error: status.detail || 'The echogram is being made again; try in a moment.' });
      return;
    }
    const manifest = await echogramApi.manifest(status.tiles);
    if (state.uri !== uri) return;
    state.store?.close();
    set({ manifest, store: storeFor(manifest, uri), error: '' });
  } catch (e) {
    if (state.uri === uri) set({ error: e instanceof Error ? e.message : String(e) });
  }
}

export function closeEchogram(): void {
  opening++;
  state.store?.close();
  set({ ...initial, ...rememberedColours() });
}

/* ------------------------------------------------------------------ */
/* View and colours                                                    */
/* ------------------------------------------------------------------ */

export function setView(view: View): void {
  set({ view });
}

export function fitAll(): void {
  if (state.bounds) set({ view: state.bounds });
}

export function setTool(tool: Tool): void {
  set({ tool });
}

export function setColours(patch: Partial<Pick<EchogramState, 'colormap' | 'vmin' | 'vmax' | 'belowMin'>>): void {
  set(patch);
  try {
    localStorage.setItem(COLOURS_KEY, JSON.stringify({ colormap: state.colormap, belowMin: state.belowMin }));
  } catch {
    /* not remembered: fine */
  }
}

export function toggleChannel(index: number): void {
  const on = [...state.channelsOn];
  on[index] = !on[index];
  if (on.some(Boolean)) set({ channelsOn: on });
}

/* ------------------------------------------------------------------ */
/* Lines and regions                                                   */
/* ------------------------------------------------------------------ */

function contentOf(layer: Pick<Layer, 'type' | 'points' | 'regions'>): string {
  return layer.type === 'line' ? JSON.stringify(layer.points) : JSON.stringify(layer.regions);
}

export function isDirty(layer: Layer): boolean {
  return layer.detected || layer.saved !== contentOf(layer);
}

export async function loadAnnotations(autoload = false): Promise<void> {
  const uri = state.uri;
  if (!uri) return;
  try {
    const list = await annotationsApi.list(uri);
    if (state.uri !== uri) return;
    set({ available: list.items, availableError: '', destination: list.destination });
    if (autoload) {
      // Show the newest of each line and region file; a detected bottom only
      // when there is no saved bottom line.
      const latest = list.items.filter((a) => a.latest && a.kind !== 'seafloor');
      const hasBottom = latest.some((a) => a.kind === 'lines' && a.label.toLowerCase().includes('bottom'));
      const detected = hasBottom ? [] : list.items.filter((a) => a.kind === 'seafloor').slice(0, 1);
      for (const item of [...latest.slice(0, 6), ...detected]) void showAnnotation(item);
    }
  } catch (e) {
    if (state.uri !== uri) return;
    set({ availableError: e instanceof Error ? e.message : String(e) });
  }
}

function patchLayer(key: string, patch: Partial<Layer>): void {
  set({ layers: state.layers.map((l) => (l.key === key ? { ...l, ...patch } : l)) });
}

/** Read a line, regions or detected bottom from the bucket and draw it. */
export async function showAnnotation(item: Annotation): Promise<void> {
  if (state.layers.some((l) => l.key === item.uri)) {
    patchLayer(item.uri, { visible: true });
    return;
  }
  const uri = state.uri;
  const layer: Layer = {
    key: item.uri,
    type: item.kind === 'regions' ? 'regions' : 'line',
    label: item.label || (item.kind === 'seafloor' ? 'bottom' : item.kind),
    source: item,
    detected: item.kind === 'seafloor',
    thinned: 0,
    points: [],
    regions: [],
    saved: '',
    visible: true,
    loading: true,
    saving: false,
    error: '',
  };
  set({ layers: [...state.layers, layer] });
  try {
    const shapes = await annotationsApi.shapes(item.uri);
    if (state.uri !== uri) return;
    if (shapes.type === 'line') {
      const points = normalizeLine(shapes.points);
      const thinned = shapes.count && shapes.count > shapes.points.length ? shapes.count : 0;
      patchLayer(item.uri, { points, saved: JSON.stringify(points), loading: false, thinned });
    } else {
      patchLayer(item.uri, { regions: shapes.regions, saved: JSON.stringify(shapes.regions), loading: false });
    }
  } catch (e) {
    patchLayer(item.uri, { loading: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/**
 * Open a line, regions or bottom file from Products: the echogram it was drawn
 * on, with it shown and active. Throws when the file does not say what it was
 * drawn on (an Echoview file copied into the bucket), so the caller can say so.
 */
export async function openAnnotation(uri: string): Promise<void> {
  const item = await annotationsApi.one(uri);
  if (!item.drawnOn) {
    throw new Error(
      `${item.name} does not record the product it was drawn on. Open that Sv as an echogram, then choose the file under “In the bucket”.`,
    );
  }
  await openEchogram(item.drawnOn);
  if (state.uri !== item.drawnOn || !state.manifest) return;
  await showAnnotation(item);
  set({ activeLayer: item.uri });
}

let newCount = 0;

/** A new, empty line or region layer to draw on; it becomes the active one. */
export function newLayer(type: 'line' | 'regions', label: string): string {
  const key = `new:${++newCount}`;
  const layer: Layer = {
    key,
    type,
    label,
    source: null,
    detected: false,
    thinned: 0,
    points: [],
    regions: [],
    saved: '[]',
    visible: true,
    loading: false,
    saving: false,
    error: '',
  };
  set({ layers: [...state.layers, layer], activeLayer: key });
  return key;
}

export function setActiveLayer(key: string): void {
  set({ activeLayer: key });
}

export function setLayerVisible(key: string, visible: boolean): void {
  patchLayer(key, { visible });
}

export function renameLayer(key: string, label: string): void {
  patchLayer(key, { label: label.replace(/[^A-Za-z0-9_ -]/g, '').slice(0, 40) });
}

export function removeLayer(key: string): void {
  set({
    layers: state.layers.filter((l) => l.key !== key),
    activeLayer: state.activeLayer === key ? '' : state.activeLayer,
    selected: state.selected?.layer === key ? null : state.selected,
  });
}

export function setLinePoints(key: string, points: LinePoint[]): void {
  const layer = state.layers.find((l) => l.key === key);
  if (!layer || layer.thinned || sameLine(layer.points, points)) return;
  patchLayer(key, { points });
}

export function setRegions(key: string, regions: RegionShape[]): void {
  patchLayer(key, { regions });
}

export function updateRegion(key: string, id: number, patch: Partial<RegionShape>): void {
  const layer = state.layers.find((l) => l.key === key);
  if (!layer) return;
  patchLayer(key, { regions: layer.regions.map((r) => (r.id === id ? { ...r, ...patch } : r)) });
}

export function deleteRegion(key: string, id: number): void {
  const layer = state.layers.find((l) => l.key === key);
  if (!layer) return;
  patchLayer(key, { regions: layer.regions.filter((r) => r.id !== id) });
  if (state.selected?.layer === key && state.selected.region === id) set({ selected: null });
}

export function selectRegion(selected: { layer: string; region: number } | null): void {
  set({ selected });
}

export function revertLayer(key: string): void {
  const layer = state.layers.find((l) => l.key === key);
  if (!layer || layer.detected) return;
  if (layer.type === 'line') patchLayer(key, { points: JSON.parse(layer.saved || '[]') as LinePoint[] });
  else patchLayer(key, { regions: JSON.parse(layer.saved || '[]') as RegionShape[] });
}

/** Save a layer to the bucket as an Echoview file (aa-annotate). */
export async function saveLayer(key: string): Promise<void> {
  const layer = state.layers.find((l) => l.key === key);
  if (!layer || !state.uri || layer.thinned || layer.saving) return;
  // What is sent is what is saved: edits made while the save runs stay unsaved.
  const sent = contentOf(layer);
  const name = layer.label.trim().replace(/\s+/g, '_') || (layer.type === 'line' ? 'line' : 'regions');
  const shapes: Shapes =
    layer.type === 'line'
      ? { type: 'line', name, points: layer.points }
      : { type: 'regions', name, regions: layer.regions };
  patchLayer(key, { saving: true, error: '' });
  try {
    const product = await annotationsApi.save(state.uri, shapes);
    const item: Annotation = {
      uri: product.uri,
      name: product.name,
      kind: layer.type === 'line' ? 'lines' : 'regions',
      label: name,
      productHash: product.productHash,
      createdAt: product.createdAt,
      createdBy: product.createdBy,
      drawnOn: state.uri,
      sizeBytes: product.sizeBytes,
      latest: true,
    };
    set({
      layers: state.layers.map((l) =>
        l.key === key
          ? { ...l, key: product.uri, source: item, detected: false, saving: false, saved: sent }
          : l,
      ),
      activeLayer: state.activeLayer === key ? product.uri : state.activeLayer,
      selected: state.selected?.layer === key ? { ...state.selected, layer: product.uri } : state.selected,
    });
    void loadAnnotations(false);
    // Products lists it (the folder is listed afresh, the file picked out).
    revealInDerived(product.uri);
  } catch (e) {
    patchLayer(key, {
      saving: false,
      error: e instanceof ApiError || e instanceof Error ? e.message : String(e),
    });
  }
}

export function _resetForTests(): void {
  state = initial;
}
