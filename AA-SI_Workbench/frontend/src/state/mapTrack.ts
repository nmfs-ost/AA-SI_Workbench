import { useSyncExternalStore } from 'react';

/**
 * Cross-panel bridge for "which file positions to plot on the map".
 *
 * The NCEI panel publishes the coordinates of the files currently in view (the
 * filtered set) plus which one is identified; the Map panel (a separate Dockview
 * panel) subscribes and renders a dot per file, highlighting the active one.
 * Same pattern as the active-asset store.
 */

export interface MapPoint {
  name: string;
  lat: number;
  lon: number;
}

export interface MapTrackState {
  points: MapPoint[];
  activeName: string | null;
  /** Human label for the current selection, e.g. "Reuben Lasker · RL2107 · EK60". */
  label: string | null;
}

const EMPTY: MapTrackState = { points: [], activeName: null, label: null };

let state: MapTrackState = EMPTY;
const listeners = new Set<() => void>();

export function setMapTrack(next: MapTrackState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function clearMapTrack(): void {
  setMapTrack(EMPTY);
}

function getSnapshot(): MapTrackState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useMapTrack(): MapTrackState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
