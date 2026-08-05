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
import { sendToTerminal } from '../../../state/terminal';
import {
  FIRST_TIER,
  defaultMode,
  findMode,
  resolveSequence,
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
        '-o',
        ctx.requestPath,
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

    default:
      return flags;
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
                paramCount: tool.params.length,
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

  const preview = useCallback(
    (stageId: string, mode: StageMode) => {
      const resolved = stages.find((item) => item.stage.id === stageId);
      const tool = resolved?.resolvedTool ?? stageId;
      return [tool, ...buildArgs(stageId, mode, ctx)]
        .map((part) => (/[\s"']/.test(part) ? `"${part}"` : part))
        .join(' ');
    },
    [stages, ctx],
  );

  const run = useCallback(
    (stageId: string, mode: StageMode) => {
      const resolved = stages.find((item) => item.stage.id === stageId);
      if (!resolved || !resolved.runnable) return;
      const args = buildArgs(stageId, mode, ctx);

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
        cwd: ctx.workdir,
      }).then((job) => {
        if (job) setStarted((current) => ({ ...current, [stageId]: job.id }));
      });
    },
    [stages, ctx, preview],
  );

  return {
    stages,
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
