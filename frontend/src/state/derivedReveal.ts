import { useSyncExternalStore } from 'react';

/**
 * "Show this in the bucket", from anywhere.
 *
 * The Prepare card writes its products to the bucket the Derived panel
 * browses, and the obvious next move after a run is to look at them there.
 * This carries the request across: the card sets a URI, the Derived panel
 * expands the folders down to it, selects it and refreshes what it lists (the
 * objects are new since it last looked). The nonce makes asking twice for the
 * same URI a second request rather than no change.
 */

export interface RevealRequest {
  uri: string;
  nonce: number;
}

let current: RevealRequest | null = null;
const listeners = new Set<() => void>();

export function revealInDerived(uri: string): void {
  current = { uri, nonce: (current?.nonce ?? 0) + 1 };
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => current;

export function useRevealRequest(): RevealRequest | null {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
