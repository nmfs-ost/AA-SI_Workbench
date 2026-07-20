import { useSyncExternalStore } from 'react';

import type { ParamValue } from '../components/panels/calibration/calibrationSchema';

/**
 * Calibration settings, held outside React so edits survive Dockview unmounting
 * a hidden tab. Same module-store pattern as activeAsset / mapTrack / pipelines.
 */

export type CalibrationValues = Record<string, ParamValue>;

let values: CalibrationValues = {};
const listeners = new Set<() => void>();

export function initCalibration(defaults: CalibrationValues): void {
  // Only fills in keys that haven't been set yet, so re-mounting never clobbers edits.
  let changed = false;
  const next = { ...values };
  for (const [key, value] of Object.entries(defaults)) {
    if (!(key in next)) {
      next[key] = value;
      changed = true;
    }
  }
  if (changed) {
    values = next;
    listeners.forEach((listener) => listener());
  }
}

export function setCalibrationValue(id: string, value: ParamValue): void {
  values = { ...values, [id]: value };
  listeners.forEach((listener) => listener());
}

export function resetCalibration(defaults: CalibrationValues): void {
  values = { ...defaults };
  listeners.forEach((listener) => listener());
}

function getSnapshot(): CalibrationValues {
  return values;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useCalibration(): CalibrationValues {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
