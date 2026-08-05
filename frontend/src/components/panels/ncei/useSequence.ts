/**
 * Runtime for the first-tier sequence.
 *
 * Holds four things the strip should not own: which stages are actually
 * available here, which mode each is set to, what argv each would issue, and
 * which job it last started.
 *
 * Two rules this enforces, both of which the old single-command path could not:
 *
 * **A stage runs only when the one before it has succeeded.** Combine against
 * a directory that Fetch never filled is the failure the old strip invited by
 * drawing four steps and running one, and it surfaces as an error from deep
 * inside echopype about a missing group — a long way from the cause. Blocking
 * is cheaper than explaining.
 *
 * **A non-zero exit stops the sequence.** Exit 4 from `--check` is the QC pass
 * working; proceeding into the combine it just refused is exactly the mistake
 * `--check` exists to prevent. Exit 3 stops too, but the Processing Queue
 * offers Resume on it, so it is a pause rather than a dead end.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';

import { startJob, useJobs } from '../../../state/jobs';
import { toolsApi } from '../../../services/toolsApi';
import type { JobStatus } from '../../../services/jobsApi';
import type { FlagValue, FlagValues } from './StageFlags';
import { sendToTerminal } from '../../../state/terminal';
import {
  FIRST_TIER,
  defaultMode,
  findMode,
  resolveSequence,
  type DiscoveredParam,
  type DiscoveredTool,
  type ResolvedStage,
  type StageMode,
} from './sequence';

/** Everything a stage needs to build its own argv. */
export interface SequenceContext {
  vesselId: string;
  surveyName: string;
  sonarName: string;
  /** File names currently in scope. */
  fileNames: readonly string[];
  dateFrom: string;
  dateTo: string;
  /**
   * aa-fetch's --output_root: the *parent* of the run directory.
   */
  downloadRoot: string;
  /**
   * aa-fetch's --download_dir_name. Always set explicitly, never left to
   * default: without it aa-fetch names the directory `aa_fetch_<timestamp>`
   * and the sequence has no way to tell the next stage where the files went
   * short of parsing them back off stdout. Naming it is one flag and makes the
   * whole chain addressable.
   */
  runName: string;
  /** `downloadRoot/runName` — what Convert and Assemble read. */
  workdir: string;
  /** The combine output, e.g. `combined_HB1603_EK60.zarr`. */
  output: string;
  /** Flags the options form contributed for `aa-combine`. */
  combineFlags: readonly string[];
  /** The request document path. */
  requestPath: string;
  /** Bucket-relative prefix for the optional publish stage. */
  destinationPrefix: string;
}

/**
 * argv for one stage, excluding the program name.
 *
 * Kept as a pure function of (stage, mode, context) so the preview line and the
 * thing that actually runs are built by the same code. There is no second,
 * hidden version of the command — the old panel's one real virtue, kept.
 */
export function buildArgs(
  stageId: string,
  mode: StageMode,
  ctx: SequenceContext,
): string[] {
  const flags = [...mode.flags];

  switch (stageId) {
    case 'request':
      return [
        ...flags,
        '--vessel',
        ctx.vesselId,
        '--survey',
        ctx.surveyName,
        '--instrument',
        ctx.sonarName,
        ...(ctx.dateFrom ? ['--from', ctx.dateFrom] : []),
        ...(ctx.dateTo ? ['--to', ctx.dateTo] : []),
        // Only when the mode writes. `aa-request --check` exits after
        // validating, before it reaches the write, so `-o` in check mode is
        // silently ignored — the tool reports "0 problems" and no document
        // appears. Chained with &&, the next stage is then handed a path to a
        // file that was never created.
        ...(mode.writes ? ['-o', ctx.requestPath] : []),
      ];

    case 'fetch':
      // Positional YAML, confirmed against the tool: `yaml_path` is nargs="?"
      // with a single-line stdin fallback. -n is mandatory here even though it
      // is optional to the tool — see runName.
      return [
        ...flags,
        ctx.requestPath,
        '-o',
        ctx.downloadRoot,
        '-n',
        ctx.runName,
      ];

    case 'convert':
      // A directory input puts aa-ed in batch mode, and batch mode prints the
      // directory back rather than a list of .nc paths — which is exactly what
      // Assemble wants, since aa-combine globs a workdir and its INPUT_SUFFIXES
      // are {.nc, .netcdf4, .zarr}. The .raw files aa-ed leaves beside the .nc
      // are ignored rather than mistaken for input.
      return [...flags, ctx.workdir];

    case 'assemble':
      return [
        ...flags,
        '--workdir',
        ctx.workdir,
        // --check and --plan write nothing, so naming an output would be a
        // claim the mode does not make.
        ...(mode.writes ? ['-o', ctx.output] : []),
        ...ctx.combineFlags,
      ];

    case 'verify':
      // `verify` / `info` are positional subcommands, already in mode.flags.
      return [...flags, ctx.output];

    case 'publish':
      return [...flags, '--destination_prefix', ctx.destinationPrefix, ctx.output];

    case 'fetchOnly':
      return flags;

    default:
      return flags;
  }
}

