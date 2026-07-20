import { useSyncExternalStore } from 'react';

import {
  cloneValues,
  defaultValues,
  valuesEqual,
  type ParamValue,
  type PipelineDefinition,
  type PipelineValues,
  type SavedConfiguration,
  type StageDef,
} from '../components/panels/pipelines/pipelineTypes';
import { pipelineDefinitions } from '../components/panels/pipelines/pipelineDefinitions';

/**
 * Pipeline state shared across docks.
 *
 * The Pipelines panel (center) owns selection and editing; the Configuration
 * panel (right) edits the same draft values — so they stay in lockstep. Uses the
 * same module-store pattern as activeAsset/mapTrack, which works regardless of
 * how Dockview mounts panels.
 *
 * Terminology:
 *   - *selected*  — cards ticked for a run (many).
 *   - *active*    — the card whose configuration the right panel shows (one).
 *   - *draft*     — current, possibly-unsaved values for a pipeline.
 *   - *saved configuration* — a named set of values ("Default", "Deep water", …).
 */

interface PipelinesState {
  /** All pipelines: the seeded ones plus any the user creates. */
  pipelines: PipelineDefinition[];
  selected: ReadonlySet<string>;
  activePipelineId: string | null;
  /** pipelineId -> current (possibly edited) values. */
  drafts: Record<string, PipelineValues>;
  /** pipelineId -> saved configurations. */
  configs: Record<string, SavedConfiguration[]>;
  /** pipelineId -> id of the configuration the draft was loaded from. */
  activeConfigId: Record<string, string>;
}

function initialState(): PipelinesState {
  const drafts: Record<string, PipelineValues> = {};
  const configs: Record<string, SavedConfiguration[]> = {};
  const activeConfigId: Record<string, string> = {};

  for (const pipeline of pipelineDefinitions) {
    const base = defaultValues(pipeline);
    drafts[pipeline.id] = cloneValues(base);
    const defaultConfigId = `${pipeline.id}:default`;
    configs[pipeline.id] = [
      {
        id: defaultConfigId,
        pipelineId: pipeline.id,
        name: 'Default',
        values: cloneValues(base),
        builtin: true,
        updatedAt: pipeline.updatedAt,
      },
    ];
    activeConfigId[pipeline.id] = defaultConfigId;
  }

  return {
    pipelines: [...pipelineDefinitions],
    selected: new Set<string>(),
    activePipelineId: null,
    drafts,
    configs,
    activeConfigId,
  };
}

let state: PipelinesState = initialState();
const listeners = new Set<() => void>();

