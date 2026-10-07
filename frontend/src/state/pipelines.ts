import { useSyncExternalStore } from 'react';

import { ApiError, pipelinesApi, refFromInfo } from '../services/pipelinesApi';
import type {
  Catalogue,
  ParamValue,
  PipelineSpec,
  Plan,
  PlanRequest,
  ProductInfo,
  ProductRef,
  RunStatus,
  StageSpec,
  ToolParam,
} from '../services/pipelinesApi';
import { stagesEqual, withParam } from '../components/panels/pipelines/chain';
import { onGcpChange } from './gcp';

/**
 * The Pipelines card: which products it runs on, which pipeline is open, the
 * settings being edited, the server's plan for them, and the runs.
 *
 * The input is a selection of products in the bucket (the Products panel, a
 * run's results, Prepare's results); the plan is asked of the server whenever
 * the pipeline, its settings or the input change, so what the card shows is
 * what would run. Edits are kept per pipeline until saved or discarded.
 */

export interface PipelinesState {
  catalogue: Catalogue | null;
  catalogueError: string;
  pipelines: PipelineSpec[];
  listError: string;
  activePipelineId: string | null;
  /** Unsaved stage settings, per pipeline. */
  edits: Record<string, StageSpec[]>;
  inputs: ProductRef[];
  plan: Plan | null;
  planning: boolean;
  planError: string;
  /** Where products go for this run, gs://…/; '' for beside the input. */
  dest: string;
  /** Recompute stages whose product is already in the bucket. */
  force: boolean;
  runs: RunStatus[];
  activeRunId: string | null;
  starting: boolean;
  runError: string;
}

const ACTIVE_KEY = 'aa-si.pipelines.active';

