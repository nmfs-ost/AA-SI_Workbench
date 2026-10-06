import { useSyncExternalStore } from 'react';

import {
  calibrationApi,
  toolCallsApi,
  type CalibrationFile,
  type CalibrationReport,
} from '../services/echoviewApi';
import type { PipelineSpec } from '../services/pipelinesApi';
import { revealInDerived } from './derivedReveal';
import { runSpec } from './pipelines';

/**
 * The Calibration panel: the values echopype will use for an EchoData (read by
 * aa-ecs from echopype's own calibrator), the ECS files beside it, and the
 * values being changed. Held outside React so a hidden tab keeps its edits.
 *
 * Changing values never edits anything in place: Save writes a new ECS product
 * (aa-ecs --write), and Compute Sv runs aa-sv --ecs with it, so the ECS is an
 * input of the Sv and its content is in the Sv's hash.
 */

/** Environment values that are one number for the whole file (ECS FileSet). */
export const FILE_WIDE = new Set(['temperature', 'salinity', 'pressure', 'pH']);

export interface CalibrationState {
  /** The product asked about (the selection). */
  subject: string;
  /** The EchoData the values belong to (the subject, or what it was made from). */
  echodata: string;
  /** The ECS the values start from; '' for the file's own values. */
  ecs: string;
  waveformMode: string;
  encodeMode: string;
  report: CalibrationReport | null;
  loading: boolean;
  progress: string;
  error: string;
  files: CalibrationFile[];
  destination: string;
  /** Typed values, by channel frequency (Hz, as text) then echopype name. */
  edits: Record<string, Record<string, string>>;
  channel: number;
  saving: boolean;
  saveError: string;
  computing: boolean;
  computeError: string;
}

const initial: CalibrationState = {
  subject: '',
  echodata: '',
  ecs: '',
  waveformMode: '',
  encodeMode: '',
  report: null,
  loading: false,
  progress: '',
  error: '',
  files: [],
  destination: '',
  edits: {},
  channel: 0,
  saving: false,
  saveError: '',
  computing: false,
  computeError: '',
};

let state: CalibrationState = initial;
const listeners = new Set<() => void>();

