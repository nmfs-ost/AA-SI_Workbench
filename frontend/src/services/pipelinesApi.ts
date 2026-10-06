/**
 * Client for /api/pipelines and /api/products: pipelines of console tools run
 * on a product in the bucket. Mirrors backend api/pipelines.py, catalogue.py
 * and products.py (camelCase on the wire).
 *
 * Everything that decides what runs lives on the server: the tools' flags come
 * from the installed aalibrary, the plan (which stages run, every command, the
 * destination) is the server's, and the run is the server's. The card shows
 * them and edits the settings.
 */

const API_BASE = (import.meta.env.VITE_AASI_API_BASE ?? '').replace(/\/$/, '');

/* ------------------------------------------------------------------ */
/* The tools                                                           */
/* ------------------------------------------------------------------ */

export type ParamType = 'bool' | 'number' | 'integer' | 'text' | 'choice' | 'list';
export type ParamValue = string | number | boolean | string[] | null;

export interface ToolParam {
  id: string;
  label: string;
  type: ParamType;
  default: ParamValue;
  choices: string[];
  flag: string;
  trueFlag: string;
  falseFlag: string;
  help: string;
  /** Changes the product, so its hash and the <hash8> in its name. */
  science: boolean;
  required: boolean;
  primary: boolean;
  repeat: boolean;
  /** The option takes a product in the bucket of one of these kinds (an ECS,
   *  a line file, a mask): its content is in the product's hash. */
  productKinds?: string[];
}

export interface ToolDef {
  name: string;
  label: string;
  group: string;
  summary: string;
  consumes: string[];
  produces: string;
  level: string;
  needs: string[];
  depthParam: string;
  adds: string[];
  echodataFlag: string;
  echodataRequired: boolean;
  echodataWhen: string[];
  /** --echodata adds something (position, say) but the tool runs without it. */
  echodataOptional?: boolean;
  passthrough: boolean;
  params: ToolParam[];
  reads: string;
  chaining: string;
  examples: string[];
}

export interface NearbyProduct {
  uri: string;
  name: string;
  kind: string;
  productHash: string;
  tool: string;
  updatedAt: string;
}

