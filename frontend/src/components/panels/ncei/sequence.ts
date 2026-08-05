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

/** What discovery knows about one installed tool. */
export interface DiscoveredTool {
  name: string;
  version: string;
  /** describe | source | help — which layer read its flags. */
  discovery: string;
  paramCount: number;
}

/** How a stage is invoked. */
export type RunVia = 'job' | 'terminal';

/**
 * A verb within a stage.
 *
 * Most of the difference between two invocations of the same tool is which
 * verb was chosen, not which flags were set — `aa-combine --check` and
 * `aa-combine -o out.zarr` are barely the same operation. Picking the mode
 * first and the flags second is the shape the tools already have.
 *
 * A mode is a *verb*, never a variant of one. `aa-ed --recursive` is the same
 * operation over a wider glob, so it is a flag and belongs in the options form;
 * making it a mode would put two writing entries in one picker and turn "which
 * verb" into "which spelling". At most one mode per stage may write, and a test
 * enforces it — that invariant is what keeps the picker meaning one thing.
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
  /**
   * An optional stage does not gate the ones after it and is not required for
   * the sequence to be complete. Publishing is the case: a store that was
   * combined and verified is a finished artifact whether or not it was copied
   * to a bucket.
   */
  optional?: boolean;
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
    description:
      'Run the request document: build the query, download every matching file into one run directory, and print that directory on stdout.',
    // Was `terminal`, on the assumption aa-fetch prompts. It does not — it
    // takes the document positionally, falls back to a single line of stdin,
    // and never asks a question. So it queues like everything else, and the
    // sequence keeps its progress and its exit code instead of losing both to
    // a shell. `aa-get` is the interactive one; aa-fetch is not.
    runsVia: 'job',
    modes: [
      {
        id: 'run',
        label: 'Fetch',
        flags: [],
        writes: true,
        description: 'Download the files the request names.',
      },
    ],
  },
  {
    id: 'convert',
    label: 'Convert',
    tool: 'aa-ed',
    // aa-nc is the single-file, --sonar_model-required form; aa-raw was the
    // name this panel invented. Both accepted so a differently-provisioned
    // environment still resolves, with the found name reported.
    aliases: ['aa-nc', 'aa-raw'],
    description:
      'Convert every .raw in the run directory to a multi-group NetCDF EchoData file, in place. Given a directory, aa-ed prints the directory back — which is what makes the next stage a directory read rather than a file list.',
    runsVia: 'job',
    modes: [
      {
        id: 'run',
        label: 'Convert',
        flags: [],
        writes: true,
        description:
          'Batch mode: globs *.raw, converts each offline, passes through any .nc already there, and keeps going past a per-file failure.',
      },
    ],
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
  {
    id: 'publish',
    label: 'Publish',
    tool: 'aa-upload',
    description:
      'Copy the verified store to the derived-assets bucket, as-is under a prefix. Optional — the sequence is complete without it.',
    runsVia: 'job',
    optional: true,
    modes: [
      {
        id: 'dryRun',
        label: 'Dry run',
        flags: ['--as-is', '--dry-run'],
        writes: false,
        description: 'Show what would be uploaded and where, moving nothing.',
      },
      {
        id: 'run',
        label: 'Upload',
        flags: ['--as-is'],
        writes: true,
        description:
          'As-is mode, not echosounder mode: the canonical data/raw/<ship>/<survey>/<echosounder> tree is for raw files, and a combined store is a derived product that does not belong in it.',
      },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Live resolution                                                     */
/* ------------------------------------------------------------------ */

/**
 * How much this Workbench can honestly claim about a stage.
 *
 * This used to have an "installed but flags unconfirmed" value, and it was the
 * commonest one — because discovery only understood `--describe` and almost no
 * tool has it. It showed the user a badge whose only meaning was "go run
 * --help and correct a TypeScript file yourself", which is not a state a UI
 * should have.
 *
 * Discovery now reads every tool's flags out of its own source. So the only
 * question left is whether the tool is here at all.
 */
export type StageConfidence =
  /** Installed, and its flags were read from the tool itself. */
  | 'ready'
  /** Not present in this environment. */
  | 'missing'
  /** Present, but something about how it is invoked is undecided. */
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
  /** Which layer the flags came from: describe | source | help. */
  discovery: string;
  /** How many flags discovery found for this tool. */
  paramCount: number;
}

/**
 * Resolve one stage against what discovery found.
 *
 * `discovered` is keyed by tool name and comes from `/api/tools/describe`,
 * which reads each tool's flags out of its own source. A tool that is present
 * is therefore a tool whose command line is known — there is no longer a
 * middle state where it is installed but its flags are a guess.
 */
export function resolveStage(
  stage: SequenceStage,
  discovered: ReadonlyMap<string, DiscoveredTool>,
): ResolvedStage {
  const names = [stage.tool, ...(stage.aliases ?? [])];
  const found = names.map((name) => discovered.get(name)).find(Boolean);

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
      discovery: 'none',
      paramCount: 0,
    };
  }

  const base = {
    stage,
    resolvedTool: found.name,
    version: found.version,
    runnable: true,
    discovery: found.discovery,
    paramCount: found.paramCount,
  };

  // An open question is about how the *sequence* invokes the tool, not about
  // what flags the tool has — discovery answers the second, never the first.
  if (stage.unresolved) {
    return { ...base, confidence: 'unresolved', note: stage.unresolved };
  }

  return { ...base, confidence: 'ready', note: '' };
}

export function resolveSequence(
  discovered: ReadonlyMap<string, DiscoveredTool>,
  stages: readonly SequenceStage[] = FIRST_TIER,
): ResolvedStage[] {
  return stages.map((stage) => resolveStage(stage, discovered));
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
