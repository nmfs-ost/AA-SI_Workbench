import { useSyncExternalStore } from 'react';

import {
  storeApi,
  type StoreQuery,
  type StoreResult,
} from '../services/storeApi';
import { refineActiveLayer } from './activeSubject';
import type { LayerKind } from '../types/layers';

/**
 * Descriptions of Zarr stores, held outside React.
 *
 * Two reasons this is a module store rather than component state:
 *
 *  • **Dockview unmounts a hidden tab.** Metadata shares the right dock with
 *    three other panels, so switching to Configuration and back would re-run
 *    the describe every time.
 *  • **A census is a full object listing.** On a local store that is cheap; on
 *    a bucket holding a season of chunks the listing *is* the cost. Describing
 *    the same store twice because a tab lost focus is the kind of waste that
 *    only shows up on the storage bill.
 *
 * Entries are keyed by URI and never expire on a timer. A store is an archival
 * artifact — it is written once and read much later — so a cached description
 * going stale needs someone to have written to it, which is what the explicit
 * refresh is for. Verify results are cached separately from info results under
 * the same URI, because they answer different questions and one must not
 * satisfy a request for the other.
 */

export type InspectionPhase = 'idle' | 'loading' | 'ready' | 'error';

export interface Inspection {
  uri: string;
  phase: InspectionPhase;
  /** The last successful `info` result. */
  info: StoreResult | null;
  /** The last `verify` result, when one has been asked for. */
  verify: StoreResult | null;
  /** Transport or runner failure. The tool's own findings live in `verify`. */
  error: string;
  /** True while a verify is in flight, so its button can spin alone. */
  verifying: boolean;
  /** Whether the last info was fetched with the chunk census on. */
  census: boolean;
  fetchedAt: string;
}

const empty: Inspection = {
  uri: '',
  phase: 'idle',
  info: null,
  verify: null,
  error: '',
  verifying: false,
  census: true,
  fetchedAt: '',
};

const cache = new Map<string, Inspection>();
const listeners = new Set<() => void>();
/** URIs with a request in flight, so a re-render cannot start a second one. */
const inFlight = new Set<string>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function put(uri: string, patch: Partial<Inspection>): void {
  const previous = cache.get(uri) ?? { ...empty, uri };
  cache.set(uri, { ...previous, ...patch, uri });
  notify();
}

/**
 * The store's own account of its kind, mapped to the layer vocabulary.
 *
 * `aa-store` spells these to match `types/layers.ts` deliberately — the comment
 * in `aa_store.py` says to keep the two lists identical "or the badges start
 * lying". Unknown values are dropped rather than passed through, so a tool that
 * grows a new kind fails to refine rather than injecting a kind the UI has no
 * definition for.
 */
const KNOWN_LAYERS = new Set<string>([
  'raw',
  'l1',
  'sv',
  'mvbs',
  'mask',
  'regions',
  'lines',
  'nasc',
  'catalog',
  'plan',
  'report',
  'netcdf',
  'image',
]);

async function load(uri: string, options: StoreQuery): Promise<void> {
  if (inFlight.has(uri)) return;
  inFlight.add(uri);
  put(uri, { phase: 'loading', error: '' });
  try {
    const result = await storeApi.info(uri, options);
    put(uri, {
      phase: 'ready',
      info: result,
      census: options.census !== false,
      error: '',
      fetchedAt: new Date().toISOString(),
    });
    // The suffix guess made at selection time said 'l1' for anything .zarr.
    // The store's root attributes are authoritative; correct the badge now
    // that they have arrived.
    const kind = result.summary?.kind;
    if (kind && KNOWN_LAYERS.has(kind)) refineActiveLayer(uri, kind as LayerKind);
  } catch (e) {
    put(uri, { phase: 'error', error: (e as Error).message });
  } finally {
    inFlight.delete(uri);
  }
}

/**
 * Describe a store, using the cached answer when there is one.
 *
 * Safe to call from a render effect on every selection change: `aa-store` never
 * opens a write handle, so a speculative describe cannot damage anything, and
 * the cache plus the in-flight set mean a re-render cannot stampede it.
 */
export function inspectStore(uri: string, options: StoreQuery = {}): void {
  if (!uri) return;
  const existing = cache.get(uri);
  if (existing && existing.phase === 'ready' && existing.census === (options.census !== false)) {
    return;
  }
  void load(uri, options);
}

/** Re-describe, ignoring the cache. For the panel's refresh button. */
export function refreshStore(uri: string, options: StoreQuery = {}): void {
  if (!uri) return;
  cache.delete(uri);
  void load(uri, options);
}

/**
 * Run `aa-store verify`.
 *
 * Kept behind an explicit action rather than fired with `info`, even though it
 * is equally read-only, because its result is a *judgement* and an unasked-for
 * verdict on a store the user merely clicked is noise. It is also the second
 * full census.
 */
export async function verifyStore(uri: string, options: StoreQuery = {}): Promise<void> {
  if (!uri) return;
  put(uri, { verifying: true });
  try {
    const result = await storeApi.verify(uri, options);
    put(uri, { verify: result, verifying: false });
  } catch (e) {
    put(uri, { verifying: false, error: (e as Error).message });
  }
}

/** Drop a store's cached description — after something has written to it. */
export function invalidateStore(uri: string): void {
  if (cache.delete(uri)) notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Subscribe to one store's inspection.
 *
 * Returns a stable `empty` for an unknown URI rather than constructing a fresh
 * object, because `useSyncExternalStore` compares snapshots by identity and a
 * new object every call is an infinite render loop.
 */
export function useInspection(uri: string | null): Inspection {
  return useSyncExternalStore(
    subscribe,
    () => (uri ? cache.get(uri) ?? empty : empty),
    () => empty,
  );
}