export interface Catalogue {
  tools: ToolDef[];
  kinds: Record<string, string>;
  levels: Record<string, string>;
  groups: string[];
  aalibraryVersion: string;
  missing: string[];
  problem: string;
  checkedAt: string;
  /** Where the chaining traits came from: the installed aalibrary, or the
   *  Workbench's own table for an older aalibrary. */
  traitsSource?: string;
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

export interface ProductStep {
  tool: string;
  product: string;
  recipe: string;
  params: Record<string, unknown>;
}

export interface ProductInfo {
  uri: string;
  name: string;
  found: boolean;
  store: boolean;
  sizeBytes: number;
  md5: string;
  crc32c: string;
  generation: string;
  /** SHA-256 of what was computed: the science. */
  productHash: string;
  /** The processing without the data: the <hash8> in the file's name. */
  recipe: string;
  tool: string;
  base: string;
  kind: string;
  level: string;
  /** The MD5 the tool published still matches the object (null: unrecorded). */
  intact: boolean | null;
  features: string[] | null;
  echodata: string;
  steps: ProductStep[];
  inputs: { name: string; uri: string; role: string; id: string }[];
  createdAt: string;
  createdBy: string;
  software: Record<string, unknown>;
  detail: string;
}

/** What the card needs to show a product: a listing row carries all of it. */
export interface ProductRef {
  uri: string;
  name: string;
  kind: string;
  level: string;
  productHash: string;
  recipe: string;
  md5: string;
  intact: boolean | null;
  tool: string;
  sizeBytes: number;
  updatedAt: string;
}

export function refFromInfo(info: ProductInfo): ProductRef {
  return {
    uri: info.uri,
    name: info.name,
    kind: info.kind,
    level: info.level,
    productHash: info.productHash,
    recipe: info.recipe,
    md5: info.md5,
    intact: info.intact,
    tool: info.tool,
    sizeBytes: info.sizeBytes,
    updatedAt: info.createdAt,
  };
}

/* ------------------------------------------------------------------ */
/* Pipelines, plans, runs                                              */
/* ------------------------------------------------------------------ */

export interface StageSpec {
  tool: string;
  /** Only the settings that differ from the tool's defaults. */
  params: Record<string, ParamValue>;
}

export interface PipelineSpec {
  id: string;
  name: string;
  description: string;
  stages: StageSpec[];
  builtin: boolean;
  updatedAt: string;
}

export interface PlanRequest {
  pipeline: PipelineSpec;
  input: string;
  dest?: string;
  force?: boolean;
}

export interface PlannedStage {
  index: number;
  tool: string;
  label: string;
  group: string;
  consumes: string[];
  produces: string;
  level: string;
  action: 'run' | 'skip';
  reason: string;
  reads: string;
  command: string[];
  echodata: string;
  values: Record<string, ParamValue>;
  problems: string[];
  warnings: string[];
}

export interface Plan {
  pipelineId: string;
  pipelineName: string;
  input: ProductInfo;
  destination: string;
  destinationReason: string;
  stages: PlannedStage[];
  problems: string[];
  warnings: string[];
  outputKind: string;
  script: string;
  project: string;
}

export type StageState = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'cancelled';
export type RunState = 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface StageRun {
  index: number;
  tool: string;
  label: string;
  produces: string;
  level: string;
  state: StageState;
  detail: string;
  jobId: string;
  command: string[];
  output: string;
  reused: boolean;
  startedAt: string;
  finishedAt: string;
  product: ProductInfo | null;
  log: string[];
}

export interface RunStatus {
  id: string;
  pipelineId: string;
  pipelineName: string;
  input: ProductInfo;
  destination: string;
  project: string;
  state: RunState;
  stages: StageRun[];
  createdAt: string;
  finishedAt: string;
  error: string;
  outputs: ProductInfo[];
}

/* ------------------------------------------------------------------ */
/* Calls                                                               */
/* ------------------------------------------------------------------ */

/** An error from the server, with its HTTP status (404: no such thing). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new Error('Could not reach the Workbench server.');
  }
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body?.detail === 'string') detail = body.detail;
      else if (Array.isArray(body?.detail)) detail = 'The server could not read the request.';
    } catch {
      /* the status line is all there is */
    }
    throw new ApiError(detail, response.status);
  }
  return (await response.json()) as T;
}

const post = <T>(path: string, body: unknown) =>
  call<T>(path, { method: 'POST', body: JSON.stringify(body) });

export const pipelinesApi = {
  tools: (refresh = false) => call<Catalogue>(`/api/pipelines/tools${refresh ? '?refresh=true' : ''}`),
  list: () => call<PipelineSpec[]>('/api/pipelines'),
  save: (spec: PipelineSpec) => post<PipelineSpec>('/api/pipelines', spec),
  remove: (id: string) => post<{ deleted: string }>('/api/pipelines/delete', { id }),
  plan: (req: PlanRequest) => post<Plan>('/api/pipelines/plan', req),
  run: (req: PlanRequest) => post<RunStatus>('/api/pipelines/runs', req),
  runs: () => call<RunStatus[]>('/api/pipelines/runs'),
  getRun: (id: string) => call<RunStatus>(`/api/pipelines/runs/${encodeURIComponent(id)}`),
  cancel: (id: string) => post<RunStatus>(`/api/pipelines/runs/${encodeURIComponent(id)}/cancel`, {}),
  product: (uri: string) => call<ProductInfo>(`/api/products/info?uri=${encodeURIComponent(uri)}`),
  /** Products of these kinds beside a product: choices for a product option. */
  nearby: (uri: string, kinds: string[]) =>
    call<NearbyProduct[]>(`/api/products/nearby?uri=${encodeURIComponent(uri)}&kinds=${encodeURIComponent(kinds.join(','))}`),
};