function set(patch: Partial<CalibrationState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function getCalibration(): CalibrationState {
  return state;
}

export function useCalibration(): CalibrationState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

let asked = 0;

/**
 * Read the calibration for a product (and the ECS files beside it). A new
 * product clears the edits; the same product with another ECS or mode keeps
 * them, so values can be compared against a different starting point.
 */
export async function loadCalibration(
  subject: string,
  opts: { ecs?: string; waveformMode?: string; encodeMode?: string } = {},
): Promise<void> {
  if (!subject) return;
  const mine = ++asked;
  const same = subject === state.subject;
  set({
    ...(same ? {} : { ...initial }),
    subject,
    ecs: opts.ecs ?? (same ? state.ecs : ''),
    waveformMode: opts.waveformMode ?? (same ? state.waveformMode : ''),
    encodeMode: opts.encodeMode ?? (same ? state.encodeMode : ''),
    loading: true,
    progress: 'Asking echopype…',
    error: '',
  });
  void loadFiles(subject, mine);
  try {
    const call = await calibrationApi.report(subject, state.ecs, state.waveformMode, state.encodeMode);
    const done = await toolCallsApi.wait<CalibrationReport>(call.id, (c) => {
      if (mine !== asked) return;
      const last = [...c.log].reverse().find((line) => line.trim());
      if (last) set({ progress: last.slice(0, 160) });
    });
    if (mine !== asked) return;
    if (done.state !== 'succeeded' || !done.result) {
      set({ loading: false, error: done.error || 'aa-ecs could not read the calibration.' });
      return;
    }
    const report = done.result;
    set({
      report,
      echodata: report.input || subject,
      waveformMode: state.waveformMode || '',
      loading: false,
      progress: '',
      channel: Math.min(state.channel, Math.max(0, report.channels.length - 1)),
    });
  } catch (e) {
    if (mine !== asked) return;
    set({ loading: false, error: e instanceof Error ? e.message : String(e) });
  }
}

async function loadFiles(subject: string, mine: number): Promise<void> {
  try {
    const list = await calibrationApi.files(subject);
    if (mine !== asked) return;
    set({ files: list.items, destination: list.destination });
  } catch {
    /* the list is a convenience; the report says what is wrong */
  }
}

export function setChannel(channel: number): void {
  set({ channel });
}

/** Type a value. File-wide environment values are set on every channel. */
export function setValue(frequency: number, name: string, text: string): void {
  const freqs = FILE_WIDE.has(name) && state.report ? state.report.channels.map((c) => c.frequency) : [frequency];
  const edits = { ...state.edits };
  for (const f of freqs) {
    const key = String(f);
    const row = { ...(edits[key] ?? {}) };
    if (text.trim() === '') delete row[name];
    else row[name] = text;
    if (Object.keys(row).length) edits[key] = row;
    else delete edits[key];
  }
  set({ edits });
}

export function resetEdits(): void {
  set({ edits: {}, saveError: '' });
}

/** The edits as numbers, or the first one that is not a number. */
export function parsedEdits(edits: Record<string, Record<string, string>>):
  | { ok: true; channels: { frequency: number; values: Record<string, number> }[] }
  | { ok: false; error: string } {
  const channels: { frequency: number; values: Record<string, number> }[] = [];
  for (const [freq, row] of Object.entries(edits)) {
    const values: Record<string, number> = {};
    for (const [name, text] of Object.entries(row)) {
      const n = Number(text.trim());
      if (!Number.isFinite(n)) return { ok: false, error: `${name}: “${text}” is not a number.` };
      values[name] = n;
    }
    channels.push({ frequency: Number(freq), values });
  }
  return { ok: true, channels };
}

export function editCount(edits: Record<string, Record<string, string>>): number {
  return Object.values(edits).reduce((n, row) => n + Object.keys(row).length, 0);
}

/**
 * Save the values used now, with the edits on top, as a new ECS product beside
 * the EchoData. It becomes the starting point (the edits are in it).
 */
export async function saveEcs(label: string): Promise<string> {
  const report = state.report;
  if (!report || state.saving) return '';
  const parsed = parsedEdits(state.edits);
  if (!parsed.ok) {
    set({ saveError: parsed.error });
    return '';
  }
  const edited = new Map(parsed.channels.map((c) => [c.frequency, c.values]));
  const channels = report.channels.map((c) => ({ frequency: c.frequency, values: edited.get(c.frequency) ?? {} }));
  set({ saving: true, saveError: '' });
  try {
    const call = await calibrationApi.write({
      uri: state.echodata || state.subject,
      values: { channels },
      ecs: state.ecs,
      label,
      waveformMode: state.waveformMode,
      encodeMode: state.encodeMode,
    });
    const done = await toolCallsApi.wait(call.id);
    if (done.state !== 'succeeded' || !done.output.startsWith('gs://')) {
      set({ saving: false, saveError: done.error || 'aa-ecs could not write the file.' });
      return '';
    }
    const uri = done.output.trim();
    set({ saving: false, edits: {} });
    revealInDerived(uri);
    await loadCalibration(state.subject, { ecs: uri });
    return uri;
  } catch (e) {
    set({ saving: false, saveError: e instanceof Error ? e.message : String(e) });
    return '';
  }
}

/** The one-stage pipeline that calibrates with an ECS. */
export function svSpec(ecs: string, waveformMode = '', encodeMode = ''): PipelineSpec {
  const params: Record<string, string> = { ecs };
  if (waveformMode) params.waveform_mode = waveformMode;
  if (encodeMode) params.encode_mode = encodeMode;
  const name = ecs.split('/').pop() ?? ecs;
  return {
    id: '',
    name: `Sv with ${name}`,
    description: 'Calibrated with an ECS chosen in the Calibration panel.',
    stages: [{ tool: 'aa-sv', params }],
    builtin: false,
    updatedAt: '',
  };
}

/** Compute Sv from the EchoData with the chosen ECS (a run in Pipelines). */
export async function computeSv(): Promise<boolean> {
  if (!state.ecs || state.computing) return false;
  set({ computing: true, computeError: '' });
  try {
    await runSpec(svSpec(state.ecs, state.waveformMode, state.encodeMode), state.echodata || state.subject);
    set({ computing: false });
    return true;
  } catch (e) {
    set({ computing: false, computeError: e instanceof Error ? e.message : String(e) });
    return false;
  }
}

export function _resetForTests(): void {
  state = initial;
}
