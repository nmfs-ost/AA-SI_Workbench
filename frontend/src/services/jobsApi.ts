/**
 * Client for /api/jobs — running the `aa-*` tools.
 *
 * Mirrors backend/src/aa_si_workbench/api/jobs.py verbatim (camelCase on the
 * wire), same contract style as environmentApi.
 *
 * The one thing worth reading before using this: `state` is not a boolean
 * dressed up. The tools use five exit codes and three of them are *not*
 * failures in the sense a UI usually means:
 *
 *   partial  (3) — the run was interrupted and the store says so. Resumable.
 *   qcFailed (4) — the data has a finding. Nothing to retry; go read it.
 *   usage    (2) — the command line is wrong and will be wrong again.
 *
 * Collapsing those into "failed" is what makes a queue panel useless, so they
 * are distinct states here and the UI is expected to render them differently.
 */

const API_BASE = (import.meta.env.VITE_AASI_API_BASE ?? '').replace(/\/$/, '');

export type JobState =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'usage'
  | 'partial'
  | 'qcFailed'
  | 'cancelled';

/** States nothing further will happen to. */
export const FINAL_STATES: ReadonlySet<JobState> = new Set<JobState>([
  'succeeded',
  'failed',
  'usage',
  'partial',
  'qcFailed',
  'cancelled',
]);

export interface JobProgress {
  stage: string;
  done: number;
  total: number;
  unit: string;
  updatedAt: string;
}

export interface JobStatus {
  id: string;
  tool: string;
  label: string;
  command: string[];
  cwd: string;
  state: JobState;
  exitCode: number | null;
  /** Plain-language reading of the exit code. Empty on success. */
  verdict: string;
  /** True only for exit 3. What the Resume button keys off. */
  resumable: boolean;
  /** The id of the job this one resumes, when it is a resumption. */
  resumedFrom: string;
  queuedAt: string;
  startedAt: string;
  finishedAt: string;
  /** The child's stdout, unmerged: a path, or an `aa/1` handle line. */
  stdout: string[];
  /** Parsed handle when stdout was a single JSON line, else null. */
  handle: Record<string, unknown> | null;
  progress: JobProgress | null;
  /** Failure of the runner itself, distinct from the tool's own exit code. */
  error: string;
  /** stderr from `cursor`, ANSI-stripped, progress events removed. */
  lines: string[];
  cursor: number;
  nextCursor: number;
  truncated: boolean;
}

export interface JobList {
  jobs: JobStatus[];
  running: number;
  queued: number;
  maxRunning: number;
}

export interface JobRequest {
  /** With or without the `aa-` prefix. */
  tool: string;
  /** argv[1:]. Never a shell string — there is no shell on the other end. */
  args: string[];
  label?: string;
  cwd?: string;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.headers ?? {}) },
    });
  } catch (e) {
    throw new Error(
      `Cannot reach the Workbench API — is the backend running? (${(e as Error).message})`,
    );
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body;
    try {
      const parsed = JSON.parse(body) as { detail?: string };
      if (parsed.detail) detail = parsed.detail;
    } catch {
      /* not JSON — keep the raw text */
    }
    throw new Error(detail || `API ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const jobsApi = {
  list: () => request<JobList>('/api/jobs'),

  get: (id: string, since = 0) =>
    request<JobStatus>(`/api/jobs/${encodeURIComponent(id)}?since=${since}`),

  start: (job: JobRequest) =>
    request<JobStatus>('/api/jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(job),
    }),

  cancel: (id: string) =>
    request<JobStatus>(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),

  /** Only valid for exit 3; the server refuses anything else with a 409. */
  resume: (id: string) =>
    request<JobStatus>(`/api/jobs/${encodeURIComponent(id)}/resume`, { method: 'POST' }),
};
