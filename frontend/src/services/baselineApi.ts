/**
 * Client for /api/baseline — the Prepare EchoData operation.
 *
 * Mirrors backend/src/aa_si_workbench/api/baseline.py (camelCase on the wire).
 * The backend runs the whole chain (aa-request → aa-fetch → aa-ed →
 * aa-combine → aa-sv → aa-graph → aa-upload) as ordinary jobs; this client
 * only starts a run and watches it.
 *
 * Like the NCEI catalogue, there is a built-in stand-in for working on the UI
 * without a backend: `VITE_AASI_USE_API=true` (what `aa-workbench build` sets)
 * talks to the server, anything else simulates a run. The simulation is
 * labelled as such in the card, so nobody mistakes it for a product.
 */

const API_BASE = (import.meta.env.VITE_AASI_API_BASE ?? '').replace(/\/$/, '');
export const BASELINE_SIMULATED = import.meta.env.VITE_AASI_USE_API !== 'true';

export interface EchogramOptions {
  vmin: number;
  vmax: number;
  decimate: number;
  cmap: string;
}

export interface BaselineRequest {
  vessel: string;
  survey: string;
  sonar: string;
  start: string;
  end: string;
  fetchFrom: string;
  fetchTo: string;
  expectedFiles: string[];
  base: string;
  bucket: string;
  prefix: string;
  format: 'nc' | 'zarr';
  sv: boolean;
  echogram: boolean;
  gapSeconds: number;
  gapFactor: number;
  strict: boolean;
  keepLocal: boolean;
  echogramOptions: EchogramOptions;
  waveformMode: 'CW' | 'BB';
  encodeMode: 'complex' | 'power';
}

export interface ToolState {
  name: string;
  present: boolean;
}

export interface BaselineConfig {
  bucket: string;
  prefixTemplate: string;
  user: string;
  runRoot: string;
  tools: ToolState[];
  ready: boolean;
  problems: string[];
}

export interface StagePreview {
  id: string;
  label: string;
  tool: string;
  level: string;
  description: string;
  command: string[];
}

export type AssetKind = 'echodata' | 'sv' | 'echogram' | 'request' | 'report';

export interface Asset {
  kind: AssetKind;
  label: string;
  uri: string;
  level: string;
}

export interface Preview {
  base: string;
  destination: string;
  stages: StagePreview[];
  assets: Asset[];
}

export type StageState = 'pending' | 'running' | 'done' | 'failed' | 'skipped' | 'cancelled';

export interface StageStatus {
  id: string;
  label: string;
  tool: string;
  level: string;
  description: string;
  state: StageState;
  jobId: string;
  command: string[];
  output: string;
  detail: string;
  done: number;
  total: number;
  startedAt: string;
  finishedAt: string;
}

export type RunState = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface RunStatus {
  id: string;
  base: string;
  state: RunState;
  destination: string;
  scratch: string;
  stages: StageStatus[];
  assets: Asset[];
  error: string;
  notes: string[];
  createdAt: string;
  finishedAt: string;
  request: BaselineRequest;
}

export interface Provenance {
  uri: string;
  found: boolean;
  document: Record<string, unknown> | null;
  verified: boolean | null;
  message: string;
}

export interface BaselineApi {
  getConfig(): Promise<BaselineConfig>;
  preview(request: BaselineRequest): Promise<Preview>;
  start(request: BaselineRequest): Promise<RunStatus>;
  get(id: string): Promise<RunStatus>;
  list(): Promise<RunStatus[]>;
  cancel(id: string): Promise<RunStatus>;
  provenance(uri: string): Promise<Provenance>;
}

