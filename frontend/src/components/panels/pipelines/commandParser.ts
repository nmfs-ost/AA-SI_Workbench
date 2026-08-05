/**
 * Turning a typed shell command into pipeline stages.
 *
 * ## The problem this solves
 *
 * A pipeline used to be built by clicking tool buttons. That is fine for the
 * eight tools the catalogue knows and useless for everything else — every
 * `aa-*` tool that ships after it was written, plus the whole Unix toolbox,
 * which is genuinely useful in a pipe chain. The escape hatch was one
 * "Custom command" button producing an opaque freeform stage, so the choice
 * was: structure for a handful of tools, or a text box with no structure at
 * all.
 *
 * The answer is not to pick one. A command line is already the notation
 * everyone here types, reads in the docs and pastes from a colleague — so the
 * command is the input, and the structure is *recovered from it*:
 *
 *   • Split on top-level pipes; each segment is a stage.
 *   • If the segment's program is in the catalogue **and every token maps to a
 *     declared flag**, the stage is structured: real params, a working
 *     Configuration panel, an argv the job runner can execute.
 *   • Otherwise the stage keeps the text verbatim and runs as a freeform one.
 *
 * The tool buttons still exist — they now insert into the command box rather
 * than appending a hidden stage — so discovery and free typing act on one
 * artifact instead of two that can disagree.
 *
 * ## The all-or-nothing rule
 *
 * A stage is structured only if *every* token is accounted for. Partial mapping
 * is the tempting version and it is the dangerous one: `aa-combine --sort time
 * --nonexistent-flag x` would keep the two flags it understood, silently drop
 * the third, and generate a command that is not the one the user typed. Since
 * the whole promise here is "what you typed is what runs", an unrecognised
 * token demotes its stage to freeform, where the text is preserved exactly.
 * `ParsedStage.unmapped` says which token did it, so the demotion is visible
 * rather than mysterious.
 *
 * ## Scope
 *
 * A pipe splitter and a token splitter, not a shell. Quoting, escapes and pipes
 * are handled because they appear in commands people actually paste;
 * redirection, subshells, globbing, variables and `&&` are not interpreted —
 * they land in a segment, fail the mapping rule, and end up in a freeform stage
 * that is handed to a real shell. That is the correct outcome for all of them,
 * and it is why the parser can be this small.
 */

import { findTool, makeStage, type ToolTemplate } from './toolCatalog';
import {
  COMMAND_OVERRIDE,
  INPUT_TOKEN,
  type ParamDef,
  type ParamValue,
  type StageDef,
} from './pipelineTypes';

/**
 * Split a command on pipes that are not inside quotes.
 *
 * `grep -v "a|b"` is one stage, not two. Getting this wrong splits a command
 * into fragments that individually parse and collectively mean something else.
 */
export function splitPipeline(command: string): string[] {
  const segments: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (let i = 0; i < command.length; i += 1) {
    const char = command[i];

    if (quote) {
      // Inside single quotes a backslash is literal — that is the whole point
      // of single quotes, and treating it as an escape corrupts a Windows-style
      // path or a regex the user quoted precisely to protect.
      if (char === '\\' && quote === '"' && i + 1 < command.length) {
        current += char + command[i + 1];
        i += 1;
        continue;
      }
      if (char === quote) quote = null;
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === '\\' && i + 1 < command.length) {
      current += char + command[i + 1];
      i += 1;
      continue;
    }
    if (char === '|') {
      segments.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  segments.push(current);
  return segments.map((segment) => segment.trim()).filter((segment) => segment !== '');
}

/**
 * Split one segment into tokens, removing one level of quoting.
 *
 * The returned strings are *values*, not source: `-o "my dir"` yields `-o` and
 * `my dir`. That matters because the values become parameter values, and a
 * parameter holding `"my dir"` with the quotes still on would be re-quoted on
 * the way out and reach the tool as a directory whose name contains quote
 * marks.
 */
export function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let quote: '"' | "'" | null = null;

  const flush = () => {
    if (started) tokens.push(current);
    current = '';
    started = false;
  };

  for (let i = 0; i < segment.length; i += 1) {
    const char = segment[i];

    if (quote) {
      if (char === '\\' && quote === '"' && i + 1 < segment.length) {
        current += segment[i + 1];
        i += 1;
        continue;
      }
      if (char === quote) {
        quote = null;
        continue;
      }
      current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      // An empty quoted string is still a token: `--label ""` passes an empty
      // argument, which is different from passing none.
      started = true;
      continue;
    }
    if (char === '\\' && i + 1 < segment.length) {
      current += segment[i + 1];
      started = true;
      i += 1;
      continue;
    }
    if (/\s/.test(char)) {
      flush();
      continue;
    }
    current += char;
    started = true;
  }

  flush();
  return tokens;
}

export interface ParsedStage {
  /** The segment exactly as typed. What a freeform stage runs. */
  raw: string;
  /** argv[0] — the program. */
  tool: string;
  /** The catalogue entry, when the tool is one this Workbench knows. */
  template: ToolTemplate | undefined;
  /** True when every token mapped and the stage can be structured. */
  structured: boolean;
  /** paramId -> value, for a structured stage. */
  values: Record<string, ParamValue>;
  /** Tokens that stopped it being structured. Shown to explain the demotion. */
  unmapped: string[];
}

/** Find the param a flag spelling belongs to. */
function paramForFlag(params: readonly ParamDef[], flag: string): ParamDef | undefined {
  return params.find((param) => param.flag === flag);
}

/** Coerce a token to the type the parameter declares. */
function coerce(param: ParamDef, raw: string): ParamValue {
  if (param.type === 'number') {
    const value = Number(raw);
    return Number.isFinite(value) ? value : raw;
  }
  if (param.type === 'multi') {
    return raw
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '');
  }
  return raw;
}

