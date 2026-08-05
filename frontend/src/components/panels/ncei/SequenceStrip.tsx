import { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  CheckCircleOutlineOutlined,
  ErrorOutlineOutlined,
  HelpOutlineOutlined,
  PlayArrowOutlined,
  ReportProblemOutlined,
  TerminalOutlined,
} from '@mui/icons-material';

import type { JobStatus } from '../../../services/jobsApi';
import type { ResolvedStage, StageConfidence, StageMode } from './sequence';
import { findMode } from './sequence';

/**
 * The first-tier sequence, as rows that can be run.
 *
 * This replaces `StageStrip`, which drew four numbered badges for a chain that
 * only ever executed its third element. The difference is not cosmetic: every
 * row here either runs something or says plainly why it cannot, and the badge
 * a row wears is derived from the installed environment rather than from a
 * boolean somebody typed.
 *
 * Layout is one row per stage rather than a horizontal strip, because a stage
 * now carries a mode picker, a progress bar and a verdict, and none of those
 * fit in a chip. The numbering stays — order is the one thing the old strip
 * got right, and it is the part users read.
 */

const CONFIDENCE: Record<
  StageConfidence,
  { label: string; tone: 'ok' | 'warn' | 'bad'; help: string }
> = {
  described: {
    label: 'self-described',
    tone: 'ok',
    help: 'Flags read off the tool’s own parser, so they cannot disagree with what it accepts.',
  },
  installed: {
    label: 'flags unconfirmed',
    tone: 'warn',
    help: 'The tool is installed, but its flags come from this repo rather than from the tool.',
  },
  unresolved: {
    label: 'open question',
    tone: 'warn',
    help: 'Something about how this stage is invoked is undecided.',
  },
  missing: {
    label: 'not installed',
    tone: 'bad',
    help: 'No such tool in this environment.',
  },
};

/** The single glyph that says how a finished stage went. */
function Outcome({ job }: { job: JobStatus | null }) {
  const theme = useTheme();
  if (!job) return null;

  if (job.state === 'running' || job.state === 'queued') {
    return <CircularProgress size={13} />;
  }
  if (job.state === 'succeeded') {
    return (
      <CheckCircleOutlineOutlined
        sx={{ fontSize: 15, color: theme.aa.color.status.success }}
      />
    );
  }
  // Exit 4 is a *finding*, not a crash — the QC pass did its job and the run
  // that follows would have been the mistake. Exit 3 is an interrupted write,
  // which the queue can resume. Neither deserves the same red as exit 1.
  if (job.state === 'qcFailed' || job.state === 'partial') {
    return (
      <ReportProblemOutlined
        sx={{ fontSize: 15, color: theme.aa.color.status.warning }}
      />
    );
  }
  return (
    <ErrorOutlineOutlined sx={{ fontSize: 15, color: theme.aa.color.status.error }} />
  );
}

function ConfidenceChip({ confidence, note }: { confidence: StageConfidence; note: string }) {
  const theme = useTheme();
  const meta = CONFIDENCE[confidence];
  if (confidence === 'described') return null; // The good case needs no badge.

  const colour =
    meta.tone === 'bad' ? theme.aa.color.status.error : theme.aa.color.status.warning;

  return (
    <Tooltip title={note || meta.help}>
      <Chip
        size="small"
        label={meta.label}
        icon={<HelpOutlineOutlined sx={{ fontSize: 12 }} />}
        sx={{
          height: 16,
          fontSize: 9.5,
          cursor: 'help',
          color: colour,
          borderColor: colour,
          backgroundColor: 'transparent',
          border: `1px solid ${colour}`,
          '& .MuiChip-icon': { color: colour, ml: '4px' },
        }}
      />
    </Tooltip>
  );
}

export interface SequenceStripProps {
  stages: readonly ResolvedStage[];
  /** stageId -> the mode currently chosen. */
  modes: Record<string, string>;
  onModeChange: (stageId: string, modeId: string) => void;
  /** stageId -> the job that stage last started, if any. */
  jobs: Record<string, JobStatus | null>;
  /** Fire one stage. The strip never decides *what* the argv is. */
  onRun: (stageId: string, mode: StageMode) => void;
  /** The command each stage would issue, for the preview line. */
  preview: (stageId: string, mode: StageMode) => string;
  /** Stages that cannot run yet because an earlier one has not succeeded. */
  blocked: ReadonlySet<string>;
}

export function SequenceStrip({
  stages,
  modes,
  onModeChange,
  jobs,
  onRun,
  preview,
  blocked,
}: SequenceStripProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
      {stages.map((resolved, index) => (
        <StageRow
          key={resolved.stage.id}
          index={index}
          resolved={resolved}
          mode={findMode(resolved.stage, modes[resolved.stage.id] ?? '')}
          job={jobs[resolved.stage.id] ?? null}
          blocked={blocked.has(resolved.stage.id)}
          open={expanded === resolved.stage.id}
          onToggle={() =>
            setExpanded((current) =>
              current === resolved.stage.id ? null : resolved.stage.id,
            )
          }
          onModeChange={(modeId) => onModeChange(resolved.stage.id, modeId)}
          onRun={(mode) => onRun(resolved.stage.id, mode)}
          preview={(mode) => preview(resolved.stage.id, mode)}
        />
      ))}
    </Box>
  );
}

