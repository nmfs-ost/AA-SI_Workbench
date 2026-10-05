import { useSyncExternalStore } from 'react';

import type { RawFile, SonarModel, Survey, Vessel } from '../services/ncei/nceiTypes';
import { nceiSource } from '../services/ncei/nceiService';
import {
  extentOf,
  formatUtc,
  parseUtc,
  planRange,
  toolTime,
} from '../components/panels/prepare/plan';
import type { RangePlan } from '../components/panels/prepare/plan';
import { BASELINE_SIMULATED, baselineApi } from '../services/baselineApi';
import { setActiveArtifact } from './activeSubject';
import type {
  BaselineConfig,
  BaselineRequest,
  EchogramOptions,
  RunStatus,
} from '../services/baselineApi';

/**
 * The Prepare EchoData card's state: what to make, and the run making it.
 *
 * A module store rather than component state, for two reasons. The left dock
 * swaps panels, and a card that forgot its survey and range every time
 * someone glanced at Files would be unusable. And a run outlives the view:
 * it is an hour of work on the server, so the card re-attaches to it after a
 * reload instead of pretending nothing is happening.
 *
 * The form is remembered in localStorage (a per-browser convenience: the
 * survey you worked on yesterday is the one you want today). The run never
 * is; the server is the only record of a run.
 */

export interface PrepareState {
  vessels: Vessel[];
  surveys: Survey[];
  sonars: SonarModel[];
  files: RawFile[];
  vessel: Vessel | null;
  survey: Survey | null;
  sonar: SonarModel | null;
  loading: { vessels: boolean; surveys: boolean; sonars: boolean; files: boolean };
  catalogError: string;

  /** The range as typed, UTC "YYYY-MM-DD HH:mm:ss". */
  start: string;
  end: string;

  sv: boolean;
  echogram: boolean;
  format: 'nc' | 'zarr';
  /** '' means the default name. */
  base: string;
  /** '' means the server's bucket. */
  bucket: string;
  gapSeconds: number;
  gapFactor: number;
  strict: boolean;
  keepLocal: boolean;
  /** The working folder on the workstation; '' means the server's default. */
  workRoot: string;
  /** Delete each kind of working file once no later stage reads it. */
  freeAsYouGo: boolean;
  echogramOptions: EchogramOptions;
  /** EK80 calibration (aa-sv --waveform_mode / --encode_mode); unused otherwise. */
  waveformMode: 'CW' | 'BB';
  encodeMode: 'complex' | 'power';

  config: BaselineConfig | null;
  configError: string;

  run: RunStatus | null;
  starting: boolean;
  runError: string;
}

const DEFAULTS = {
  sv: true,
  echogram: true,
  format: 'nc' as const,
  base: '',
  bucket: '',
  gapSeconds: 900,
  gapFactor: 6,
  strict: false,
  keepLocal: false,
  workRoot: '',
  freeAsYouGo: true,
  echogramOptions: { vmin: -80, vmax: -30, decimate: 10, cmap: 'viridis' },
  waveformMode: 'CW' as const,
  encodeMode: 'complex' as const,
};

let state: PrepareState = {
  vessels: [],
  surveys: [],
  sonars: [],
  files: [],
  vessel: null,
  survey: null,
  sonar: null,
  loading: { vessels: false, surveys: false, sonars: false, files: false },
  catalogError: '',
  start: '',
  end: '',
  ...DEFAULTS,
  config: null,
  configError: '',
  run: null,
  starting: false,
  runError: '',
};

const listeners = new Set<() => void>();

let saveTimer: ReturnType<typeof setTimeout> | null = null;

function set(patch: Partial<PrepareState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
  // Dragging the range sets state on every pointer move; write once it rests.
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 400);
}

function setLoading(key: keyof PrepareState['loading'], value: boolean): void {
  set({ loading: { ...state.loading, [key]: value } });
}

/* ------------------------------------------------------------------ */
/* Remembering the form                                                */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = 'aa-si.prepare';