/**
 * Map one segment onto a catalogue entry.
 *
 * Positionals fill `input`/`target` params in declaration order, which is the
 * order those tools take them in. A second positional with nowhere to go is
 * unmapped rather than overwriting the first — two candidate inputs and nothing
 * to say which the tool reads is precisely the state `ParamDef.role` exists to
 * prevent.
 */
export function parseSegment(segment: string): ParsedStage {
  const raw = segment.trim();
  const tokens = tokenize(raw);
  const tool = tokens[0] ?? '';
  const template = findTool(tool);

  const base: ParsedStage = {
    raw,
    tool,
    template,
    structured: false,
    values: {},
    unmapped: [],
  };

  // No entry, or an entry that is itself the freeform escape hatch: there is
  // no structure to recover, and pretending otherwise would invent flags.
  if (!template || template.freeform) return base;

  const params = template.params;
  const values: Record<string, ParamValue> = {};
  const unmapped: string[] = [];
  const positionals = params.filter(
    (param) => param.role === 'input' || param.role === 'target',
  );
  let positionalIndex = 0;

  for (let i = 1; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token.startsWith('-') && token.length > 1) {
      // `--flag=value` and `--flag value` are the same thing to argparse, and
      // both spellings turn up in pasted commands.
      const equals = token.indexOf('=');
      const flag = equals === -1 ? token : token.slice(0, equals);
      const inline = equals === -1 ? null : token.slice(equals + 1);

      const param = paramForFlag(params, flag);
      if (!param) {
        unmapped.push(token);
        continue;
      }

      if (param.type === 'boolean') {
        // `--strict=false` is not something argparse's store_true accepts, so
        // an inline value on a boolean is a command this parser should not
        // claim to understand.
        if (inline !== null) {
          unmapped.push(token);
          continue;
        }
        values[param.id] = true;
        continue;
      }

      const value = inline ?? tokens[i + 1];
      if (value === undefined) {
        // A flag with no value: the command is incomplete, and guessing a
        // default would produce a different command from the one typed.
        unmapped.push(token);
        continue;
      }
      if (inline === null) i += 1;
      values[param.id] = coerce(param, value);
      continue;
    }

    const positional = positionals[positionalIndex];
    if (!positional) {
      unmapped.push(token);
      continue;
    }
    values[positional.id] = token;
    positionalIndex += 1;
  }

  return {
    ...base,
    structured: unmapped.length === 0,
    values,
    unmapped,
  };
}

/** Every stage in a typed command, in order. */
export function parseCommand(command: string): ParsedStage[] {
  return splitPipeline(command).map(parseSegment);
}

/**
 * The freeform template for a segment.
 *
 * The literal path a user typed is replaced by `{input}` so the stage keeps
 * working when a different file is selected — that substitution is what makes
 * a hand-written stage a *template* rather than a one-off. Only an already
 * tokenised absolute path is replaced, so a flag value that merely resembles
 * one is left alone.
 */
export function templateForSegment(raw: string, injectedInput: string | null): string {
  if (!injectedInput) return raw;
  const tokens = tokenize(raw);
  if (!tokens.includes(injectedInput)) return raw;
  // Replace the quoted and bare spellings, longest first, so a quoted path is
  // not left holding a stray pair of quotes around the token.
  return [`"${injectedInput}"`, `'${injectedInput}'`, injectedInput].reduce(
    (text, spelling) => text.split(spelling).join(INPUT_TOKEN),
    raw,
  );
}

export interface BuiltPipeline {
  stages: StageDef[];
  /** stageId -> paramId -> value, ready to seed the Default configuration. */
  values: Record<string, Record<string, ParamValue>>;
}

/**
 * Build the stages and their starting values from a parsed command.
 *
 * Values are returned separately rather than baked into each `ParamDef.default`
 * because a default is a different claim from a value: `pipelineTypes` records
 * that an untouched field must send nothing, so that the tool's own default
 * keeps applying and a later change to it still takes effect. Rewriting the
 * defaults here would turn every flag the user happened to type into a value
 * pinned forever into that pipeline.
 */
export function buildPipeline(
  parsed: readonly ParsedStage[],
  injectedInput: string | null = null,
): BuiltPipeline {
  const stages: StageDef[] = [];
  const values: Record<string, Record<string, ParamValue>> = {};

  parsed.forEach((stage, index) => {
    if (stage.structured && stage.template) {
      const built = makeStage(stage.template, index);
      stages.push(built);
      values[built.id] = { ...stage.values };
      return;
    }

    /* Freeform. Named after the program rather than `sh-3`, because a step
       list reading "sh, sh, sh" tells the reader nothing — and the program is
       known even when its flags are not. */
    const label = stage.tool || 'command';
    const built: StageDef = {
      id: `${label.replace(/[^\w-]/g, '') || 'command'}-${index + 1}`,
      tool: stage.tool || 'sh',
      label: stage.template?.label ?? 'Custom command',
      description: stage.template
        ? `${stage.template.description} Written by hand.`
        : 'Written by hand.',
      params: [],
      freeform: true,
    };
    stages.push(built);
    values[built.id] = {
      [COMMAND_OVERRIDE]: templateForSegment(stage.raw, injectedInput),
    };
  });

  return { stages, values };
}