/**
 * The user's per-stage flags, as argv.
 *
 * Uses the *first* spelling discovery found, which is the tool's own primary
 * one — `-o` where a tool declares `-o, --output_path, --output`. A boolean is
 * the flag alone or nothing at all; there is no `--flag false`, because
 * `store_true` has no such spelling and sending one would be a parse error.
 */
export function flagArgs(
  values: FlagValues,
  params: readonly DiscoveredParam[],
  owns: ReadonlySet<string>,
  modeFlags: readonly string[] = [],
): string[] {
  const supplied = new Set(modeFlags);
  const out: string[] = [];
  for (const param of params) {
    if (owns.has(param.id) || param.positional) continue;
    // The mode already contributes this one. `--check` is both a mode and a
    // discoverable boolean, so without this it is emitted twice.
    if (param.flags.some((flag) => supplied.has(flag))) continue;
    const value = values[param.id];
    if (value === undefined || value === '') continue;
    const flag = param.flags[0];
    if (!flag) continue;
    if (param.type === 'boolean') {
      if (value === true) out.push(flag);
      continue;
    }
    out.push(flag, String(value));
  }
  return out;
}

/** Everything the sequence sets for a stage, for the locked rows in the form. */
export function ownedValues(stageId: string, ctx: SequenceContext): Record<string, string> {
  switch (stageId) {
    case 'request':
      return {
        vessel: ctx.vesselId,
        survey: ctx.surveyName,
        instrument: ctx.sonarName,
        start: ctx.dateFrom,
        end: ctx.dateTo,
        output_path: ctx.requestPath,
      };
    case 'fetch':
      return {
        yaml_path: ctx.requestPath,
        output_root: ctx.downloadRoot,
        download_dir_name: ctx.runName,
      };
    case 'convert':
      return { file_name: ctx.workdir };
    case 'assemble':
      return { workdir: ctx.workdir, output_path: ctx.output };
    case 'verify':
      return { args: ctx.output };
    case 'publish':
      return { path: ctx.output, destination_prefix: ctx.destinationPrefix };
    default:
      return {};
  }
}

export interface SequenceRuntime {
  stages: ResolvedStage[];
  modes: Record<string, string>;
  setMode: (stageId: string, modeId: string) => void;
  jobs: Record<string, JobStatus | null>;
  blocked: ReadonlySet<string>;
  run: (stageId: string, mode: StageMode) => void;
  preview: (stageId: string, mode: StageMode) => string;
  /** stageId -> paramId -> value the user set. */
  flags: Record<string, FlagValues>;
  setFlag: (stageId: string, paramId: string, next: FlagValue | undefined) => void;
  owned: (stageId: string) => Record<string, string>;
  /** Run every stage that is not already done, in order. */
  runAll: () => void;
  /** The whole sequence as one shell pipeline, for the preview. */
  fullCommand: string;
  /** True while the environment and describe probe are still loading. */
  loading: boolean;
  error: string;
}

