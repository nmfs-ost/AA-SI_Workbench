import { useSyncExternalStore } from 'react';

/**
 * Cross-panel bridge for "the file the user is currently looking at".
 *
 * The NCEI panel (left dock) and the Metadata panel (right dock) are independent
 * Dockview panels with no parent/child relationship, so they share state through
 * this module-level store rather than React context. When a file is identified
 * in NCEI it calls `setActiveAsset(...)`; the Metadata panel subscribes via
 * `useActiveAsset()` and re-renders. Any future panel can do the same.
 */

export interface AssetMetadata {
  fileName: string;
  vessel: string;
  survey: string;
  sonar: string;
  sizeBytes: number;
  acquiredAt: string; // ISO 8601
  channels: string[];
  /** NCEI S3 object key, e.g. data/raw/{vessel}/{survey}/{sonar}/{file}. */
  s3Path: string;
  source: 'NCEI';
}

let current: AssetMetadata | null = null;
const listeners = new Set<() => void>();

export function setActiveAsset(asset: AssetMetadata | null): void {
  current = asset;
  listeners.forEach((listener) => listener());
}

function getSnapshot(): AssetMetadata | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe a component to the active asset. */
export function useActiveAsset(): AssetMetadata | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
