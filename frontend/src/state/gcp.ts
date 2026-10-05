import { useSyncExternalStore } from 'react';

import { gcpApi } from '../services/gcpApi';
import type { Discovery, GcpContext } from '../services/gcpApi';
import { loadIdentity } from './identity';

/**
 * The GCP project and bucket this user works in, as the server knows it.
 *
 * The choice itself lives on the server (gcp.py, one small file in the user's
 * ~/.config on the workstation), because everything that uses it runs there:
 * the Derived listing, Prepare's runs, the NCEI cache, every console tool. This
 * store mirrors it, runs discovery for the picker, and tells the panels that
 * read the bucket to read again when it changes (`version`).
 */

export interface GcpState {
  context: GcpContext | null;
  discovery: Discovery | null;
  discovering: boolean;
  error: string;
  /** Bumped on every change of project or bucket. */
  version: number;
}

let state: GcpState = { context: null, discovery: null, discovering: false, error: '', version: 0 };
const listeners = new Set<() => void>();

function set(patch: Partial<GcpState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

type Follower = (context: GcpContext, previous: GcpContext | null) => void;

/** Things that depend on the bucket register here to reload when it changes. */
const followers = new Set<Follower>();

export function onGcpChange(callback: Follower): () => void {
  followers.add(callback);
  return () => {
    followers.delete(callback);
  };
}

function changed(context: GcpContext): void {
  const previous = state.context;
  set({ context, version: state.version + 1, error: '' });
  // The status bar shows the project.
  void loadIdentity(true);
  followers.forEach((callback) => callback(context, previous));
}

let started = false;

/**
 * Load the context once. When nothing is chosen yet, look at what this user
 * can use straight away: the server chooses for them when exactly one bucket
 * can be written to, and otherwise the picker opens with the list ready. A
 * failed load can be tried again (the picker does, on opening).
 */
export function initGcp(): void {
  if (started) return;
  started = true;
  void (async () => {
    try {
      const context = await gcpApi.get();
      set({ context, error: '' });
      if (context.source === 'unset') await discoverGcp();
    } catch (e) {
      started = false;
      set({ error: (e as Error).message });
    }
  })();
}

let asked = 0;
/** Bumped by every choice made here, so a discovery that set out before it
 *  cannot report the older context as the one in force. */
let choices = 0;

export async function discoverGcp(refresh = false): Promise<void> {
  const mine = ++asked;
  const choicesBefore = choices;
  set({ discovering: true, error: '' });
  try {
    const discovery = await gcpApi.discover(refresh);
    // A later look (Look again) answers instead of this one.
    if (mine !== asked) return;
    const before = state.context;
    set({ discovery, discovering: false });
    if (choicesBefore !== choices) return;
    const after = discovery.context;
    if (!before || before.bucket !== after.bucket || before.project !== after.project) {
      changed(after);
    }
  } catch (e) {
    if (mine === asked) set({ discovering: false, error: (e as Error).message });
  }
}

export async function chooseGcp(project: string, bucket: string): Promise<boolean> {
  choices += 1;
  try {
    changed(await gcpApi.choose(project, bucket));
    return true;
  } catch (e) {
    set({ error: (e as Error).message });
    return false;
  }
}

export async function forgetGcp(): Promise<void> {
  choices += 1;
  try {
    changed(await gcpApi.forget());
  } catch (e) {
    set({ error: (e as Error).message });
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => state;

export function useGcp(): GcpState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
