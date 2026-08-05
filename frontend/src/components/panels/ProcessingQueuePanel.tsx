import { useEffect } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import PlaylistPlayOutlined from '@mui/icons-material/PlaylistPlayOutlined';
import ReplayOutlined from '@mui/icons-material/ReplayOutlined';
import StopOutlined from '@mui/icons-material/StopOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import CheckCircleOutlineOutlined from '@mui/icons-material/CheckCircleOutlineOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import PauseCircleOutlineOutlined from '@mui/icons-material/PauseCircleOutlineOutlined';
import RuleOutlined from '@mui/icons-material/RuleOutlined';
import BlockOutlined from '@mui/icons-material/BlockOutlined';

import { PanelPlaceholder } from './PanelPlaceholder';
import { CopyPathButton } from './CopyPathButton';
import { panelDensity } from './panelStyles';
import {
  cancelJob,
  refreshJobs,
  resumeJob,
  selectJob,
  startPolling,
  useJobs,
} from '../../state/jobs';
import type { JobState, JobStatus } from '../../services/jobsApi';

/**
 * Processing Queue — what the tools did.
 *
 * The panel that was a placeholder, because until now nothing in the
 * application could run anything: Run staged a command and toasted "backend not
 * connected". It reads `/api/jobs` now.
 *
 * ── Why there are six outcomes and not two ──────────────────────────────────
 *
 * The tools use five exit codes and three of them are not failures in the sense
 * a queue panel usually means. Collapsing them into one red row is the single
 * thing that would make this panel useless, because the only question asked
 * here is "what do I do about that", and the answer differs completely:
 *
 *   0 succeeded — nothing.
 *   3 partial   — the write was interrupted and the store says so. **Resume.**
 *                 The inputs and settings were fine; the same command is the
 *                 right command.
 *   4 qcFailed  — the data has a finding. Nothing to retry. Read the report.
 *                 A Resume button here would be a button for hiding it.
 *   2 usage     — the command line is wrong and will be wrong again. Back to
 *                 Configuration; re-running wastes exactly the same time.
 *   1 failed    — something broke. The log is the thing to read.
 *   cancelled   — deliberate.
 *
 * So Resume appears on exactly one state and the others each say what they
 * mean. That mapping is the panel's whole reason to exist.
 *
 * ── Progress ────────────────────────────────────────────────────────────────
 * The bar comes from `--progress` NDJSON parsed off stderr by the runner. A
 * tool run without that flag reports no numbers, and an indeterminate bar is
 * shown rather than a fabricated percentage — a running job with no progress is
 * a real state, and pretending otherwise is worse than admitting it.
 */

const STATE_META: Record<
  JobState,
  {
    label: string;
    icon: typeof CheckCircleOutlineOutlined;
    tone: 'success' | 'warning' | 'error' | 'muted' | 'accent';
  }
> = {
  queued: { label: 'Queued', icon: PauseCircleOutlineOutlined, tone: 'muted' },
  running: { label: 'Running', icon: PlaylistPlayOutlined, tone: 'accent' },
  succeeded: { label: 'Done', icon: CheckCircleOutlineOutlined, tone: 'success' },
  partial: { label: 'Interrupted', icon: WarningAmberOutlined, tone: 'warning' },
  qcFailed: { label: 'QC finding', icon: RuleOutlined, tone: 'warning' },
  usage: { label: 'Bad command', icon: BlockOutlined, tone: 'error' },
  failed: { label: 'Failed', icon: ErrorOutlineOutlined, tone: 'error' },
  cancelled: { label: 'Cancelled', icon: StopOutlined, tone: 'muted' },
};

/** What to do next, in one line. Absent when there is nothing to do. */
const NEXT_STEP: Partial<Record<JobState, string>> = {
  partial: 'The store is marked incomplete. Resume runs the same command again.',
  qcFailed: 'Open the QC report before re-running — a repeat run hides the finding.',
  usage: 'The command line was rejected before any work. Fix it in Configuration.',
  failed: 'Read the log below.',
};

function relative(iso: string): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  return `${Math.round(seconds / 3600)}h ago`;
}

