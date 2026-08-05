/**
 * The first-tier sequence: acquire → convert → assemble → verify.
 *
 * What this replaces, and why
 * --------------------------
 * `COMBINE_STAGES` declared four stages and `StageStrip` drew all four with
 * numbers and tool names. The command the panel actually emitted was one
 * `aa-combine`. Stages 1 and 2 were rendered as if they ran and never did; the
 * only acknowledgement was a line of muted 10.5px text underneath saying the
 * raw files have to be local first. A user who trusts the numbered strip runs
 * Combine against an empty directory and gets an error from deep inside
 * echopype about a missing group.
 *
 * So a stage here is not a label. It is something that can be *run*, and it
 * carries what running it requires: how it is invoked, what it produces, and
 * whether this Workbench has any right to claim it will work.
 *
 * Verification is resolved live, not asserted
 * -------------------------------------------
 * `toolCatalog.ts` carries a hand-written `verified` boolean, and its own
 * header admits the problem: it is a manual assertion, in a different repo, on
 * a different release cadence, and it goes stale silently. That is how
 * `aa-raw` came to be rendered as stage 2 in a numbered badge when the project
 * notes call the converter `aa-ed` / `aa-nc`.
 *
 * A stage therefore declares no `verified` flag at all. It names a tool, and
 * `resolveStage` answers the question against two live sources:
 *
 *   • `/api/env`            — is this tool installed here, and at what version
 *   • `/api/tools/describe` — does it answer `--describe`, so its flags are
 *                             read off its own parser rather than guessed
 *
 * A tool that is absent says so. A tool that is present but cannot describe
 * itself is runnable-but-unconfirmed, which is a different and weaker claim
 * than the catalogue's `verified: true`, and the strip renders the difference.
 *
 * Where a stage runs
 * ------------------
 * `job` goes to the runner in `/api/jobs`: stdin closed, streams separate,
 * exit 3 offered as Resume. `terminal` is typed into the Terminal panel,
 * reserved for tools that hold a *conversation* — `aa-get` and `aa-fetch`
 * prompt, and a job runner would hang on the first question with nobody to
 * answer it.
 *
 * That distinction used to force the whole acquisition path into the terminal.
 * `aa-request` is what changes it: a non-interactive `aa-get` emitting the same
 * YAML `aa-fetch` reads. Acquisition stops being a conversation, so it can be
 * queued, watched and resumed like everything else.
 */

import type { ToolInfo } from '../../../services/environmentApi';

/** How a stage is invoked. */
export type RunVia = 'job' | 'terminal';

/**
 * A verb within a stage.
 *
 * Most of the difference between two invocations of the same tool is which
 * verb was chosen, not which flags were set — `aa-combine --check` and
 * `aa-combine -o out.zarr` are barely the same operation. Picking the mode
 * first and the flags second is the shape the tools already have.
 */
export interface StageMode {
  id: string;
  label: string;
  /** Extra argv this mode contributes, before the stage's own options. */
  flags: readonly string[];
  /**
   * False marks a mode safe to fire without confirmation. `--check` and
   * `--plan` write nothing, which is exactly what makes "check before you run"
   * a reasonable default rather than an extra click to resent.
   */
  writes: boolean;
  description: string;
  /**
   * Exit 4 from a non-writing mode is a *finding*, not a crash — the QC pass
   * did its job. Stages set this so the runner can stop the sequence and show
   * the finding instead of reporting a failure.
   */
  findingOnExit4?: boolean;
}

export interface SequenceStage {
  id: string;
  label: string;
  /** The console tool, as it would be typed. */
  tool: string;
  description: string;
  runsVia: RunVia;
  /**
   * Verbs, mutually exclusive. The first is the default. A stage with one mode
   * renders as a plain step; a stage with several renders a mode picker.
   */
  modes: readonly StageMode[];
  /**
   * Set when this Workbench cannot yet compose a correct command line for the
   * stage, independently of whether the tool is installed. The text is the
   * open question, phrased as the thing that would settle it — a stage that
   * says "I don't know what this takes" is worth more than one that guesses
   * and renders the guess as a numbered badge.
   */
  unresolved?: string;
  /** Alternative spellings to accept when checking whether it is installed. */
  aliases?: readonly string[];
}