interface Saved {
  vessel?: string;
  survey?: string;
  sonar?: string;
  start?: string;
  end?: string;
  sv?: boolean;
  echogram?: boolean;
  format?: 'nc' | 'zarr';
  gapSeconds?: number;
  gapFactor?: number;
  strict?: boolean;
  keepLocal?: boolean;
  workRoot?: string;
  freeAsYouGo?: boolean;
  echogramOptions?: EchogramOptions;
  waveformMode?: 'CW' | 'BB';
  encodeMode?: 'complex' | 'power';
}

let restoring: Saved | null = null;

function save(): void {
  if (restoring) return; // don't overwrite what we are still restoring
  const saved: Saved = {
    vessel: state.vessel?.id,
    survey: state.survey?.id,
    sonar: state.sonar?.id,
    start: state.start,
    end: state.end,
    sv: state.sv,
    echogram: state.echogram,
    format: state.format,
    gapSeconds: state.gapSeconds,
    gapFactor: state.gapFactor,
    strict: state.strict,
    keepLocal: state.keepLocal,
    workRoot: state.workRoot,
    freeAsYouGo: state.freeAsYouGo,
    echogramOptions: state.echogramOptions,
    waveformMode: state.waveformMode,
    encodeMode: state.encodeMode,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    /* private window or storage off: the card still works, it just forgets */
  }
}

