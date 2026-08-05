import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import AssessmentOutlined from '@mui/icons-material/AssessmentOutlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import PlayArrowOutlined from '@mui/icons-material/PlayArrowOutlined';

import { formatBytes } from '../../../services/storeApi';
import { startJob, useJobs } from '../../../state/jobs';
import { buildArgv, type PipelineDefinition, type PipelineValues } from './pipelineTypes';

/**
 * Plan, Check and Run for the configured pipeline.
 *
 * ── Why Plan sits above Run ─────────────────────────────────────────────────
 *
 * `aa-combine --plan` emits `aa/plan/1`: file and ping counts, channels,
 * estimated bytes, the chunk count a given `--chunk-pings` would produce, and —
 * the part that matters — the QC warnings. Seams, overlaps and duplicate ping
 * times are all found by the same pass, and a seam is the case where the
 * *right* action is not to run at all: combining across a fifteen-hour transit
 * gap makes MVBS average over water the ship was not in.
 *
 * Discovering that after a two-hour combine, from a report beside a store that
 * should not exist, is the failure this button is for. Combine is a sector
 * terminus — whatever shape it emits is the shape everyone lives with, and
 * nothing downstream can correct it without re-running a sector nobody will
 * re-run. So the warning has to arrive before the write, and the only place it
 * can arrive is next to the settings that would cause it.
 *
 * ── Why these three are one control group ───────────────────────────────────
 *
 * They are the same command in three modes, and the difference between them is
 * exactly one thing: whether anything is written.
 *
 *   Plan  (`--plan`)  writes nothing. Estimates.
 *   Check (`--check`) writes nothing. Judges. Exit 4 on any finding.
 *   Run               writes the store.
 *
 * A mode that writes nothing is safe to fire without confirmation, which is why
 * Plan and Check are plain buttons and Run is the filled one. Splitting them
 * across two panels would hide that relationship and invite a user to reach for
 * Run because it was the one in front of them.
 */

/** `aa/plan/1`, as emitted by `aa-combine --plan`. */
interface Plan {
  schema: string;
  tool: string;
  inputs: number;
  output: string;
  pings: number;
  channels: number;
  chunks: { count: number; pings: number } | null;
  estimate: { readBytes: number; writeBytes: number };
  warnings: string[];
  problems: string[];
  report: string | null;
}

function isPlan(value: unknown): value is Plan {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { schema?: unknown }).schema === 'aa/plan/1'
  );
}

/** The stage a plan applies to: the first that supports the mode. */
const PLANNABLE = new Set(['aa-combine']);

