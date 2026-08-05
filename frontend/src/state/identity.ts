import { useSyncExternalStore } from 'react';

import {
  identityApi,
  OPTIMISTIC_IDENTITY,
  type Capabilities,
  type Identity,
} from '../services/identityApi';

/**
 * The active principal and what the UI should offer them.
 *
 * A module store, like every other cross-dock fact here, because it is read
 * from three regions at once: the Files and Derived panels (which hide
 * organising actions), the Resources panel (which shows who is signed in), and
 * the sequence's Publish stage.
 *
 * Fetched **once** for the session rather than per consumer. The backend probes
 * `gcloud` and possibly the metadata server to answer, and doing that from
 * four panels as they mount would be four subprocesses to learn one fact that
 * cannot change while the tab is open.
 *
 * Before the first response the optimistic identity applies: everything
 * enabled. That is deliberate and safe — see `identityApi`'s docstring. The
 * gate here is an explanation, not a boundary, so a slow API must not grey out
 * a workstation.
 */

interface IdentityState {
  identity: Identity;
  /** False until the first response, success or failure. */
  loaded: boolean;
  /** Why identity could not be read, if it could not. Not shown as an error:
      an unreachable identity endpoint changes nothing a user can act on. */
  error: string;
}

let state: IdentityState = {
  identity: OPTIMISTIC_IDENTITY,
  loaded: false,
  error: '',
};

const listeners = new Set<() => void>();
/** In flight, so N mounting panels share one request. */
let pending: Promise<void> | null = null;

function emit(next: IdentityState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): IdentityState {
  return state;
}

export function getIdentityState(): IdentityState {
  return state;
}

/** Fetch once per session; `refresh` forces a re-probe (after `gcloud auth`). */
export function loadIdentity(refresh = false): Promise<void> {
  if (pending && !refresh) return pending;
  if (state.loaded && !refresh) return Promise.resolve();

  pending = identityApi
    .get(refresh)
    .then((identity) => {
      emit({ identity, loaded: true, error: '' });
    })
    .catch((error: unknown) => {
      emit({
        // Keep the optimistic capabilities. A failed probe is not evidence
        // that anything is forbidden.
        identity: OPTIMISTIC_IDENTITY,
        loaded: true,
        error: error instanceof Error ? error.message : 'Could not read identity.',
      });
    })
    .finally(() => {
      pending = null;
    });

  return pending;
}

export function useIdentity(): IdentityState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/**
 * One capability, for the common case of a panel that only cares about one.
 *
 * Returns the optimistic value until loaded, so nothing flickers from enabled
 * to disabled to enabled while the request is out.
 */
export function useCapability(name: keyof Capabilities): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.identity.capabilities[name],
    () => OPTIMISTIC_IDENTITY.capabilities[name],
  );
}
