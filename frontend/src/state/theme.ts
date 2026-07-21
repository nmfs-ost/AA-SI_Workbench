import { useSyncExternalStore } from 'react';

import type { ThemeMode } from '../types';

/**
 * The active palette.
 *
 * A module store rather than React context, for the same reason as every other
 * store here: it is read by the root (which builds the MUI theme), by the menu
 * bar (which ticks the current one), and by the dock (which picks a Dockview
 * base class), and a store reaches all three without any of them having to be
 * arranged in a particular order relative to a provider.
 *
 * The choice is remembered, because a theme you have to re-pick every morning
 * is a theme nobody uses. A corrupt or unavailable localStorage falls back to
 * dark rather than throwing — the workstation is sometimes reached over
 * plain-HTTP localhost, where storage can be restricted.
 */

const STORAGE_KEY = 'aa-si.theme-mode';

function load(): ThemeMode {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch {
    return 'dark';
  }
}

let mode: ThemeMode = load();
const listeners = new Set<() => void>();

export function getThemeMode(): ThemeMode {
  return mode;
}

export function setThemeMode(next: ThemeMode): void {
  if (next === mode) return;
  mode = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Best-effort persistence; the session still switches.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe a component to the active palette. */
export function useThemeMode(): ThemeMode {
  return useSyncExternalStore(subscribe, getThemeMode, getThemeMode);
}