function StageRow({
  index,
  resolved,
  mode,
  job,
  blocked,
  open,
  onToggle,
  onModeChange,
  onRun,
  preview,
}: {
  index: number;
  resolved: ResolvedStage;
  mode: StageMode;
  job: JobStatus | null;
  blocked: boolean;
  open: boolean;
  onToggle: () => void;
  onModeChange: (modeId: string) => void;
  onRun: (mode: StageMode) => void;
  preview: (mode: StageMode) => string;
}) {
  const theme = useTheme();
  const { stage, confidence, resolvedTool, version, note, runnable } = resolved;
  const busy = job?.state === 'running' || job?.state === 'queued';

  const disabledReason = !runnable
    ? note
    : blocked
      ? 'An earlier stage has not succeeded yet.'
      : busy
        ? 'Already running.'
        : '';

  const progress = job?.progress;
  const percent =
    progress && progress.total > 0
      ? Math.min(100, Math.round((progress.done / progress.total) * 100))
      : null;

  const commandLine = useMemo(() => preview(mode), [preview, mode]);

  return (
    <Box
      sx={{
        borderRadius: `${theme.aa.radius.sm}px`,
        border: `1px solid ${
          blocked || !runnable
            ? theme.aa.color.border.subtle
            : theme.aa.color.accent.main
        }`,
        opacity: runnable ? 1 : 0.6,
        px: 0.75,
        py: 0.5,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
        <Typography
          sx={{ fontSize: 10.5, color: theme.aa.color.text.muted, flexShrink: 0 }}
        >
          {index + 1}.
        </Typography>
        <Typography
          sx={{ fontSize: 11.5, color: theme.aa.color.text.primary, flexShrink: 0 }}
        >
          {stage.label}
        </Typography>
        <Tooltip title={version ? `${resolvedTool} ${version}` : resolvedTool}>
          <Typography
            sx={{
              fontSize: 10,
              fontFamily: theme.aa.font.mono,
              color: theme.aa.color.text.muted,
              cursor: 'help',
              flexShrink: 0,
            }}
          >
            {resolvedTool}
          </Typography>
        </Tooltip>

        <ConfidenceChip confidence={confidence} note={note} />

        {/* A terminal stage is not a lesser stage — it is one that holds a
            conversation, and saying so is more useful than hiding it. */}
        {stage.runsVia === 'terminal' && (
          <Tooltip title="Runs in the Terminal panel, because this tool prompts and a queued job would wait on a question nobody can answer.">
            <TerminalOutlined
              sx={{ fontSize: 13, color: theme.aa.color.text.muted, cursor: 'help' }}
            />
          </Tooltip>
        )}

        <Box sx={{ flex: 1, minWidth: 0 }} />
        <Outcome job={job} />

        <Tooltip title={disabledReason}>
          <span style={{ display: 'flex' }}>
            <Button
              size="small"
              variant={mode.writes ? 'contained' : 'outlined'}
              disabled={!runnable || blocked || busy}
              onClick={() => onRun(mode)}
              startIcon={<PlayArrowOutlined sx={{ fontSize: 14 }} />}
              sx={{ fontSize: 10.5, textTransform: 'none', py: 0, minWidth: 0 }}
            >
              {mode.label}
            </Button>
          </span>
        </Tooltip>
      </Box>

      {/* Modes, when there is a choice. Non-writing modes render as outlined
          buttons above, so "safe to press" is legible before it is clicked. */}
      {stage.modes.length > 1 && (
        <ToggleButtonGroup
          size="small"
          exclusive
          value={mode.id}
          onChange={(_, next: string | null) => next && onModeChange(next)}
          sx={{ mt: 0.5 }}
        >
          {stage.modes.map((option) => (
            <Tooltip key={option.id} title={option.description}>
              <ToggleButton
                value={option.id}
                sx={{ fontSize: 10, textTransform: 'none', py: 0.1, px: 0.75 }}
              >
                {option.label}
                {!option.writes && (
                  <Typography
                    component="span"
                    sx={{ fontSize: 9, color: theme.aa.color.text.muted, ml: 0.5 }}
                  >
                    no write
                  </Typography>
                )}
              </ToggleButton>
            </Tooltip>
          ))}
        </ToggleButtonGroup>
      )}

      {percent !== null && (
        <Box sx={{ mt: 0.5, display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <LinearProgress
            variant="determinate"
            value={percent}
            sx={{ flex: 1, height: 3, borderRadius: 2 }}
          />
          <Typography sx={{ fontSize: 9.5, color: theme.aa.color.text.muted }}>
            {progress?.done}/{progress?.total} {progress?.unit}
          </Typography>
        </Box>
      )}

      {/* The verdict, in the tool's own words. `verdict` is the plain-language
          reading of the exit code the runner attaches; showing it here means a
          QC finding is read at the stage that produced it rather than hunted
          for in a log. */}
      {job && job.verdict && (
        <Typography
          sx={{
            fontSize: 10,
            mt: 0.4,
            color:
              job.state === 'qcFailed' || job.state === 'partial'
                ? theme.aa.color.status.warning
                : theme.aa.color.status.error,
          }}
        >
          {job.verdict}
        </Typography>
      )}

      <Button
        size="small"
        onClick={onToggle}
        sx={{
          fontSize: 9.5,
          textTransform: 'none',
          py: 0,
          minWidth: 0,
          mt: 0.25,
          color: theme.aa.color.text.muted,
        }}
      >
        {open ? 'Hide command' : 'Command'}
      </Button>

      {open && (
        <Box
          sx={{
            mt: 0.4,
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
          {commandLine}
          <Typography sx={{ fontSize: 9.5, color: theme.aa.color.text.muted, mt: 0.4 }}>
            {stage.description}
          </Typography>
        </Box>
      )}
    </Box>
  );
}
