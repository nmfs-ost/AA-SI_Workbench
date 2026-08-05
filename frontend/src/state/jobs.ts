import { useSyncExternalStore } from 'react';

import {
  FINAL_STATES,
  jobsApi,
  type JobList,
  type JobRequest,
  type JobStatus,
} from '../services/jobsApi';

/**
 * The processing queue, held outside React.
 *
 * A combine over a survey season runs for an hour. The panel that started it is
 * one tab of four in the right dock and Dockview unmounts the hidden ones, so
 * polling cannot belong to a component — the same reason `environment.ts` owns
 * the update job rather than the dialog that starts it.
 *
 * Polling, not a socket or SSE: a long-lived stream is the first thing an
 * intermediate proxy buffers, and this app is normally reached through a Cloud
 * Workstation web preview. A cursor and a GET are boring and survive that.
 *
 * The loop stops itself when nothing is live. A queue of finished jobs polling
 * once a second forever is a bug that never announces itself.
 */

export interface JobsState {
  jobs: JobStatus[];
  running: number;
  queued: number;
  maxRunning: number;
  loading: boolean;
  /** Transport failure — the API is unreachable. Not a job's own failure. */
  error: string;
  /** The job whose log is open, if any. */
  selectedId: string;
  /** Accumulated stderr for the selected job. */
  lines: string[];
  cursor: number;
  polling: boolean;
}

const initial: JobsState = {
  jobs: [],
  running: 0,
  queued: 0,
  maxRunning: 1,
  loading: false,
  error: '',
  selectedId: '',
  lines: [],
  cursor: 0,
  polling: false,
};

let state: JobsState = initial;
const listeners = new Set<() => void>();

function emit(patch: Partial<JobsState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

/* Fast while something is running, idle otherwise. */
const ACTIVE_POLL_MS = 900;
let timer: ReturnType<typeof setTimeout> | null = null;

function anyLive(list: JobStatus[]): boolean {
  return list.some((job) => !FINAL_STATES.has(job.state));
}

function stop(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  if (state.polling) emit({ polling: false });
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void tick(), ACTIVE_POLL_MS);
}

async function tick(): Promise<void> {
  try {
    const list: JobList = await jobsApi.list();
    emit({
      jobs: list.jobs,
      running: list.running,
      queued: list.queued,
      maxRunning: list.maxRunning,
      loading: false,
      error: '',
    });

    // The selected job's log comes from a second call, from a cursor, so the
    // list endpoint never has to carry every job's log on every poll.
    if (state.selectedId) {
      const job = await jobsApi.get(state.selectedId, state.cursor);
      emit({
        lines: job.truncated
          ? ['… earlier output dropped from the server buffer …', ...job.lines]
          : [...state.lines, ...job.lines],
        cursor: job.nextCursor,
      });
    }

    // Keep polling while anything is live, or while a log is open and its job
    // has not finished. A finished queue polls no more.
    const selected = list.jobs.find((job) => job.id === state.selectedId);
    if (anyLive(list.jobs) || (selected && !FINAL_STATES.has(selected.state))) {
      schedule();
    } else {
      stop();
    }
  } catch (e) {
    emit({ loading: false, error: (e as Error).message });
    // Back off rather than hammering an API that is down; one more attempt
    // keeps a restarted backend from needing a manual refresh.
    if (state.polling) schedule();
  }
}

/** Begin polling. Idempotent — the panel calls this on every mount. */
export function startPolling(): void {
  if (timer) return;
  emit({ polling: true, loading: state.jobs.length === 0 });
  void tick();
}

export function stopPolling(): void {
  stop();
}

/** Fetch once, without starting the loop. */
export async function refreshJobs(): Promise<void> {
  emit({ loading: true });
  await tick();
}

export async function startJob(request: JobRequest): Promise<JobStatus | null> {
  try {
    const job = await jobsApi.start(request);
    emit({ error: '' });
    startPolling();
    return job;
  } catch (e) {
    emit({ error: (e as Error).message });
    return null;
  }
}

export async function cancelJob(id: string): Promise<void> {
  try {
    await jobsApi.cancel(id);
    startPolling();
  } catch (e) {
    emit({ error: (e as Error).message });
  }
}

/**
 * Re-run a partial job.
 *
 * Offered only for exit 3, and the server enforces that too. Exit 3 means the
 * inputs and the settings were fine and the write was interrupted — so the same
 * command is the right command. Exits 2 and 4 are excluded on purpose: a wrong
 * command line will be wrong again, and a QC finding re-run is a QC finding
 * hidden.
 */
export async function resumeJob(id: string): Promise<void> {
  try {
    await jobsApi.resume(id);
    startPolling();
  } catch (e) {
    emit({ error: (e as Error).message });
  }
}

/** Open a job's log. Resets the cursor, so the whole buffer arrives once. */
export function selectJob(id: string): void {
  if (state.selectedId === id) {
    emit({ selectedId: '', lines: [], cursor: 0 });
    return;
  }
  emit({ selectedId: id, lines: [], cursor: 0 });
  startPolling();
}

function getSnapshot(): JobsState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useJobs(): JobsState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