/* ------------------------------------------------------------------ */
/* The server                                                          */
/* ------------------------------------------------------------------ */

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    });
  } catch (e) {
    throw new Error(`Cannot reach the Workbench API — is the backend running? (${(e as Error).message})`);
  }
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
      else if (Array.isArray(body.detail)) {
        detail = body.detail
          .map((d: { msg?: string; loc?: unknown[] }) =>
            `${(d.loc ?? []).slice(1).join('.')}: ${d.msg ?? ''}`)
          .join('; ');
      }
    } catch {
      /* not JSON — keep the status line */
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

const serverApi: BaselineApi = {
  getConfig: () => call('/api/baseline/config'),
  preview: (request) =>
    call('/api/baseline/preview', { method: 'POST', body: JSON.stringify(request) }),
  start: (request) =>
    call('/api/baseline/runs', { method: 'POST', body: JSON.stringify(request) }),
  get: (id) => call(`/api/baseline/runs/${encodeURIComponent(id)}`),
  list: () => call('/api/baseline/runs'),
  cancel: (id) =>
    call(`/api/baseline/runs/${encodeURIComponent(id)}/cancel`, { method: 'POST' }),
  provenance: (uri) => call(`/api/baseline/provenance?uri=${encodeURIComponent(uri)}`),
};

/* ------------------------------------------------------------------ */
/* The stand-in                                                        */
/* ------------------------------------------------------------------ */

const STAGES: Omit<StagePreview, 'command'>[] = [
  { id: 'request', label: 'Request', tool: 'aa-request', level: 'L0',
    description: 'Write the request: vessel, survey, echosounder and time window.' },
  { id: 'fetch', label: 'Fetch', tool: 'aa-fetch', level: 'L0',
    description: 'Download the raw files from NCEI into a scratch folder.' },
  { id: 'convert', label: 'Convert', tool: 'aa-ed', level: 'L1',
    description: 'Convert each raw file to EchoData (echopype NetCDF).' },
  { id: 'combine', label: 'Combine', tool: 'aa-combine', level: 'L1',
    description: 'Merge the files in time order into one EchoData asset, with a QC report, written to the bucket.' },
  { id: 'sv', label: 'Calibrate', tool: 'aa-sv', level: 'L2A',
    description: 'Compute Sv (volume backscattering strength) beside it.' },
  { id: 'echogram', label: 'Echogram', tool: 'aa-graph', level: 'L2A',
    description: 'Render an echogram of the Sv, named after it.' },
  { id: 'record', label: 'Record', tool: 'aa-upload', level: '',
    description: 'Keep the request document with the products.' },
];

const SIM_BUCKET = 'ggn-nmfs-aa-dev-1-data';
const SIM_USER = 'demo.user';

function simBase(r: BaselineRequest): string {
  const s = (t: string) => t.replace(/[-:]/g, '').replace(/Z$/, '').slice(0, 15);
  return r.base || `${r.survey}_${r.sonar}_${s(r.start)}-${s(r.end)}`;
}

function simDest(r: BaselineRequest, base: string): string {
  return `gs://${r.bucket || SIM_BUCKET}/derived_products/${SIM_USER}/${r.vessel}/${r.survey}/${base}/`;
}

function single(r: BaselineRequest): boolean {
  return r.expectedFiles.length === 1;
}

function simEnabled(id: string, r: BaselineRequest): boolean {
  if (id === 'combine') return !single(r);
  if (id === 'sv') return r.sv;
  if (id === 'echogram') return r.sv && r.echogram;
  return true;
}

function simCommand(id: string, r: BaselineRequest, base: string, dest: string): string[] {
  const scratch = `~/aa-workbench-runs/${base}-<run>`;
  const fmt = single(r) ? 'nc' : r.format;
  const o = r.echogramOptions;
  switch (id) {
    case 'request':
      return ['aa-request', '--vessel', r.vessel, '--survey', r.survey, '--instrument', r.sonar,
        '--from', r.fetchFrom || r.start, '--to', r.fetchTo || r.end,
        '-o', `${scratch}/${base}.yaml`, '--force'];
    case 'fetch':
      return ['aa-fetch', `${scratch}/${base}.yaml`, '-o', scratch, '-n', 'raw'];
    case 'convert':
      return single(r)
        ? ['aa-ed', `${scratch}/raw/${r.expectedFiles[0]}`, '-o', `${dest}${base}.nc`,
          '--sonar_model', r.sonar, '--quiet']
        : ['aa-ed', `${scratch}/raw`, '--sonar_model', r.sonar, '--quiet'];
    case 'combine':
      return ['aa-combine', '--workdir', `${scratch}/raw`, '-o', `${dest}${base}.${fmt}`,
        '--sort', 'time', '--sonar_model', r.sonar, '--gap_seconds', String(r.gapSeconds),
        '--gap_factor', String(r.gapFactor), '--report', '--progress',
        ...(r.strict ? ['--strict'] : [])];
    case 'sv':
      return ['aa-sv', `${dest}${base}.${fmt}`, '--dest', dest,
        ...(r.sonar.toUpperCase().includes('EK80')
          ? ['--waveform_mode', r.waveformMode, '--encode_mode', r.encodeMode] : [])];
    case 'echogram':
      return ['aa-graph', `${dest}${base}_<recipe>.nc`, '--dest', dest, '--var', 'Sv',
        '--decimate', String(o.decimate), '--vmin', String(o.vmin), '--vmax', String(o.vmax),
        '--cmap', o.cmap, '--figwidth', '14', '--rowheight', '3', '--dpi', '150'];
    default:
      return ['aa-upload', `${scratch}/${base}.yaml`, dest];
  }
}

function simAssets(r: BaselineRequest, base: string, dest: string, recipe = '<recipe>'): Asset[] {
  const fmt = single(r) ? 'nc' : r.format;
  const out: Asset[] = [
    { kind: 'echodata', label: single(r) ? 'EchoData' : 'Combined EchoData',
      uri: `${dest}${base}.${fmt}`, level: 'L1' },
  ];
  if (!single(r)) out.push({ kind: 'report', label: 'QC report', uri: `${dest}${base}.qc.json`, level: '' });
  if (r.sv) {
    out.push({ kind: 'sv', label: 'Sv (calibrated)', uri: `${dest}${base}_${recipe}.nc`, level: 'L2A' });
    if (r.echogram) {
      out.push({ kind: 'echogram', label: 'Echogram', uri: `${dest}${base}_${recipe}.png`, level: 'L2A' });
    }
  }
  out.push({ kind: 'request', label: 'Request document', uri: `${dest}${base}.yaml`, level: '' });
  return out;
}

/** Seconds each stage takes in the stand-in: long enough to watch. */
const SIM_SECONDS: Record<string, number> = {
  request: 1, fetch: 6, convert: 6, combine: 5, sv: 3, echogram: 2, record: 1,
};

interface SimRun {
  status: RunStatus;
  started: number;
  cancelled: boolean;
}

const simRuns = new Map<string, SimRun>();
const nowIso = () => new Date().toISOString().replace(/\.\d+Z$/, 'Z');

function advance(sim: SimRun): RunStatus {
  const s = sim.status;
  if (s.state !== 'running') return s;
  const r = s.request;
  const dest = s.destination;
  let clock = (Date.now() - sim.started) / 1000;
  for (const stage of s.stages) {
    if (stage.state === 'skipped') continue;
    const need = SIM_SECONDS[stage.id] ?? 1;
    if (sim.cancelled) {
      if (stage.state === 'running') stage.state = 'cancelled';
      else if (stage.state === 'pending') stage.state = 'cancelled';
      continue;
    }
    if (clock >= need) {
      clock -= need;
      if (stage.state !== 'done') {
        stage.state = 'done';
        stage.finishedAt = nowIso();
        stage.startedAt ||= nowIso();
        const n = r.expectedFiles.length;
        if (stage.id === 'fetch') stage.detail = `${n} raw files fetched, as planned.`;
        if (stage.id === 'convert') stage.detail = single(r) ? 'Written to the bucket.' : `${n} of ${n} files`;
        if (stage.id === 'combine') stage.detail = 'Written to the bucket.';
        stage.done = stage.total;
      }
      continue;
    }
    stage.state = 'running';
    stage.startedAt ||= nowIso();
    stage.command = simCommand(stage.id, r, s.base, dest);
    stage.jobId = `sim-${stage.id}`;
    const n = Math.max(1, r.expectedFiles.length);
    if (stage.id === 'fetch' || stage.id === 'convert') {
      stage.total = n;
      stage.done = Math.min(n, Math.floor((clock / need) * n));
      stage.detail = `${stage.done} of ${n} files`;
    } else if (stage.id === 'combine') {
      stage.total = n;
      stage.done = Math.min(n, Math.floor((clock / need) * n));
      stage.detail = `${stage.done} of ${n} files`;
    }
    return { ...s, stages: s.stages.map((x) => ({ ...x })) };
  }
  if (sim.cancelled) {
    s.state = 'cancelled';
    s.finishedAt = nowIso();
  } else {
    s.state = 'succeeded';
    s.finishedAt = nowIso();
    s.assets = simAssets(r, s.base, dest, '6c1f0e2a');
    s.notes = [
      `${r.expectedFiles.length} raw files fetched, as planned.`,
      'Simulated run: nothing was fetched or written. Build with VITE_AASI_USE_API=true for real runs.',
    ];
  }
  return { ...s, stages: s.stages.map((x) => ({ ...x })) };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const simulatedApi: BaselineApi = {
  async getConfig() {
    await delay(120);
    return {
      bucket: SIM_BUCKET,
      prefixTemplate: 'derived_products/{user}/{vessel}/{survey}/{base}/',
      user: SIM_USER,
      runRoot: '~/aa-workbench-runs',
      tools: ['aa-request', 'aa-fetch', 'aa-ed', 'aa-combine', 'aa-sv', 'aa-graph', 'aa-upload',
        'aa-metadata'].map((name) => ({ name, present: true })),
      ready: true,
      problems: [],
    };
  },
  async preview(r) {
    const base = simBase(r);
    const dest = simDest(r, base);
    return {
      base,
      destination: dest,
      stages: STAGES.filter((s) => simEnabled(s.id, r)).map((s) => ({
        ...s,
        command: simCommand(s.id, r, base, dest),
      })),
      assets: simAssets(r, base, dest),
    };
  },
  async start(r) {
    await delay(150);
    const id = Math.random().toString(16).slice(2, 12);
    const base = simBase(r);
    const status: RunStatus = {
      id,
      base,
      state: 'running',
      destination: simDest(r, base),
      scratch: `~/aa-workbench-runs/${base}-${id}`,
      stages: STAGES.map((s) => ({
        ...s,
        state: simEnabled(s.id, r) ? 'pending' : 'skipped',
        jobId: '',
        command: [],
        output: '',
        detail: s.id === 'combine' && single(r)
          ? 'One file: converted straight to the bucket; nothing to merge.' : '',
        done: 0,
        total: 0,
        startedAt: '',
        finishedAt: '',
      })),
      assets: [],
      error: '',
      notes: [],
      createdAt: nowIso(),
      finishedAt: '',
      request: r,
    };
    simRuns.set(id, { status, started: Date.now(), cancelled: false });
    return advance(simRuns.get(id)!);
  },
  async get(id) {
    const sim = simRuns.get(id);
    if (!sim) throw new Error(`No run ${id}.`);
    return advance(sim);
  },
  async list() {
    return [...simRuns.values()].map(advance);
  },
  async cancel(id) {
    const sim = simRuns.get(id);
    if (!sim) throw new Error(`No run ${id}.`);
    sim.cancelled = true;
    return advance(sim);
  },
  async provenance(uri) {
    await delay(200);
    return {
      uri,
      found: false,
      document: null,
      verified: null,
      message: 'Simulated run: there is no product to read.',
    };
  },
};

export const baselineApi: BaselineApi = BASELINE_SIMULATED ? simulatedApi : serverApi;

/** The provenance reader always talks to the server when there is one. */
export const provenanceApi = serverApi.provenance;

/** Where the server shows a PNG product from the bucket (the echogram). */
export function imageUrl(uri: string): string {
  return `${API_BASE}/api/baseline/image?uri=${encodeURIComponent(uri)}`;
}