function remembered(): string | null {
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

let state: PipelinesState = {
  catalogue: null,
  catalogueError: '',
  pipelines: [],
  listError: '',
  activePipelineId: remembered(),
  edits: {},
  inputs: [],
  plan: null,
  planning: false,
  planError: '',
  dest: '',
  force: false,
  runs: [],
  activeRunId: null,
  starting: false,
  runError: '',
};

const listeners = new Set<() => void>();

function set(patch: Partial<PipelinesState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

/** A pipeline as edited (its unsaved settings applied). */
export function effective(s: PipelinesState, id: string | null): PipelineSpec | null {
  const base = s.pipelines.find((p) => p.id === id);
  if (!base) return null;
  const edited = s.edits[base.id];
  return edited ? { ...base, stages: edited } : base;
}

export function isEdited(s: PipelinesState, id: string): boolean {
  const base = s.pipelines.find((p) => p.id === id);
  const edited = s.edits[id];
  return Boolean(base && edited && !stagesEqual(base.stages, edited));
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

let started = false;

export function initPipelines(): void {
  if (started) return;
  started = true;
  void loadCatalogue();
  void loadPipelines();
  void (async () => {
    try {
      const runs = await pipelinesApi.runs();
      set({ runs, activeRunId: runs.find((r) => r.state === 'running')?.id ?? runs[0]?.id ?? null });
      if (runs.some((r) => r.state === 'running')) poll();
    } catch {
      /* no server yet: nothing to re-attach to */
    }
  })();
  // Products go to the chosen bucket: a new choice is a new plan.
  onGcpChange(() => requestPlan());
}

export async function loadCatalogue(refresh = false): Promise<void> {
  try {
    const catalogue = await pipelinesApi.tools(refresh);
    set({ catalogue, catalogueError: catalogue.problem });
    requestPlan();
  } catch (e) {
    set({ catalogueError: (e as Error).message });
  }
}

export async function loadPipelines(): Promise<void> {
  try {
    const pipelines = await pipelinesApi.list();
    const active =
      state.activePipelineId && pipelines.some((p) => p.id === state.activePipelineId)
        ? state.activePipelineId
        : null;
    set({ pipelines, listError: '', activePipelineId: active });
    requestPlan();
  } catch (e) {
    set({ listError: (e as Error).message });
  }
}

/* ------------------------------------------------------------------ */
/* Choosing                                                            */
/* ------------------------------------------------------------------ */

export function setActivePipeline(id: string | null): void {
  if (id === state.activePipelineId) return;
  try {
    if (id) localStorage.setItem(ACTIVE_KEY, id);
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    /* a convenience only */
  }
  set({ activePipelineId: id, plan: null, planError: '' });
  requestPlan();
}

export function setInputs(inputs: ProductRef[]): void {
  set({ inputs, runError: '' });
  requestPlan();
}

export function toggleInput(ref: ProductRef): void {
  const has = state.inputs.some((i) => i.uri === ref.uri);
  setInputs(has ? state.inputs.filter((i) => i.uri !== ref.uri) : [...state.inputs, ref]);
}

/** A product from a run's results (or Prepare's) becomes the input. */
export function inputFromProduct(product: ProductInfo): void {
  setInputs([refFromInfo(product)]);
}

let lookups = 0;

/** A product known only by its URI: looked up, then made the input (the last
 *  one asked for wins, however the lookups finish). */
export async function inputFromUri(uri: string): Promise<void> {
  const mine = ++lookups;
  try {
    const product = await pipelinesApi.product(uri);
    if (mine === lookups) inputFromProduct(product);
  } catch (e) {
    if (mine === lookups) set({ runError: (e as Error).message });
  }
}

export function setDest(dest: string): void {
  set({ dest });
  requestPlan();
}

export function setForce(force: boolean): void {
  set({ force });
  requestPlan();
}

/* ------------------------------------------------------------------ */
/* Editing                                                             */
/* ------------------------------------------------------------------ */

export function setStageParam(
  pipelineId: string,
  index: number,
  param: ToolParam,
  value: ParamValue | undefined,
): void {
  const spec = effective(state, pipelineId);
  if (!spec) return;
  const stages = spec.stages.map((stage, i) => (i === index ? withParam(stage, param, value) : stage));
  set({ edits: { ...state.edits, [pipelineId]: stages } });
  requestPlan();
}

/** A step of your own: its command, name or product kind changed. */
export function setOwnStep(
  pipelineId: string,
  index: number,
  patch: Partial<Pick<StageSpec, 'command' | 'label' | 'produces'>>,
): void {
  const spec = effective(state, pipelineId);
  if (!spec) return;
  const stages = spec.stages.map((stage, i) => (i === index ? { ...stage, ...patch } : stage));
  set({ edits: { ...state.edits, [pipelineId]: stages } });
  requestPlan();
}

export function resetStage(pipelineId: string, index: number): void {
  const spec = effective(state, pipelineId);
  if (!spec) return;
  const stages = spec.stages.map((stage, i) => (i === index ? { ...stage, params: {} } : stage));
  set({ edits: { ...state.edits, [pipelineId]: stages } });
  requestPlan();
}

export function discardEdits(pipelineId: string): void {
  const { [pipelineId]: _, ...rest } = state.edits;
  set({ edits: rest });
  requestPlan();
}

/** Save a pipeline (new, or replacing a saved one); it becomes the open one. */
export async function savePipeline(spec: PipelineSpec): Promise<PipelineSpec> {
  const saved = await pipelinesApi.save(spec);
  const { [spec.id]: _, [saved.id]: __, ...rest } = state.edits;
  set({ edits: rest });
  await loadPipelines();
  setActivePipeline(saved.id);
  return saved;
}

/** Save the open pipeline's edited settings; a built-in is saved as a copy. */
export async function saveEdits(pipelineId: string, asName?: string): Promise<PipelineSpec> {
  const spec = effective(state, pipelineId);
  if (!spec) throw new Error('No such pipeline.');
  if (spec.builtin || asName) {
    const copy = await savePipeline({ ...spec, id: '', builtin: false, name: asName || `${spec.name} (mine)` });
    discardEdits(pipelineId);
    return copy;
  }
  return savePipeline(spec);
}

export async function deletePipeline(id: string): Promise<void> {
  await pipelinesApi.remove(id);
  const { [id]: _, ...rest } = state.edits;
  set({ edits: rest, activePipelineId: state.activePipelineId === id ? null : state.activePipelineId });
  await loadPipelines();
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

let planTimer: ReturnType<typeof setTimeout> | null = null;
let planAsked = 0;

function planRequest(input: string): PlanRequest | null {
  const spec = effective(state, state.activePipelineId);
  if (!spec) return null;
  return { pipeline: spec, input, dest: state.dest, force: state.force };
}

/** Ask the server for the plan of the open pipeline on the first input. */
export function requestPlan(): void {
  if (planTimer) clearTimeout(planTimer);
  // Counted now, not when the request goes: an answer to an earlier request
  // that lands while this one waits is already out of date.
  const mine = ++planAsked;
  const first = state.inputs[0];
  const req = first ? planRequest(first.uri) : null;
  if (!req) {
    if (state.plan || state.planning || state.planError) set({ plan: null, planning: false, planError: '' });
    return;
  }
  set({ planning: true });
  planTimer = setTimeout(() => {
    pipelinesApi
      .plan(req)
      .then((plan) => {
        if (mine === planAsked) set({ plan, planning: false, planError: '' });
      })
      .catch((e: Error) => {
        if (mine === planAsked) set({ plan: null, planning: false, planError: e.message });
      });
  }, 250);
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

/** Run the open pipeline on every selected product (one run each). */
export async function startRuns(): Promise<void> {
  const spec = effective(state, state.activePipelineId);
  if (!spec || state.inputs.length === 0 || state.starting) return;
  set({ starting: true, runError: '' });
  const made: RunStatus[] = [];
  const errors: string[] = [];
  for (const input of state.inputs) {
    try {
      made.push(await pipelinesApi.run({ pipeline: spec, input: input.uri, dest: state.dest, force: state.force }));
    } catch (e) {
      errors.push(state.inputs.length > 1 ? `${input.name}: ${(e as Error).message}` : (e as Error).message);
    }
  }
  set({
    starting: false,
    runError: errors.join('\n'),
    runs: [...made.reverse(), ...state.runs.filter((r) => !made.some((m) => m.id === r.id))],
    activeRunId: made[made.length - 1]?.id ?? state.activeRunId,
  });
  if (made.length) poll();
}

/**
 * Run a one-off pipeline (not a saved one) on one product: what another panel
 * asks for (Calibration's "Compute Sv with this ECS"). It shows with the
 * other runs in the Pipelines panel, open.
 */
export async function runSpec(spec: PipelineSpec, input: string): Promise<RunStatus> {
  const run = await pipelinesApi.run({ pipeline: spec, input, dest: state.dest, force: false });
  set({ runs: [run, ...state.runs.filter((r) => r.id !== run.id)], activeRunId: run.id });
  poll();
  return run;
}

export async function cancelRun(id: string): Promise<void> {
  try {
    const status = await pipelinesApi.cancel(id);
    replaceRun(status);
  } catch (e) {
    set({ runError: (e as Error).message });
  }
}

export function setActiveRun(id: string | null): void {
  set({ activeRunId: id });
}

export function dismissRun(id: string): void {
  set({
    runs: state.runs.filter((r) => r.id !== id),
    activeRunId: state.activeRunId === id ? null : state.activeRunId,
  });
}

function replaceRun(status: RunStatus): void {
  set({ runs: state.runs.map((r) => (r.id === status.id ? status : r)) });
}

let polling = false;

function poll(): void {
  if (polling) return;
  polling = true;
  const tick = async () => {
    const live = state.runs.filter((r) => r.state === 'running');
    if (live.length === 0) {
      polling = false;
      return;
    }
    for (const run of live) {
      try {
        replaceRun(await pipelinesApi.getRun(run.id));
      } catch (e) {
        // The server no longer knows it (it was restarted): it will not finish.
        if (e instanceof ApiError && e.status === 404) {
          replaceRun({
            ...run,
            state: 'failed',
            error: 'The Workbench server was restarted while this ran, so how it ended is not known. Look in the bucket for its products, or run it again.',
            stages: run.stages.map((s) => (s.state === 'running' || s.state === 'pending' ? { ...s, state: 'cancelled' } : s)),
          });
        }
        /* otherwise the next tick asks again */
      }
    }
    setTimeout(() => void tick(), 1000);
  };
  setTimeout(() => void tick(), 600);
}

/* ------------------------------------------------------------------ */
/* React                                                               */
/* ------------------------------------------------------------------ */

export function subscribePipelines(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPipelinesState(): PipelinesState {
  return state;
}

export function usePipelines(): PipelinesState {
  return useSyncExternalStore(subscribePipelines, getPipelinesState, getPipelinesState);
}