/** The selected job's stderr, accumulated in the store from a cursor. */
function JobLog({ jobId }: { jobId: string }) {
  const { selectedId, lines } = useJobs();
  if (selectedId !== jobId) return null;
  if (lines.length === 0) return <>No output yet.</>;
  return <>{lines.join('\n')}</>;
}

function JobRow({ job, selected }: { job: JobStatus; selected: boolean }) {
  const theme = useTheme();
  const meta = STATE_META[job.state];
  const tone =
    meta.tone === 'success'
      ? theme.aa.color.status.success
      : meta.tone === 'warning'
        ? theme.aa.color.status.warning
        : meta.tone === 'error'
          ? theme.aa.color.status.error
          : meta.tone === 'accent'
            ? theme.aa.color.accent.main
            : theme.aa.color.text.muted;

  const live = job.state === 'running' || job.state === 'queued';
  const percent =
    job.progress && job.progress.total > 0
      ? Math.min(100, (job.progress.done / job.progress.total) * 100)
      : null;

  return (
    <Box
      sx={{
        borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
        backgroundColor: selected ? theme.aa.color.bg.chrome : 'transparent',
        '&:hover': { backgroundColor: theme.aa.color.bg.chrome },
      }}
    >
      <Box
        onClick={() => selectJob(job.id)}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          py: 0.6,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <meta.icon sx={{ fontSize: panelDensity.icon.row, color: tone, flexShrink: 0 }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography
            sx={{
              fontFamily: theme.aa.font.mono,
              fontSize: panelDensity.font.row,
              color: theme.aa.color.text.primary,
            }}
            noWrap
            title={job.command.join(' ')}
          >
            {job.label}
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'center' }}>
            <Typography sx={{ fontSize: panelDensity.font.meta, color: tone }}>
              {meta.label}
              {job.exitCode !== null && job.state !== 'cancelled'
                ? ` · exit ${job.exitCode}`
                : ''}
            </Typography>
            <Typography
              sx={{ fontSize: panelDensity.font.meta, color: theme.aa.color.text.muted }}
            >
              {relative(job.finishedAt || job.startedAt || job.queuedAt)}
            </Typography>
            {job.resumedFrom && (
              <Chip
                label="resumed"
                size="small"
                variant="outlined"
                sx={{ height: 14, fontSize: 9.5 }}
              />
            )}
          </Box>
        </Box>

        {/* Resume lives on exactly one state. */}
        {job.resumable && (
          <Tooltip title="Run the same command again — the settings were fine, the write was cut short">
            <span style={{ display: 'flex' }}>
              <Button
                size="small"
                variant="outlined"
                startIcon={<ReplayOutlined sx={{ fontSize: 13 }} />}
                onClick={(e) => {
                  e.stopPropagation();
                  void resumeJob(job.id);
                }}
                sx={{ fontSize: 10.5, py: 0, minWidth: 0 }}
              >
                Resume
              </Button>
            </span>
          </Tooltip>
        )}
        {live && (
          <Tooltip title="Send SIGTERM — the tool marks the store incomplete on its way out, so it stays resumable">
            <span style={{ display: 'flex' }}>
              <Button
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  void cancelJob(job.id);
                }}
                sx={{
                  fontSize: 10.5,
                  py: 0,
                  minWidth: 0,
                  color: theme.aa.color.text.muted,
                }}
              >
                <StopOutlined sx={{ fontSize: 14 }} />
              </Button>
            </span>
          </Tooltip>
        )}
      </Box>

      {/* Indeterminate when the tool was run without --progress. */}
      {job.state === 'running' && (
        <Box sx={{ px: 1, pb: 0.6 }}>
          <LinearProgress
            variant={percent === null ? 'indeterminate' : 'determinate'}
            value={percent ?? 0}
            sx={{
              height: 3,
              borderRadius: 2,
              backgroundColor: theme.aa.color.border.subtle,
              '& .MuiLinearProgress-bar': { backgroundColor: theme.aa.color.accent.main },
            }}
          />
          {job.progress && job.progress.total > 0 && (
            <Typography sx={{ fontSize: 9.5, color: theme.aa.color.text.muted, mt: 0.25 }}>
              {job.progress.stage} · {job.progress.done} of {job.progress.total}{' '}
              {job.progress.unit}
            </Typography>
          )}
        </Box>
      )}

      {selected && (
        <Box sx={{ px: 1, pb: 0.75 }}>
          {NEXT_STEP[job.state] && (
            <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.secondary, mb: 0.5 }}>
              {NEXT_STEP[job.state]}
            </Typography>
          )}
          {job.verdict && (
            <Typography sx={{ fontSize: 10, color: theme.aa.color.text.muted, mb: 0.5 }}>
              {job.verdict}
            </Typography>
          )}

          {/* stdout is the *result*, kept apart from the log all the way from
              the runner: a path, or an aa/1 handle. This is what the next stage
              consumes, so it gets its own box and a copy button rather than
              being buried in an hour of loguru output. */}
          {job.stdout.length > 0 && (
            <Box sx={{ mb: 0.5 }}>
              <Typography sx={{ fontSize: 9.5, color: theme.aa.color.text.muted }}>
                stdout — the handle, or the path
              </Typography>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                <Box
                  sx={{
                    flex: 1,
                    minWidth: 0,
                    fontFamily: theme.aa.font.mono,
                    fontSize: 10.5,
                    color: theme.aa.color.status.success,
                    wordBreak: 'break-all',
                  }}
                >
                  {job.stdout.join('\n')}
                </Box>
                <CopyPathButton
                  value={job.stdout.join('\n')}
                  label="Copy tool output"
                  alwaysVisible
                />
              </Box>
            </Box>
          )}

          <Box
            sx={{
              maxHeight: 160,
              overflowY: 'auto',
              p: 0.75,
              borderRadius: `${theme.aa.radius.sm}px`,
              backgroundColor: theme.aa.color.bg.base,
              border: `1px solid ${theme.aa.color.border.subtle}`,
              fontFamily: theme.aa.font.mono,
              fontSize: 10.5,
              color: theme.aa.color.text.secondary,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            <JobLog jobId={job.id} />
          </Box>
        </Box>
      )}
    </Box>
  );
}

