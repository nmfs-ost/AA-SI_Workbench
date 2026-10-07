import type {
  Catalogue,
  ParamValue,
  PipelineSpec,
  StageSpec,
  ToolDef,
  ToolParam,
} from '../../../services/pipelinesApi';

/**
 * How stages fit together, for the card's own quick answers: which pipelines
 * can take the selected product, where they pick it up, what a stage may be
 * followed by. The server's plan is the authority before a run (it also reads
 * the product's history); these answer instantly while the user browses.
 */

export const KIND_LABELS: Record<string, string> = {
  raw: 'Raw',
  echodata: 'EchoData',
  sv: 'Sv',
  ts: 'TS',
  mask: 'Mask',
  seafloor: 'Seafloor line',
  noise: 'Noise',
  mvbs: 'MVBS',
  nasc: 'NASC',
  echometric: 'Echometric',
  echogram: 'Echogram',
  html: 'Interactive plot',
};

export function kindLabel(kind: string, catalogue?: Catalogue | null): string {
  if (!kind) return 'unknown';
  return catalogue?.kinds[kind] ?? KIND_LABELS[kind] ?? kind;
}

export function toolOf(catalogue: Catalogue | null, name: string): ToolDef | undefined {
  return catalogue?.tools.find((t) => t.name === name);
}

/** Steps that are not console tools: a Bash command or Python code of your own. */
export const OWN_STEPS: Record<string, string> = { bash: 'Shell command', python: 'Python' };

export function isOwn(stage: StageSpec): boolean {
  return stage.tool in OWN_STEPS;
}

/** A new step of your own, ready to edit. */
export function ownStep(tool: 'bash' | 'python'): StageSpec {
  return {
    tool,
    params: {},
    command: tool === 'bash' ? 'tee -a "$HOME/pipeline.log"' : 'import sys\n\nproduct = sys.stdin.read().strip()\nprint(product)',
    label: '',
    produces: '',
  };
}

/** A stage's name: the tool's label, or the name given to a step of your own. */
export function stageLabel(stage: StageSpec, catalogue: Catalogue | null): string {
  if (isOwn(stage)) return stage.label?.trim() || OWN_STEPS[stage.tool];
  return toolOf(catalogue, stage.tool)?.label ?? stage.tool;
}