function emit(next: PipelinesState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PipelinesState {
  return state;
}

export function usePipelines(): PipelinesState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/* ------------------------------------------------------------------ */
/* Actions                                                             */
/* ------------------------------------------------------------------ */

/** Tick/untick a card for the next run. Also makes it the active card. */
export function toggleSelected(pipelineId: string): void {
  const selected = new Set(state.selected);
  if (selected.has(pipelineId)) selected.delete(pipelineId);
  else selected.add(pipelineId);
  emit({
    ...state,
    selected,
    activePipelineId: selected.has(pipelineId) ? pipelineId : state.activePipelineId,
  });
}

export function clearSelection(): void {
  emit({ ...state, selected: new Set<string>() });
}

/** Focus a pipeline so the Configuration panel shows it. */
export function setActivePipeline(pipelineId: string | null): void {
  if (state.activePipelineId === pipelineId) return;
  emit({ ...state, activePipelineId: pipelineId });
}

/** Edit one parameter of a pipeline's draft. */
export function setParam(
  pipelineId: string,
  stageId: string,
  paramId: string,
  value: ParamValue,
): void {
  const draft = state.drafts[pipelineId];
  if (!draft) return;
  const next: PipelineValues = {
    ...draft,
    [stageId]: { ...(draft[stageId] ?? {}), [paramId]: value },
  };
  emit({ ...state, drafts: { ...state.drafts, [pipelineId]: next } });
}

/** True when the draft differs from the configuration it was loaded from. */
export function isDirty(s: PipelinesState, pipelineId: string): boolean {
  const draft = s.drafts[pipelineId];
  const config = currentConfig(s, pipelineId);
  if (!draft || !config) return false;
  return !valuesEqual(draft, config.values);
}

export function currentConfig(
  s: PipelinesState,
  pipelineId: string,
): SavedConfiguration | undefined {
  const list = s.configs[pipelineId] ?? [];
  const activeId = s.activeConfigId[pipelineId];
  return list.find((c) => c.id === activeId) ?? list[0];
}

/** Load a saved configuration into the draft. */
export function selectConfig(pipelineId: string, configId: string): void {
  const config = (state.configs[pipelineId] ?? []).find((c) => c.id === configId);
  if (!config) return;
  emit({
    ...state,
    drafts: { ...state.drafts, [pipelineId]: cloneValues(config.values) },
    activeConfigId: { ...state.activeConfigId, [pipelineId]: configId },
  });
}

/** Overwrite the current configuration with the draft (built-ins are protected). */
export function saveOverwrite(pipelineId: string): boolean {
  const draft = state.drafts[pipelineId];
  const config = currentConfig(state, pipelineId);
  if (!draft || !config || config.builtin) return false;
  const list = (state.configs[pipelineId] ?? []).map((c) =>
    c.id === config.id
      ? { ...c, values: cloneValues(draft), updatedAt: new Date().toISOString() }
      : c,
  );
  emit({ ...state, configs: { ...state.configs, [pipelineId]: list } });
  return true;
}

/** Save the draft as a new named configuration and make it current. */
export function saveAsNew(pipelineId: string, name: string): void {
  const draft = state.drafts[pipelineId];
  if (!draft) return;
  const trimmed = name.trim() || 'Untitled configuration';
  const config: SavedConfiguration = {
    id: `${pipelineId}:${Date.now().toString(36)}`,
    pipelineId,
    name: trimmed,
    values: cloneValues(draft),
    updatedAt: new Date().toISOString(),
  };
  emit({
    ...state,
    configs: {
      ...state.configs,
      [pipelineId]: [...(state.configs[pipelineId] ?? []), config],
    },
    activeConfigId: { ...state.activeConfigId, [pipelineId]: config.id },
  });
}

/** Discard edits, restoring the current saved configuration. */
export function revertDraft(pipelineId: string): void {
  const config = currentConfig(state, pipelineId);
  if (!config) return;
  emit({
    ...state,
    drafts: { ...state.drafts, [pipelineId]: cloneValues(config.values) },
  });
}

export function deleteConfig(pipelineId: string, configId: string): void {
  const list = state.configs[pipelineId] ?? [];
  const target = list.find((c) => c.id === configId);
  if (!target || target.builtin) return;
  const remaining = list.filter((c) => c.id !== configId);
  const fallback = remaining[0];
  emit({
    ...state,
    configs: { ...state.configs, [pipelineId]: remaining },
    activeConfigId: { ...state.activeConfigId, [pipelineId]: fallback?.id ?? '' },
    drafts: fallback
      ? { ...state.drafts, [pipelineId]: cloneValues(fallback.values) }
      : state.drafts,
  });
}

/** Find a pipeline by id, including user-created ones. */
export function getPipeline(
  s: PipelinesState,
  pipelineId: string,
): PipelineDefinition | undefined {
  return s.pipelines.find((p) => p.id === pipelineId);
}

/**
 * Create a new pipeline from composed stages, seed its Default configuration,
 * and focus it so the Configuration panel opens on it. Returns the new id.
 */
export function createPipeline(input: {
  name: string;
  description: string;
  stages: StageDef[];
}): string {
  const id = `user-${Date.now().toString(36)}`;
  const pipeline: PipelineDefinition = {
    id,
    name: input.name.trim() || 'Untitled pipeline',
    description: input.description.trim() || 'User-created pipeline.',
    tags: ['user'],
    inputKind: 'raw',
    stages: input.stages,
    author: 'you',
    updatedAt: new Date().toISOString(),
  };

  const base = defaultValues(pipeline);
  const configId = `${id}:default`;

  emit({
    ...state,
    pipelines: [...state.pipelines, pipeline],
    drafts: { ...state.drafts, [id]: cloneValues(base) },
    configs: {
      ...state.configs,
      [id]: [
        {
          id: configId,
          pipelineId: id,
          name: 'Default',
          values: cloneValues(base),
          builtin: true,
          updatedAt: pipeline.updatedAt,
        },
      ],
    },
    activeConfigId: { ...state.activeConfigId, [id]: configId },
    activePipelineId: id,
  });

  return id;
}

/** Subscribe outside React (used to front the Configuration tab on selection). */
export function subscribePipelines(listener: () => void): () => void {
  return subscribe(listener);
}

export function getPipelinesState(): PipelinesState {
  return state;
}