function load(): Saved | null {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    return text ? (JSON.parse(text) as Saved) : null;
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                           */
/* ------------------------------------------------------------------ */

let token = { surveys: 0, sonars: 0, files: 0 };

/** A first range for a freshly chosen survey: its first six hours, on the hour. */
function openingRange(files: RawFile[]): { start: string; end: string } {
  const extent = extentOf(files);
  if (!extent) return { start: '', end: '' };
  const from = Math.floor(extent.from / 3600e3) * 3600e3;
  const to = Math.min(from + 6 * 3600e3, Math.ceil(extent.to / 60e3) * 60e3);
  return { start: formatUtc(from), end: formatUtc(to) };
}

export async function selectVessel(vessel: Vessel | null): Promise<void> {
  const mine = ++token.surveys;
  token.sonars += 1;
  token.files += 1;
  set({ vessel, survey: null, sonar: null, surveys: [], sonars: [], files: [], catalogError: '' });
  if (!vessel) return;
  setLoading('surveys', true);
  try {
    const surveys = await nceiSource.listSurveys(vessel.id);
    if (mine !== token.surveys) return;
    set({ surveys });
    const wanted = restoring?.survey && surveys.find((s) => s.id === restoring?.survey);
    if (wanted) await selectSurvey(wanted);
    else if (surveys.length === 1) await selectSurvey(surveys[0]);
  } catch (e) {
    set({ catalogError: `Could not load surveys: ${(e as Error).message}` });
  } finally {
    if (mine === token.surveys) setLoading('surveys', false);
  }
}

export async function selectSurvey(survey: Survey | null): Promise<void> {
  const mine = ++token.sonars;
  token.files += 1;
  set({ survey, sonar: null, sonars: [], files: [], catalogError: '' });
  if (!survey || !state.vessel) return;
  setLoading('sonars', true);
  try {
    const sonars = await nceiSource.listSonars(state.vessel.id, survey.id);
    if (mine !== token.sonars) return;
    set({ sonars });
    const wanted = restoring?.sonar && sonars.find((s) => s.id === restoring?.sonar);
    // One echosounder is the common case, and there is nothing to choose.
    if (wanted) await selectSonar(wanted);
    else if (sonars.length === 1) await selectSonar(sonars[0]);
  } catch (e) {
    set({ catalogError: `Could not load echosounders: ${(e as Error).message}` });
  } finally {
    if (mine === token.sonars) setLoading('sonars', false);
  }
}

export async function selectSonar(sonar: SonarModel | null): Promise<void> {
  const mine = ++token.files;
  set({ sonar, files: [], catalogError: '' });
  if (!sonar || !state.vessel || !state.survey) return;
  setLoading('files', true);
  try {
    const files = await nceiSource.listRawFiles(state.vessel.id, state.survey.id, sonar.id);
    if (mine !== token.files) return;
    const saved = restoring;
    restoring = null;
    const extent = extentOf(files);
    const keep =
      saved?.start && saved.end && extent &&
      (parseUtc(saved.start) ?? 0) < extent.to && (parseUtc(saved.end) ?? 0) > extent.from;
    set({ files, ...(keep ? { start: saved!.start!, end: saved!.end! } : openingRange(files)) });
  } catch (e) {
    restoring = null;
    set({ catalogError: `Could not list the raw files: ${(e as Error).message}` });
  } finally {
    if (mine === token.files) setLoading('files', false);
  }
}

/* ------------------------------------------------------------------ */
/* Form                                                                */
/* ------------------------------------------------------------------ */

export function update(patch: Partial<Pick<PrepareState,
  'start' | 'end' | 'sv' | 'echogram' | 'format' | 'base' | 'bucket' | 'gapSeconds' |
  'gapFactor' | 'strict' | 'keepLocal' | 'workRoot' | 'freeAsYouGo' | 'echogramOptions' |
  'waveformMode' | 'encodeMode'>>): void {
  set(patch);
}

export function setRange(from: number, to: number): void {
  set({ start: formatUtc(from), end: formatUtc(to) });
}

/** Advanced settings back to their defaults; the products, name and working space stay. */
export function resetOptions(): void {
  set({
    gapSeconds: DEFAULTS.gapSeconds,
    gapFactor: DEFAULTS.gapFactor,
    strict: DEFAULTS.strict,
    bucket: DEFAULTS.bucket,
    echogramOptions: DEFAULTS.echogramOptions,
    waveformMode: DEFAULTS.waveformMode,
    encodeMode: DEFAULTS.encodeMode,
  });
}

/** The plan for the current form, or null when the range is incomplete. */
export function currentPlan(s: PrepareState): RangePlan | null {
  const from = parseUtc(s.start);
  const to = parseUtc(s.end);
  if (from === null || to === null || s.files.length === 0) return null;
  return planRange(s.files, from, to, s.gapSeconds, s.gapFactor);
}

/** The request the backend runs, from the form and its plan. */
export function buildRequest(s: PrepareState, plan: RangePlan): BaselineRequest {
  return {
    vessel: s.vessel?.id ?? '',
    survey: s.survey?.id ?? '',
    sonar: s.sonar?.id ?? '',
    start: toolTime(parseUtc(s.start)!),
    end: toolTime(parseUtc(s.end)!),
    fetchFrom: plan.fetchFrom,
    fetchTo: plan.fetchTo,
    expectedFiles: plan.files.map((f) => f.name),
    base: s.base.trim(),
    bucket: s.bucket.trim(),
    prefix: '',
    format: s.format,
    sv: s.sv,
    echogram: s.sv && s.echogram,
    gapSeconds: s.gapSeconds,
    gapFactor: s.gapFactor,
    strict: s.strict,
    keepLocal: s.keepLocal,
    echogramOptions: s.echogramOptions,
    waveformMode: s.waveformMode,
    encodeMode: s.encodeMode,
    workRoot: s.workRoot.trim(),
    freeAsYouGo: s.freeAsYouGo,
    expectedBytes: Math.max(0, Math.round(plan.bytes)),
  };
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

let poller: ReturnType<typeof setTimeout> | null = null;

function poll(id: string): void {
  if (poller) clearTimeout(poller);
  poller = setTimeout(async () => {
    try {
      const run = await baselineApi.get(id);
      if (state.run?.id !== id) return; // dismissed meanwhile
      const finished = state.run.state === 'running' && run.state === 'succeeded';
      set({ run, runError: '' });
      if (run.state === 'running') poll(id);
      else if (finished) announce(run);
    } catch (e) {
      if (state.run?.id !== id) return;
      const message = (e as Error).message;
      if (/^No run /.test(message)) {
        // The server no longer has it: restarted, so its runs (kept in
        // memory) are gone. Polling would spin forever; say what happened.
        set({
          run: {
            ...state.run,
            state: 'failed',
            error:
              'The Workbench server was restarted and no longer knows this run. ' +
              'Anything it finished is in the bucket (see Derived); run it again ' +
              'to complete it — finished products are reused, not recomputed.',
          },
          runError: '',
        });
        return;
      }
      set({ runError: `Lost track of the run: ${message}. Retrying…` });
      poll(id);
    }
  }, 1200);
}

/**
 * The new asset becomes the selection: Metadata describes it and Pipelines
 * take it as their input, with no further click. That is the last step of the
 * card's promise — the asset is available to whatever comes next.
 */
function announce(run: RunStatus): void {
  const asset = run.assets.find((a) => a.kind === 'echodata');
  if (!asset || BASELINE_SIMULATED) return;
  const label = asset.uri.replace(/\/$/, '').split('/').pop() ?? asset.uri;
  setActiveArtifact({ uri: asset.uri, label, origin: 'Prepare' });
}

export async function startRun(request: BaselineRequest): Promise<void> {
  set({ starting: true, runError: '' });
  try {
    const run = await baselineApi.start(request);
    set({ run, starting: false });
    if (run.state === 'running') poll(run.id);
  } catch (e) {
    set({ starting: false, runError: (e as Error).message });
  }
}

export async function cancelRun(): Promise<void> {
  const run = state.run;
  if (!run || run.state !== 'running') return;
  try {
    set({ run: await baselineApi.cancel(run.id) });
  } catch (e) {
    set({ runError: (e as Error).message });
  }
}

/** Back to the form. The run carries on or stays done on the server. */
export function dismissRun(): void {
  if (poller) clearTimeout(poller);
  poller = null;
  set({ run: null, runError: '' });
}

let configRetry: ReturnType<typeof setTimeout> | null = null;

/** Load the server's config; while it is unreachable, keep trying quietly. */
export async function loadConfig(): Promise<void> {
  if (configRetry) clearTimeout(configRetry);
  try {
    set({ config: await baselineApi.getConfig(), configError: '' });
  } catch (e) {
    set({ configError: (e as Error).message });
    configRetry = setTimeout(() => void loadConfig(), 5000);
  }
}

/* ------------------------------------------------------------------ */
/* Start-up                                                            */
/* ------------------------------------------------------------------ */

let initialised = false;

/** Load the catalogue and config once, restore the form, re-attach to a run. */
export function initPrepare(): void {
  if (initialised) return;
  initialised = true;
  const saved = load();
  if (saved) {
    restoring = saved;
    const { vessel: _v, survey: _s, sonar: _m, start: _a, end: _b, ...options } = saved;
    state = { ...state, ...options };
  }
  void loadConfig();
  void (async () => {
    setLoading('vessels', true);
    try {
      const vessels = await nceiSource.listVessels();
      set({ vessels });
      const wanted = saved?.vessel && vessels.find((v) => v.id === saved.vessel);
      if (wanted) await selectVessel(wanted);
      else restoring = null;
    } catch (e) {
      restoring = null;
      set({ catalogError: `Could not load vessels: ${(e as Error).message}` });
    } finally {
      setLoading('vessels', false);
    }
  })();
  void (async () => {
    try {
      const runs = await baselineApi.list();
      const live = runs
        .filter((r) => r.state === 'running')
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      if (live && !state.run) {
        set({ run: live });
        poll(live.id);
      }
    } catch {
      /* no server yet: nothing to re-attach to */
    }
  })();
}

/* ------------------------------------------------------------------ */
/* React                                                               */
/* ------------------------------------------------------------------ */

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const snapshot = () => state;

export function usePrepare(): PrepareState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
