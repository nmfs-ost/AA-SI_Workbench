import { useSyncExternalStore } from 'react';

import {
  environmentApi,
  type EnvironmentInfo,
  type UpdateJobState,
  type UpdateJobStatus,
} from '../services/environmentApi';

/**
 * Python environment state: what is installed, and the progress of an
 * `aa-setup` run.
 *
 * The job outlives the dialog on purpose — an environment reinstall takes
 * minutes, so polling belongs to the module store, not to a component that
 * unmounts the moment the user closes the window. The status bar subscribes to
 * the same store, which is how a background update stays visible.
 *
 * Same module-store pattern as activeAsset / calibration / pipelines.
 */

export interface EnvironmentState {
  info: EnvironmentInfo | null;
  infoLoading: boolean;
  infoError: string;
  job: UpdateJobStatus | null;
  /** Accumulated log lines (the server sends only what's new since `cursor`). */
  lines: string[];
  cursor: number;
  /** Error from starting/polling the job, distinct from the job's own failure. */
  jobError: string;
  /** Versions captured immediately before the last update started. */
  versionsBefore: Record<string, string> | null;
}

const initialState: EnvironmentState = {
  info: null,
  infoLoading: false,
  infoError: '',
  job: null,
  lines: [],
  cursor: 0,
  jobError: '',
  versionsBefore: null,
};

let state: EnvironmentState = initialState;
const listeners = new Set<() => void>();

function emit(patch: Partial<EnvironmentState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

const POLL_INTERVAL_MS = 900;
let pollTimer: ReturnType<typeof setInterval> | null = null;

/** name -> version, across both tools and watched packages. */
function versionMap(info: EnvironmentInfo | null): Record<string, string> {
  const map: Record<string, string> = {};
  if (!info) return map;
  for (const tool of info.tools) {
    if (tool.version) map[tool.distribution || tool.name] = tool.version;
  }
  for (const pkg of info.packages) {
    if (pkg.version) map[pkg.name] = pkg.version;
  }
  return map;
}

export interface VersionChange {
  name: string;
  from: string;
  to: string;
}

/** What actually changed between the pre-update snapshot and now. */
export function versionChanges(current: EnvironmentState): VersionChange[] {
  const before = current.versionsBefore;
  if (!before) return [];
  const after = versionMap(current.info);
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes: VersionChange[] = [];
  for (const name of [...names].sort()) {
    const from = before[name] ?? '';
    const to = after[name] ?? '';
    if (from !== to) changes.push({ name, from, to });
  }
  return changes;
}

export async function loadEnvironment(): Promise<void> {
  emit({ infoLoading: true, infoError: '' });
  try {
    const info = await environmentApi.getInfo();
    emit({ info, infoLoading: false });
  } catch (e) {
    emit({ infoLoading: false, infoError: (e as Error).message });
  }
}

function applyJob(job: UpdateJobStatus): void {
  // The server returns only lines at/after `cursor`; a cursor of 0 means the
  // job restarted, so the buffer is replaced rather than appended to.
  const lines = job.cursor === 0 ? job.lines : [...state.lines, ...job.lines];
  emit({ job, lines, cursor: job.nextCursor, jobError: '' });
}

async function poll(): Promise<void> {
  try {
    const job = await environmentApi.getJob(state.cursor);
    applyJob(job);
    if (job.state !== 'running') {
      stopPolling();
      if (job.state === 'succeeded') void loadEnvironment(); // refresh versions
    }
  } catch (e) {
    stopPolling();
    emit({ jobError: (e as Error).message });
  }
}

function startPolling(): void {
  if (pollTimer !== null) return;
  pollTimer = setInterval(() => void poll(), POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (pollTimer === null) return;
  clearInterval(pollTimer);
  pollTimer = null;
}

/**
 * Pick up a job that is already running (e.g. the dialog was closed and
 * reopened, or the page was reloaded mid-update).
 */
export async function syncUpdateJob(): Promise<void> {
  try {
    const job = await environmentApi.getJob(0);
    emit({ job, lines: job.lines, cursor: job.nextCursor });
    if (job.state === 'running') startPolling();
  } catch (e) {
    emit({ jobError: (e as Error).message });
  }
}

export async function startUpdate(action = 'environment'): Promise<void> {
  emit({
    jobError: '',
    lines: [],
    cursor: 0,
    versionsBefore: versionMap(state.info),
  });
  try {
    applyJob(await environmentApi.startUpdate(action));
    startPolling();
  } catch (e) {
    emit({ jobError: (e as Error).message });
  }
}

export async function cancelUpdate(): Promise<void> {
  try {
    applyJob(await environmentApi.cancelUpdate());
  } catch (e) {
    emit({ jobError: (e as Error).message });
  }
}

function getSnapshot(): EnvironmentState {
  return state;
}

/** The current snapshot, for imperative callers and tests (React uses the hooks). */
export function getEnvironmentState(): EnvironmentState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Full environment state (dialog). */
export function useEnvironment(): EnvironmentState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Just the job state — a primitive, so cheap for chrome to subscribe to. */
export function useUpdateJobState(): UpdateJobState {
  return useSyncExternalStore(
    subscribe,
    () => state.job?.state ?? 'idle',
    () => 'idle' as UpdateJobState,
  );
}