/** The first line of a step's command, shortened for a card. */
export function commandPreview(stage: StageSpec, max = 48): string {
  const line = (stage.command ?? '').split('\n').find((l) => l.trim() && !l.trim().startsWith('#'))?.trim() ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

/** The kind a stage writes, given the kind it reads. */
export function producedBy(tool: ToolDef, reads: string): string {
  return tool.passthrough && reads ? reads : tool.produces;
}

/** Every stage from here reads what the one before it writes. */
function chainHolds(stages: StageSpec[], kind: string, catalogue: Catalogue): boolean {
  let current = kind;
  for (const stage of stages) {
    if (isOwn(stage)) {
      current = stage.produces || current;
      continue;
    }
    const tool = toolOf(catalogue, stage.tool);
    if (!tool || !tool.consumes.includes(current)) return false;
    current = producedBy(tool, current);
  }
  return true;
}

/**
 * Where a pipeline picks up a product of this kind: the first stage that reads
 * it and from which the rest of the chain holds (earlier stages are already
 * done); failing that, the first that reads it. -1: no stage reads it. An
 * unknown kind starts at the beginning. (The server's rule, plan() in
 * pipelines.py.)
 */
export function startIndex(stages: StageSpec[], kind: string, catalogue: Catalogue): number {
  if (!kind) return 0;
  // A step of your own reads anything: the chain may start at one.
  const readers = stages
    .map((s, i) => (isOwn(s) || toolOf(catalogue, s.tool)?.consumes.includes(kind) ? i : -1))
    .filter((i) => i >= 0);
  const holds = readers.find((i) => chainHolds(stages.slice(i), kind, catalogue));
  if (holds !== undefined) return holds;
  return readers.find((i) => !isOwn(stages[i])) ?? readers[0] ?? -1;
}

export interface Fit {
  ok: boolean;
  /** Stages skipped because the input is already past them. */
  skipped: number;
  reason: string;
}

/** Whether a pipeline can take every selected product, and how. */
export function fit(pipeline: PipelineSpec, kinds: string[], catalogue: Catalogue): Fit {
  const missingTool = (s: StageSpec) => !isOwn(s) && !toolOf(catalogue, s.tool);
  if (pipeline.stages.some(missingTool)) {
    const missing = pipeline.stages.find(missingTool)!.tool;
    return { ok: false, skipped: 0, reason: `${missing} is not installed.` };
  }
  if (kinds.length === 0) return { ok: true, skipped: 0, reason: '' };
  let skipped = 0;
  for (const kind of new Set(kinds)) {
    const start = startIndex(pipeline.stages, kind, catalogue);
    if (start >= 0 && !chainHolds(pipeline.stages.slice(start), kind, catalogue)) {
      return { ok: false, skipped: 0, reason: `The chain breaks after ${kindLabel(kind, catalogue)} comes in.` };
    }
    if (start < 0) {
      const first = toolOf(catalogue, pipeline.stages.find((s) => !isOwn(s))?.tool ?? '');
      const wants = first ? first.consumes.map((k) => kindLabel(k, catalogue)).join(' or ') : '';
      return {
        ok: false,
        skipped: 0,
        reason: `Starts from ${wants || 'another kind of product'}, not ${kindLabel(kind, catalogue)}.`,
      };
    }
    skipped = Math.max(skipped, start);
  }
  return { ok: true, skipped, reason: '' };
}

/** What each stage reads and writes, walking the chain from an input kind. */
export function walk(
  stages: StageSpec[],
  catalogue: Catalogue,
  inputKind = '',
): { reads: string; writes: string; skip: boolean; mismatch: string }[] {
  const start = Math.max(0, startIndex(stages, inputKind, catalogue));
  let kind = inputKind;
  return stages.map((stage, i) => {
    if (isOwn(stage)) {
      if (i < start) return { reads: '', writes: stage.produces || '', skip: true, mismatch: '' };
      const reads = kind;
      kind = stage.produces || kind;
      const mismatch = stage.command?.trim() ? '' : `${stageLabel(stage, catalogue)}: write its command.`;
      return { reads, writes: kind, skip: false, mismatch };
    }
    const tool = toolOf(catalogue, stage.tool);
    if (!tool) return { reads: kind, writes: '', skip: false, mismatch: `${stage.tool} is not installed.` };
    if (i < start) return { reads: '', writes: tool.produces, skip: true, mismatch: '' };
    const reads = kind;
    const mismatch =
      reads && !tool.consumes.includes(reads)
        ? `${tool.name} reads ${tool.consumes.map((k) => kindLabel(k, catalogue)).join(' or ')}, not ${kindLabel(reads, catalogue)}.`
        : '';
    kind = producedBy(tool, reads);
    return { reads, writes: kind, skip: false, mismatch };
  });
}

/** Tools that can follow a stage writing `kind` (all, before the first stage). */
export function toolsReading(kind: string, catalogue: Catalogue): ToolDef[] {
  return kind ? catalogue.tools.filter((t) => t.consumes.includes(kind)) : catalogue.tools;
}

export function sameValue(a: ParamValue | undefined, b: ParamValue | undefined): boolean {
  const empty = (v: ParamValue | undefined) => v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);
  if (empty(a) || empty(b)) return empty(a) && empty(b);
  if (Array.isArray(a) || Array.isArray(b)) return JSON.stringify(a) === JSON.stringify(b);
  if (typeof a === 'number' || typeof b === 'number') return Number(a) === Number(b);
  return a === b;
}

/** A stage with one setting changed; a value equal to the default is dropped. */
export function withParam(
  stage: StageSpec,
  param: ToolParam,
  value: ParamValue | undefined,
): StageSpec {
  const params = { ...stage.params };
  if (value === undefined || sameValue(value, param.default)) delete params[param.id];
  else params[param.id] = value;
  return { ...stage, params };
}

export function stagesEqual(a: StageSpec[], b: StageSpec[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => {
    const t = b[i];
    if (s.tool !== t.tool) return false;
    if ((s.command ?? '') !== (t.command ?? '') || (s.label ?? '') !== (t.label ?? '')) return false;
    if ((s.produces ?? '') !== (t.produces ?? '')) return false;
    const keys = new Set([...Object.keys(s.params), ...Object.keys(t.params)]);
    return [...keys].every((k) => sameValue(s.params[k], t.params[k]));
  });
}

/** "a13d29c5": the first characters of a hash, as the tools print them. */
export function shortHash(hash: string, n = 8): string {
  return hash ? hash.slice(0, n) : '';
}

/** The settings a stage changes, as "Range bin 5m · Method coarsen". */
export function describeValues(stage: StageSpec, tool: ToolDef | undefined): string {
  if (isOwn(stage)) return commandPreview(stage);
  if (!tool) return '';
  return tool.params
    .filter((p) => p.id in stage.params)
    .map((p) => {
      const v = stage.params[p.id];
      if (p.type === 'bool') return v ? p.label : `${p.label} off`;
      if (Array.isArray(v)) return `${p.label} ${v.join(' ')}`;
      return `${p.label} ${String(v)}`;
    })
    .join(' · ');
}

/** A stage's command as typed: a step of your own shows its code as written. */
export function commandText(tool: string, command: string[]): string {
  const code = command[command.length - 1] ?? '';
  if (tool === 'bash') return code.split('\n').map((line, i) => `${i ? '> ' : '$ '}${line}`).join('\n');
  if (tool === 'python') return `# Python\n${code}`;
  return `$ ${command.join(' ')}`;
}