export function useSequence(ctx: SequenceContext): SequenceRuntime {
  const jobsState = useJobs();

  const [discovered, setDiscovered] = useState<ReadonlyMap<string, DiscoveredTool>>(
    new Map(),
  );
  const [error, setError] = useState('');
  const [probing, setProbing] = useState(true);
  const [modes, setModes] = useState<Record<string, string>>(() =>
    Object.fromEntries(FIRST_TIER.map((stage) => [stage.id, defaultMode(stage).id])),
  );
  /** stageId -> job id started from this panel. */
  const [started, setStarted] = useState<Record<string, string>>({});
  /** stageId -> paramId -> the value the user typed or ticked. */
  const [flags, setFlags] = useState<Record<string, FlagValues>>({});

  useEffect(() => {
    let cancelled = false;
    toolsApi
      .describeAll()
      .then((catalog) => {
        if (cancelled) return;
        setDiscovered(
          new Map(
            catalog.tools.map((tool) => [
              tool.name,
              {
                name: tool.name,
                version: tool.version,
                discovery: tool.discovery,
                params: tool.params,
              },
            ]),
          ),
        );
      })
      .catch((e: Error) => {
        if (cancelled) return;
        // A failed scan is not a failed panel — every stage simply reads as
        // not installed, which is the honest answer when nothing could be
        // asked. The message says the scan failed, not that the tools are gone.
        setError(`Could not scan the environment for aa-* tools: ${e.message}`);
      })
      .finally(() => !cancelled && setProbing(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const stages = useMemo(() => resolveSequence(discovered), [discovered]);

  const jobs = useMemo(() => {
    const byStage: Record<string, JobStatus | null> = {};
    for (const stage of FIRST_TIER) {
      const id = started[stage.id];
      byStage[stage.id] = id
        ? (jobsState.jobs.find((job) => job.id === id) ?? null)
        : null;
    }
    return byStage;
  }, [started, jobsState.jobs]);

  /**
   * A stage is blocked until every stage before it has succeeded.
   *
   * Terminal stages are the exception worth naming: nothing reports back from
   * a command typed into a shell, so a terminal stage can never satisfy this
   * on its own. It is treated as satisfied once it has been dispatched, and
   * the strip says the sequence paused there — pretending otherwise would
   * either block the rest forever or claim a success nobody observed.
   */
  const blocked = useMemo(() => {
    const set = new Set<string>();
    let gate = false;
    for (const { stage } of stages) {
      if (gate) set.add(stage.id);
      const job = jobs[stage.id];
      const satisfied =
        stage.runsVia === 'terminal'
          ? Boolean(started[stage.id])
          : job?.state === 'succeeded';
      // An optional stage never closes the gate — Publish not having run is
      // not a reason for anything after it to be unavailable.
      if (!satisfied && !stage.optional) gate = true;
    }
    return set;
  }, [stages, jobs, started]);

  const setMode = useCallback((stageId: string, modeId: string) => {
    setModes((current) => ({ ...current, [stageId]: modeId }));
  }, []);

  const argvFor = useCallback(
    (stageId: string, mode: StageMode) => {
      const resolved = stages.find((item) => item.stage.id === stageId);
      const owns = new Set(resolved?.stage.owns ?? []);
      return [
        ...buildArgs(stageId, mode, ctx),
        ...flagArgs(flags[stageId] ?? {}, resolved?.params ?? [], owns, mode.flags),
      ];
    },
    [stages, ctx, flags],
  );

  const preview = useCallback(
    (stageId: string, mode: StageMode) => {
      const resolved = stages.find((item) => item.stage.id === stageId);
      const tool = resolved?.resolvedTool ?? stageId;
      return [tool, ...argvFor(stageId, mode)]
        .map((part) => (/[\s"']/.test(part) ? `"${part}"` : part))
        .join(' ');
    },
    [stages, argvFor],
  );

  const setFlag = useCallback(
    (stageId: string, paramId: string, next: FlagValue | undefined) => {
      setFlags((current) => {
        const stageFlags = { ...(current[stageId] ?? {}) };
        if (next === undefined) delete stageFlags[paramId];
        else stageFlags[paramId] = next;
        return { ...current, [stageId]: stageFlags };
      });
    },
    [],
  );

  const owned = useCallback((stageId: string) => ownedValues(stageId, ctx), [ctx]);

  /* Every stage on one line, in order.
     
     Not a pipeline: these compose by each printing a path the next one is
     given, and the sequence passes those paths explicitly rather than relying
     on stdin. `&&` is what it means — each step runs only if the one before
     succeeded.
     
     Each stage is rendered in its *writing* mode, not whichever mode the
     picker happens to be on. A chain is a request to produce the artifact, and
     Request and Assemble both default to Check — so taking the selected modes
     built `aa-request --check … && aa-fetch <file>`, where the check exits
     before writing and the fetch is handed a path to a file that does not
     exist. That is exactly the failure this produced in the terminal. A
     checking mode is a thing you run on its own, from its own row. */
  const fullCommand = useMemo(
    () =>
      stages
        .filter((item) => item.runnable && !item.stage.optional)
        .map((item) => {
          const writing = item.stage.modes.find((m) => m.writes);
          return preview(item.stage.id, writing ?? defaultMode(item.stage));
        })
        .join(' \\\n  && '),
    [stages, preview],
  );

  const run = useCallback(
    (stageId: string, mode: StageMode) => {
      const resolved = stages.find((item) => item.stage.id === stageId);
      if (!resolved || !resolved.runnable) return;
      const args = argvFor(stageId, mode);

      if (resolved.stage.runsVia === 'terminal') {
        sendToTerminal(preview(stageId, mode), { origin: 'NCEI', execute: true });
        // Recorded so the gate opens, not because success was observed.
        setStarted((current) => ({ ...current, [stageId]: `terminal:${Date.now()}` }));
        return;
      }

      void startJob({
        tool: resolved.resolvedTool,
        args,
        label: `${resolved.stage.label} — ${mode.label}`,
        cwd: ctx.downloadRoot,
      }).then((job) => {
        if (job) setStarted((current) => ({ ...current, [stageId]: job.id }));
      });
    },
    [stages, ctx, preview, argvFor],
  );

  /* Run the first stage that is neither done nor optional. The gate does the
     rest: as each job succeeds the next unblocks, so "Run all" is repeated
     presses of one button that the sequence itself sequences. Fired blind, it
     would queue six jobs whose inputs do not exist yet. */
  const runAll = useCallback(() => {
    for (const item of stages) {
      if (item.stage.optional || !item.runnable) continue;
      const job = jobs[item.stage.id];
      if (job?.state === 'succeeded') continue;
      if (job?.state === 'running' || job?.state === 'queued') return;
      run(item.stage.id, findMode(item.stage, modes[item.stage.id] ?? ''));
      return;
    }
  }, [stages, jobs, modes, run]);

  return {
    stages,
    flags,
    setFlag,
    owned,
    runAll,
    fullCommand,
    modes,
    setMode,
    jobs,
    blocked,
    run,
    preview,
    loading: probing,
    error: error || jobsState.error,
  };
}

export { findMode };