/* ------------------------------------------------------------------ */
/* The sequence                                                        */
/* ------------------------------------------------------------------ */

export const FIRST_TIER: readonly SequenceStage[] = [
  {
    id: 'request',
    label: 'Request',
    tool: 'aa-request',
    description:
      'Write the request document naming vessel, survey, instrument and time windows. The non-interactive path a job runner can drive.',
    runsVia: 'job',
    modes: [
      {
        id: 'build',
        label: 'Build',
        flags: [],
        writes: true,
        description: 'Compose the document from the current selection.',
      },
      {
        id: 'check',
        label: 'Check',
        flags: ['--check'],
        writes: false,
        findingOnExit4: true,
        description:
          'Validate before downloading: reversed windows, overlaps, missing fields, unquoted YAML 1.1 values.',
      },
    ],
  },
  {
    id: 'fetch',
    label: 'Fetch',
    tool: 'aa-fetch',
    description: 'Download the files the request names.',
    // Interactive until proven otherwise. If it prompts, a queued job waits on
    // a question nobody can answer, so this one is typed into the terminal and
    // the sequence pauses here rather than pretending it continued.
    runsVia: 'terminal',
    modes: [
      {
        id: 'run',
        label: 'Fetch',
        flags: [],
        writes: true,
        description: 'Copy the raw files to this workstation.',
      },
    ],
    unresolved:
      'Does aa-fetch take the request document positionally, and does it still prompt when given one? `aa-fetch --help` settles both. Until then it runs in the Terminal where a prompt can be answered.',
  },
  {
    id: 'convert',
    label: 'Convert',
    tool: 'aa-ed',
    aliases: ['aa-nc', 'aa-raw'],
    description: 'Each raw file becomes a converted EchoData dataset.',
    runsVia: 'job',
    modes: [
      {
        id: 'run',
        label: 'Convert',
        flags: [],
        writes: true,
        description: 'Convert the downloaded raws.',
      },
    ],
    unresolved:
      'The converter was rendered here as `aa-raw`; the project notes call it `aa-ed` / `aa-nc`, and whether it writes .nc or .zarr decides whether its output pipes into Assemble at all. `aa-ed --help` settles it.',
  },
  {
    id: 'assemble',
    label: 'Assemble',
    tool: 'aa-combine',
    description:
      'Merge the converted datasets into one store, in time order. Never across a calibration change, a channel-config change or a transit gap.',
    runsVia: 'job',
    modes: [
      {
        id: 'check',
        label: 'Check',
        flags: ['--check'],
        writes: false,
        findingOnExit4: true,
        description:
          'The QC pass, writing nothing. Names which file breaks which precondition, plus seams, overlaps, duplicate ping times and ragged range. This is the safe thing to run first — and the only thing that sees a calibration or channel-config change, which is inside the files and invisible to the timestamp check above.',
      },
      {
        id: 'plan',
        label: 'Plan',
        flags: ['--plan'],
        writes: false,
        description:
          'Files, pings, channels, estimated bytes and the chunk count. Writes nothing.',
      },
      {
        id: 'run',
        label: 'Combine',
        flags: [],
        writes: true,
        description: 'The combine itself.',
      },
    ],
  },
  {
    id: 'verify',
    label: 'Verify',
    tool: 'aa-store',
    description:
      'Judge the store that was just written: complete, unfinished and resumable, or finished and wrong.',
    runsVia: 'job',
    modes: [
      {
        id: 'verify',
        label: 'Verify',
        flags: ['verify', '--json'],
        writes: false,
        findingOnExit4: true,
        description:
          'Exit 0 complete · 3 unfinished and resumable · 4 finished and wrong.',
      },
      {
        id: 'info',
        label: 'Describe',
        flags: ['info', '--json'],
        writes: false,
        description:
          'Dims, chunk shape, codec, chunks written against expected, stored against logical bytes, and the lineage the producer recorded.',
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Live resolution                                                     */
/* ------------------------------------------------------------------ */

/** How much this Workbench can honestly claim about a stage. */
export type StageConfidence =
  /** Installed, and it describes its own flags. Nothing here is a guess. */
  | 'described'
  /** Installed, but its flags come from this repo rather than from the tool. */
  | 'installed'
  /** Not present in this environment. */
  | 'missing'
  /** Present or not, the command line is an open question. */
  | 'unresolved';

export interface ResolvedStage {
  stage: SequenceStage;
  confidence: StageConfidence;
  /** The name actually found, which may be an alias rather than `tool`. */
  resolvedTool: string;
  version: string;
  /** One sentence naming what is uncertain and what would settle it. */
  note: string;
  /** False when firing this stage could only produce an error. */
  runnable: boolean;
}

/**
 * Resolve one stage against the installed environment.
 *
 * `describedTools` is the set that answered `--describe` (from
 * `/api/tools/describe`). It is deliberately a separate input from the
 * installed list: being present and being self-describing are two different
 * claims, and collapsing them is how a hand-written flag set gets to wear the
 * same badge as one read off the tool's own parser.
 */
export function resolveStage(
  stage: SequenceStage,
  tools: readonly ToolInfo[],
  describedTools: ReadonlySet<string>,
): ResolvedStage {
  const names = [stage.tool, ...(stage.aliases ?? [])];
  const found = names
    .map((name) => tools.find((tool) => tool.name === name))
    .find(Boolean);

  if (!found) {
    return {
      stage,
      confidence: 'missing',
      resolvedTool: stage.tool,
      version: '',
      note:
        names.length > 1
          ? `None of ${names.join(', ')} is installed in this environment.`
          : `${stage.tool} is not installed in this environment.`,
      runnable: false,
    };
  }

  if (stage.unresolved) {
    return {
      stage,
      confidence: 'unresolved',
      resolvedTool: found.name,
      version: found.version,
      // The tool is here; what it takes is the open part. Say which, because
      // "unverified" without the question attached is how the last set of
      // guesses survived three files.
      note: stage.unresolved,
      runnable: true,
    };
  }

  if (describedTools.has(found.name)) {
    return {
      stage,
      confidence: 'described',
      resolvedTool: found.name,
      version: found.version,
      note: '',
      runnable: true,
    };
  }

  return {
    stage,
    confidence: 'installed',
    resolvedTool: found.name,
    version: found.version,
    note: `${found.name} is installed but does not answer --describe, so these flags come from this repo rather than from the tool. Check with \`${found.name} --help\`.`,
    runnable: true,
  };
}

export function resolveSequence(
  tools: readonly ToolInfo[],
  describedTools: ReadonlySet<string>,
  stages: readonly SequenceStage[] = FIRST_TIER,
): ResolvedStage[] {
  return stages.map((stage) => resolveStage(stage, tools, describedTools));
}

/** The default mode for a stage: the first declared. */
export function defaultMode(stage: SequenceStage): StageMode {
  return stage.modes[0];
}

export function findMode(stage: SequenceStage, id: string): StageMode {
  return stage.modes.find((mode) => mode.id === id) ?? defaultMode(stage);
}

/**
 * Whether a stage's outcome should stop the sequence.
 *
 * Exit 4 from a checking mode is the QC pass working, and the sequence must
 * stop — proceeding into a combine that `--check` just refused is precisely
 * the mistake `--check` exists to prevent. Exit 3 stops too, but it is
 * resumable, so the queue offers Resume rather than a dead end.
 */
export function stopsSequence(exitCode: number | null): boolean {
  return exitCode !== null && exitCode !== 0;
}