export const ProcessingQueuePanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const state = useJobs();

  useEffect(() => {
    // Idempotent. Deliberately not stopped on unmount: Dockview unmounts a
    // hidden tab and a combine runs for an hour. The loop stops itself once
    // nothing is live, which is the condition that actually matters.
    startPolling();
  }, []);

  if (state.jobs.length === 0 && !state.error) {
    return (
      <PanelPlaceholder
        icon={PlaylistPlayOutlined}
        title="Processing Queue"
        description={
          state.loading
            ? 'Looking for running jobs…'
            : 'Nothing has been run yet. Start a pipeline, or plan a combine, and it appears here.'
        }
      />
    );
  }

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.aa.color.bg.panel,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          minHeight: 30,
          borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
          color: theme.aa.color.text.secondary,
        }}
      >
        <PlaylistPlayOutlined sx={{ fontSize: panelDensity.icon.header }} />
        <Typography sx={{ fontSize: panelDensity.font.header, fontWeight: 600, flex: 1 }}>
          {state.running} running
          {state.queued > 0 ? ` · ${state.queued} queued` : ''}
        </Typography>
        {state.polling && <CircularProgress size={10} />}
        <Tooltip title="Refresh now">
          <span style={{ display: 'flex' }}>
            <Button size="small" onClick={() => void refreshJobs()} sx={{ minWidth: 0, px: 0.5 }}>
              <RefreshOutlined sx={{ fontSize: panelDensity.icon.header }} />
            </Button>
          </span>
        </Tooltip>
      </Box>

      {state.error && (
        <Alert severity="error" sx={{ fontSize: 11.5, borderRadius: 0, py: 0.25 }}>
          {state.error}
        </Alert>
      )}

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
        {/* Newest first: the thing just started is the thing being watched. */}
        {[...state.jobs].reverse().map((job) => (
          <JobRow key={job.id} job={job} selected={state.selectedId === job.id} />
        ))}
      </Box>

      <Box
        sx={{
          borderTop: `1px solid ${theme.aa.color.border.subtle}`,
          backgroundColor: theme.aa.color.bg.chrome,
          px: 1,
          py: 0.5,
        }}
      >
        <Typography sx={{ fontSize: 10, color: theme.aa.color.text.muted }}>
          Up to {state.maxRunning} at once. Exit 3 is resumable; exit 4 is a finding to read.
        </Typography>
      </Box>
    </Box>
  );
};
