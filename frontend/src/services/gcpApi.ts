/**
 * Client for /api/gcp — which GCP project and bucket this user works in, and
 * which they could. Mirrors backend/src/aa_si_workbench/api/gcp.py.
 *
 * As elsewhere, without the API (`VITE_AASI_USE_API` unset) a stand-in answers
 * with sample projects, so the picker can be worked on and demonstrated
 * without credentials; the card marks the Workbench as SAMPLE DATA then.
 */

const API_BASE = (import.meta.env.VITE_AASI_API_BASE ?? '').replace(/\/$/, '');
export const GCP_SIMULATED = import.meta.env.VITE_AASI_USE_API !== 'true';

export type ContextSource = 'chosen' | 'discovered' | 'environment' | 'unset';

export interface GcpContext {
  project: string;
  bucket: string;
  source: ContextSource;
  /** Which project's NCEI cache table the card and aa-fetch read. */
  nceiCacheProject: string;
}

export interface BucketAccess {
  name: string;
  read: boolean | null;
  write: boolean | null;
  detail: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  /** search: Resource Manager listed it; known: probed by name. */
  listedBy: 'search' | 'known';
  buckets: BucketAccess[];
  /** Whether <project>.metadata.ncei_cache can be read; null: not checked. */
  nceiCache: boolean | null;
  detail: string;
}

export interface Discovery {
  account: string;
  projects: ProjectInfo[];
  notes: string[];
  checkedAt: string;
  context: GcpContext;
  autoSelected: boolean;
}

export interface GcpApi {
  get(): Promise<GcpContext>;
  discover(refresh?: boolean): Promise<Discovery>;
  choose(project: string, bucket: string): Promise<GcpContext>;
  forget(): Promise<GcpContext>;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    });
  } catch (e) {
    throw new Error(`Cannot reach the Workbench API (${(e as Error).message})`);
  }
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      /* not JSON */
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

const serverApi: GcpApi = {
  get: () => call('/api/gcp'),
  discover: (refresh = false) => call(`/api/gcp/discover${refresh ? '?refresh=true' : ''}`),
  choose: (project, bucket) =>
    call('/api/gcp', { method: 'POST', body: JSON.stringify({ project, bucket }) }),
  // A JSON body, so no form on another site can post it.
  forget: () =>
    call('/api/gcp/forget', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ forget: true }),
    }),
};

/* ------------------------------------------------------------------ */
/* The stand-in                                                        */
/* ------------------------------------------------------------------ */

const SIM_PROJECTS: ProjectInfo[] = [
  {
    id: 'ggn-nmfs-aa-prod-1',
    name: 'AA-SI production',
    listedBy: 'search',
    buckets: [{ name: 'ggn-nmfs-aa-prod-1-data', read: true, write: true, detail: '' }],
    nceiCache: true,
    detail: '',
  },
  {
    id: 'ggn-nmfs-aa-dev-1',
    name: 'AA-SI development',
    listedBy: 'search',
    buckets: [{ name: 'ggn-nmfs-aa-dev-1-data', read: true, write: true, detail: '' }],
    nceiCache: true,
    detail: '',
  },
];

let simContext: GcpContext = {
  project: '',
  bucket: '',
  source: 'unset',
  nceiCacheProject: 'ggn-nmfs-aa-prod-1',
};

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const simulatedApi: GcpApi = {
  async get() {
    await pause(60);
    return { ...simContext };
  },
  async discover() {
    await pause(500);
    return {
      account: 'demo.user@noaa.gov',
      projects: SIM_PROJECTS,
      notes: [],
      checkedAt: new Date().toISOString(),
      context: { ...simContext },
      autoSelected: false,
    };
  },
  async choose(project, bucket) {
    await pause(80);
    const name = bucket.replace(/^gs:\/\//, '').replace(/\/+$/, '');
    if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(name)) {
      throw new Error(`Not a bucket name: '${bucket}'`);
    }
    const id = project || (name.endsWith('-data') ? name.slice(0, -5) : '');
    simContext = { project: id, bucket: name, source: 'chosen', nceiCacheProject: id || 'ggn-nmfs-aa-prod-1' };
    return { ...simContext };
  },
  async forget() {
    simContext = { project: '', bucket: '', source: 'unset', nceiCacheProject: 'ggn-nmfs-aa-prod-1' };
    return { ...simContext };
  },
};

export const gcpApi: GcpApi = GCP_SIMULATED ? simulatedApi : serverApi;

/** The stand-in's chosen bucket, for the other stand-ins ('' when none). */
export function simulatedBucket(): string {
  return simContext.bucket;
}
