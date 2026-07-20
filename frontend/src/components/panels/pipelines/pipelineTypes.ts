/**
 * Pipeline schema — the single source of truth for the whole feature.
 *
 * A pipeline is a saved chain of console-tool stages (aa-fetch → aa-raw →
 * aa-combine → …). Every stage declares its parameters, and every parameter
 * declares a `type`. That type is what drives the UI: one renderer maps
 * type → control (enum → dropdown, number → numeric field, boolean → checkbox,
 * path → file selector, …).
 *
 * The same definition generates three things, so they can never drift apart:
 *   1. the compact widget on each pipeline card,
 *   2. the full Configuration panel on the right,
 *   3. the equivalent shell command preview.
 *
 * Adding a tool or a flag means editing a definition — never a component.
 */

/** Parameter kinds, each mapped to a specific control by ParamControl.tsx. */
export type ParamType =
  | 'string' // free text          -> TextField
  | 'number' // numeric            -> numeric TextField (min/max/step)
  | 'boolean' // on/off flag       -> Checkbox
  | 'enum' // one of a fixed set   -> Select dropdown
  | 'multi' // several of a set    -> multi Autocomplete (e.g. channels)
  | 'path' // directory / bucket   -> TextField + browse affordance
  | 'file'; // an input file       -> file selector (auto-injectable)

export type ParamValue = string | number | boolean | string[];

export interface ParamDef {
  id: string;
  label: string;
  type: ParamType;
  /** CLI flag this maps to, e.g. "-o" or "--channels". Omit for positionals. */
  flag?: string;
  default: ParamValue;
  /** Options for 'enum' / 'multi'. */
  options?: readonly string[];
  min?: number;
  max?: number;
  step?: number;
  placeholder?: string;
  /** One-line explanation shown as helper text / tooltip. */
  help?: string;
  /**
   * Shown in the card's compact widget. Non-primary params appear only in the
   * full Configuration panel, which keeps cards readable.
   */
  primary?: boolean;
  /**
   * Marks the stage input that the left-window file selection is injected into.
   * Such params are auto-filled and shown read-only with an "injected" hint.
   */
  role?: 'input';
}

export interface StageDef {
  id: string;
  /** The console tool this stage runs, e.g. "aa-combine". */
  tool: string;
  label: string;
  description: string;
  params: readonly ParamDef[];
}

export interface PipelineDefinition {
  id: string;
  name: string;
  description: string;
  /** Short tags rendered as chips on the card. */
  tags: readonly string[];
  /** What this pipeline expects as input; drives the injection hint. */
  inputKind: 'raw' | 'nc' | 'none';
  stages: readonly StageDef[];
  author: string;
  updatedAt: string; // ISO 8601
}

/** Values for one pipeline: stageId -> paramId -> value. */
export type PipelineValues = Record<string, Record<string, ParamValue>>;

/** A named, saved set of values for a pipeline. */
export interface SavedConfiguration {
  id: string;
  pipelineId: string;
  name: string;
  values: PipelineValues;
  /** Built-in configurations ship with the pipeline and can't be deleted. */
  builtin?: boolean;
  updatedAt: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** The values a pipeline starts with, taken from each param's default. */
export function defaultValues(pipeline: PipelineDefinition): PipelineValues {
  const values: PipelineValues = {};
  for (const stage of pipeline.stages) {
    values[stage.id] = {};
    for (const param of stage.params) {
      values[stage.id][param.id] = param.default;
    }
  }
  return values;
}

export function cloneValues(values: PipelineValues): PipelineValues {
  const copy: PipelineValues = {};
  for (const [stageId, params] of Object.entries(values)) {
    copy[stageId] = { ...params };
  }
  return copy;
}

export function valuesEqual(a: PipelineValues, b: PipelineValues): boolean {
  const stageIds = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const stageId of stageIds) {
    const pa = a[stageId] ?? {};
    const pb = b[stageId] ?? {};
    const paramIds = new Set([...Object.keys(pa), ...Object.keys(pb)]);
    for (const paramId of paramIds) {
      const va = pa[paramId];
      const vb = pb[paramId];
      if (Array.isArray(va) || Array.isArray(vb)) {
        const aa = Array.isArray(va) ? va : [];
        const bb = Array.isArray(vb) ? vb : [];
        if (aa.length !== bb.length || aa.some((v, i) => v !== bb[i])) return false;
      } else if (va !== vb) {
        return false;
      }
    }
  }
  return true;
}

/** Quote a shell token only when it needs it. */
function shellQuote(value: string): string {
  return /[\s"']/.test(value) ? `"${value}"` : value;
}

/**
 * Build the equivalent shell command for a pipeline, honouring the current
 * values and the injected input file. Generated from the same schema as the UI.
 */
export function buildCommand(
  pipeline: PipelineDefinition,
  values: PipelineValues,
  injectedInput: string | null,
): string[] {
  return pipeline.stages.map((stage) => {
    const parts: string[] = [stage.tool];
    for (const param of stage.params) {
      const raw = values[stage.id]?.[param.id] ?? param.default;

      if (param.role === 'input') {
        const resolved = injectedInput ?? (typeof raw === 'string' ? raw : '');
        if (resolved) parts.push(shellQuote(resolved));
        continue;
      }

      if (param.type === 'boolean') {
        if (raw === true && param.flag) parts.push(param.flag);
        continue;
      }

      if (param.type === 'multi') {
        const list = Array.isArray(raw) ? raw : [];
        if (list.length > 0) {
          if (param.flag) parts.push(param.flag);
          parts.push(shellQuote(list.join(',')));
        }
        continue;
      }

      const text = String(raw ?? '').trim();
      if (!text) continue;
      if (param.flag) parts.push(param.flag);
      parts.push(shellQuote(text));
    }
    return parts.join(' ');
  });
}
