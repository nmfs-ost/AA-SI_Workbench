/**
 * Client for the environment endpoints (backend/src/aa_si_workbench/api/
 * environment.py). Field names match the backend's camelCase wire models
 * verbatim, so there is no remapping here — same contract style as the NCEI
 * source. Base URL follows `VITE_AASI_API_BASE`; empty means same-origin, which
 * is what both `aa-workbench serve` and the Vite dev proxy give us.
 */

const API_BASE = import.meta.env.VITE_AASI_API_BASE ?? '';

export interface ToolInfo {
  name: string;
  path: string;
  distribution: string;
  version: string;
}

export interface PackageInfo {
  name: string;
  version: string;
}

export interface UpdateAction {
  id: string;
  label: string;
  description: string;
  /** argv as configured on the server; argv[0] is the program. */
  command: string[];
  resolvedPath: string;
  available: boolean;
}

export interface EnvironmentInfo {
  workbenchVersion: string;
  pythonVersion: string;
  pythonExecutable: string;
  prefix: string;
  venvName: string;
  isVirtualEnv: boolean;
  expectedVenvName: string;
  matchesExpected: boolean;
  platform: string;
  tools: ToolInfo[];
  packages: PackageInfo[];
  actions: UpdateAction[];
  updateEnabled: boolean;
  updateDisabledReason: string;
}

export type UpdateJobState =
  | 'idle'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

export interface UpdateJobStatus {
  state: UpdateJobState;
  action: string;
  command: string[];
  startedAt: string;
  finishedAt: string;
  exitCode: number | null;
  error: string;
  /** Log lines starting at `cursor`. */
  lines: string[];
  cursor: number;
  /** Pass as `since` on the next poll. */
  nextCursor: number;
  /** Older lines were dropped from the server's buffer before `cursor`. */
  truncated: boolean;
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
    // FastAPI errors are {"detail": "..."}; fall back to the raw body.
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

export const environmentApi = {
  getInfo: () => request<EnvironmentInfo>('/api/env'),

  getJob: (since: number) =>
    request<UpdateJobStatus>(`/api/env/update?since=${since}`),

  startUpdate: (action: string) =>
    request<UpdateJobStatus>('/api/env/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    }),

  cancelUpdate: () =>
    request<UpdateJobStatus>('/api/env/update/cancel', { method: 'POST' }),
};