function Stat({ label, value }: { label: string; value: string }) {
  const theme = useTheme();
  return (
    <Box sx={{ minWidth: 66 }}>
      <Typography sx={{ fontSize: 9.5, color: theme.aa.color.text.muted }}>{label}</Typography>
      <Typography
        sx={{
          fontSize: 12,
          fontFamily: theme.aa.font.mono,
          color: theme.aa.color.text.primary,
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

export function PlanControls({
  pipeline,
  values,
  injectedInput,
}: {
  pipeline: PipelineDefinition;
  values: PipelineValues;
  injectedInput: string | null;
}) {
  const theme = useTheme();
  const jobs = useJobs();
  const [planJobId, setPlanJobId] = useState('');
  const [error, setError] = useState('');

  const stage = pipeline.stages.find((item) => PLANNABLE.has(item.tool));
  const planJob = jobs.jobs.find((job) => job.id === planJobId) ?? null;

  /* A hand-written command is a shell string and cannot be turned into argv;
     buildArgv returns null and the mode buttons are disabled rather than
     silently running something else. */
  const runnable = pipeline.stages
    .map((item) => buildArgv(item, values, injectedInput))
    .filter((item): item is { tool: string; args: string[] } => item !== null);
  const handWritten = runnable.length !== pipeline.stages.length;

  const plan = isPlan(planJob?.handle) ? (planJob.handle as unknown as Plan) : null;
  const planning = planJob !== null && (planJob.state === 'running' || planJob.state === 'queued');

  // A plan describes one set of values. Editing any of them invalidates it, so
  // the stale result is dropped rather than left on screen looking current.
  useEffect(() => {
    setPlanJobId('');
    setError('');
  }, [values, injectedInput, pipeline.id]);

  async function fire(extra: string[], label: string, keep: boolean): Promise<void> {
    if (!stage) return;
    const argv = buildArgv(stage, values, injectedInput);
    if (!argv) {
      setError('This stage has a hand-written command. Run it from the Terminal panel.');
      return;
    }
    const job = await startJob({
      tool: argv.tool,
      args: [...argv.args, ...extra],
      label: `${label} · ${pipeline.name}`,
    });
    if (job && keep) setPlanJobId(job.id);
    if (!job) setError('Could not start the job — see the Processing Queue.');
  }

  async function run(): Promise<void> {
    setError('');
    for (const argv of runnable) {
      // --progress so the queue gets a determinate bar rather than a spinner.
      await startJob({
        tool: argv.tool,
        args: [...argv.args, '--progress'],
        label: `${argv.tool} · ${pipeline.name}`,
      });
    }
  }

  if (!stage) return null;

  const blocking = plan !== null && plan.problems.length > 0;

  return (
    <Box sx={{ mb: 1.5 }}>
      <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center', mb: 0.75 }}>
        <Tooltip title="Estimate the combine — files, pings, bytes, chunk count — and stop. Writes nothing.">
          <span style={{ display: 'flex' }}>
            <Button
              size="small"
              variant="outlined"
              disabled={planning || handWritten}
              startIcon={
                planning ? (
                  <CircularProgress size={12} />
                ) : (
                  <AssessmentOutlined sx={{ fontSize: 14 }} />
                )
              }
              onClick={() => void fire(['--plan'], 'plan', true)}
              sx={{ fontSize: 11.5 }}
            >
              Plan
            </Button>
          </span>
        </Tooltip>
        <Tooltip title="Run the QC pass and stop. Names which file breaks which precondition. Writes nothing.">
          <span style={{ display: 'flex' }}>
            <Button
              size="small"
              disabled={handWritten}
              startIcon={<FactCheckOutlined sx={{ fontSize: 14 }} />}
              onClick={() => void fire(['--check'], 'check', false)}
              sx={{ fontSize: 11.5 }}
            >
              Check
            </Button>
          </span>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        <Tooltip
          title={
            handWritten
              ? 'A hand-written command belongs in the Terminal panel'
              : blocking
                ? 'The plan found blocking problems — read them first'
                : 'Write the store'
          }
        >
          <span style={{ display: 'flex' }}>
            <Button
              size="small"
              variant="contained"
              disabled={handWritten}
              startIcon={<PlayArrowOutlined sx={{ fontSize: 15 }} />}
              onClick={() => void run()}
              sx={{ fontSize: 11.5 }}
            >
              Run
            </Button>
          </span>
        </Tooltip>
      </Box>

      {handWritten && (
        <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted, mb: 0.5 }}>
          One or more stages have a hand-written command. Those can contain pipes, so they run
          from the Terminal rather than the job runner.
        </Typography>
      )}
      {error && (
        <Alert severity="error" sx={{ fontSize: 11, py: 0, mb: 0.5 }}>
          {error}
        </Alert>
      )}

      {plan && (
        <Box
          sx={{
            p: 1,
            borderRadius: `${theme.aa.radius.sm}px`,
            backgroundColor: theme.aa.color.bg.base,
            border: `1px solid ${
              blocking ? theme.aa.color.status.error : theme.aa.color.border.subtle
            }`,
          }}
        >
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mb: 0.75 }}>
            <Stat label="Files" value={plan.inputs.toLocaleString()} />
            <Stat label="Pings" value={plan.pings.toLocaleString()} />
            <Stat label="Channels" value={String(plan.channels)} />
            <Stat label="Reads" value={formatBytes(plan.estimate.readBytes)} />
            {plan.chunks && (
              <Stat
                label="Chunks"
                value={`${plan.chunks.count.toLocaleString()} @ ${plan.chunks.pings}`}
              />
            )}
          </Box>

          {/* The reason this control exists. Rendered before Run, not after. */}
          {plan.problems.map((problem) => (
            <Typography
              key={problem}
              sx={{ fontSize: 10.5, color: theme.aa.color.status.error, mb: 0.35 }}
            >
              ▲ {problem}
            </Typography>
          ))}
          {plan.warnings.map((warning) => (
            <Typography
              key={warning}
              sx={{ fontSize: 10.5, color: theme.aa.color.status.warning, mb: 0.35 }}
            >
              • {warning}
            </Typography>
          ))}
          {plan.problems.length === 0 && plan.warnings.length === 0 && (
            <Typography sx={{ fontSize: 10.5, color: theme.aa.color.status.success }}>
              No seams, overlaps or duplicate ping times found.
            </Typography>
          )}
        </Box>
      )}

      {planJob && !plan && planJob.state !== 'running' && planJob.state !== 'queued' && (
        <Alert severity="warning" sx={{ fontSize: 11, py: 0 }}>
          {planJob.state === 'qcFailed'
            ? 'The plan found blocking problems — open the job in the Processing Queue.'
            : `The plan did not complete (${planJob.state}). See the Processing Queue.`}
        </Alert>
      )}
    </Box>
  );
}
