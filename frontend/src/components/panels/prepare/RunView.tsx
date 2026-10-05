import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  Collapse,
  IconButton,
  LinearProgress,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  CheckCircleRounded,
  CloudDoneOutlined,
  DoNotDisturbOnOutlined,
  ErrorRounded,
  FindInPageOutlined,
  FolderOpenOutlined,
  RadioButtonUncheckedRounded,
  RemoveCircleOutlineRounded,
  SaveOutlined,
} from '@mui/icons-material';

import { CopyPathButton } from '../CopyPathButton';
import { quote } from '../shellQuote';
import type { Asset, RunStatus, StageStatus } from '../../../services/baselineApi';
import { BASELINE_SIMULATED, imageUrl } from '../../../services/baselineApi';
import { cancelRun } from '../../../state/prepare';
import { formatDuration, formatUtc, parseUtc } from './plan';
import { KIND_ICON } from './DestinationStep';
import { formatSize } from './WorkspaceStep';
import { FileName, LevelChip, Note, PathText } from './ui';

interface Props {
  run: RunStatus;
  runError: string;
  onInspect: (asset: Asset) => void;
  onReveal: (asset: Asset) => void;
  onQueue: () => void;
  onDone: () => void;
  onAgain: () => void;
}

function seconds(from: string, to: string): number {
  const a = Date.parse(from);
  const b = to ? Date.parse(to) : Date.now();
  return Number.isFinite(a) && Number.isFinite(b) ? Math.max(0, (b - a) / 1000) : 0;
}

/** Re-render once a second while something is running, for the clocks. */
function useTick(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [active]);
}

/**
 * A run, as it happens and once it is done.
 *
 * Each stage is one console tool, shown with its level, what it is doing in
 * words ("12 of 24 files"), and — on request — the exact command, so the card
 * never hides the auditable operation underneath it. When the run succeeds
 * the products take over the top of the view: the asset first, with the three
 * things to do next (copy its address, look inside it, find it in the bucket).
 */
export function RunView({ run, runError, onInspect, onReveal, onQueue, onDone, onAgain }: Props) {
  const theme = useTheme();
  const c = theme.aa.color;
  const running = run.state === 'running';
  useTick(running);
  const [open, setOpen] = useState<string | null>(null);
  const [showStages, setShowStages] = useState(false);

  const total = seconds(run.createdAt, run.finishedAt);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      {/* The asset being made */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <StateBadge state={run.state} />
          <Typography sx={{ fontSize: 10.5, color: c.text.muted, ml: 'auto', fontVariantNumeric: 'tabular-nums' }}>
            {formatDuration(total)}
          </Typography>
        </Box>
        <Typography
          sx={{
            mt: 0.75,
            fontFamily: theme.aa.font.mono,
            fontSize: 12,
            fontWeight: 600,
            color: c.text.primary,
            wordBreak: 'break-all',
          }}
        >
          {run.base}
        </Typography>
        <Typography sx={{ fontSize: 11, color: c.text.secondary, mt: 0.4 }}>
          {rangeText(run)}
        </Typography>
        <Typography
          sx={{ fontFamily: theme.aa.font.mono, fontSize: 10.5, color: c.text.muted, overflowWrap: 'anywhere', mt: 0.4 }}
        >
          <PathText path={run.destination} />
        </Typography>
      </Box>

      {run.state === 'succeeded' && (
        <Results assets={run.assets} base={run.base} onInspect={onInspect} onReveal={onReveal} />
      )}

      {run.state === 'failed' && run.error && (
        <Note tone="error" icon={<ErrorRounded className="note-icon" />}>
          <Box
            component="pre"
            sx={{ m: 0, whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontFamily: theme.aa.font.ui, fontSize: 11.5 }}
          >
            {run.error}
          </Box>
          <Typography sx={{ fontSize: 10.5, color: c.text.muted, mt: 0.5, wordBreak: 'break-all' }}>
            Working files kept for inspection in {run.scratch}
          </Typography>
        </Note>
      )}
      {runError && <Note tone="warning">{runError}</Note>}

      {/* The stages. Once the products are in, how they were made steps back:
          still one click away, no longer the first thing on the card. */}
      {run.state === 'succeeded' && (
        <Box
          component="button"
          type="button"
          onClick={() => setShowStages((v) => !v)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            border: 'none',
            background: 'none',
            p: 0,
            cursor: 'pointer',
            color: c.text.secondary,
            fontFamily: theme.aa.font.ui,
            fontSize: 11.5,
            '&:hover': { color: c.text.primary },
          }}
        >
          <CheckCircleRounded sx={{ fontSize: 14, color: c.status.success }} />
          Made by {run.stages.filter((st) => st.state === 'done').length} console tools in{' '}
          {formatDuration(total)}
          <Box component="span" sx={{ color: c.accent.main, ml: 0.5 }}>
            {showStages ? 'Hide' : 'Show'}
          </Box>
        </Box>
      )}
      <Collapse in={run.state !== 'succeeded' || showStages} unmountOnExit>
        <Box
          sx={{
            borderRadius: `${theme.aa.radius.md}px`,
            border: `1px solid ${c.border.subtle}`,
            overflow: 'hidden',
          }}
        >
          {run.stages.map((stage) => (
            <StageRow
              key={stage.id}
              stage={stage}
              open={open === stage.id}
              onToggle={() => setOpen(open === stage.id ? null : stage.id)}
            />
          ))}
        </Box>
      </Collapse>

      {running && run.work && run.work.root && <WorkLine run={run} />}

      {run.notes.length > 0 && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
          {run.notes.map((note) => (
            <Typography key={note} sx={{ fontSize: 10.5, color: c.text.muted, lineHeight: 1.45 }}>
              {note}
            </Typography>
          ))}
        </Box>
      )}

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        {running ? (
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            onClick={() => void cancelRun()}
            sx={{ textTransform: 'none', fontSize: 12, borderColor: c.border.strong }}
          >
            Cancel the run
          </Button>
        ) : run.state === 'succeeded' ? (
          <Button size="small" variant="contained" disableElevation onClick={onDone}
            sx={{ textTransform: 'none', fontSize: 12 }}>
            Prepare another range
          </Button>
        ) : (
          <>
            <Button size="small" variant="contained" disableElevation onClick={onAgain}
              sx={{ textTransform: 'none', fontSize: 12 }}>
              Try again
            </Button>
            <Button size="small" onClick={onDone} sx={{ textTransform: 'none', fontSize: 12 }}>
              Back to the card
            </Button>
          </>
        )}
        <Button size="small" onClick={onQueue} sx={{ textTransform: 'none', fontSize: 12, ml: 'auto' }}>
          Jobs and logs
        </Button>
      </Box>
    </Box>
  );
}

function StateBadge({ state }: { state: RunStatus['state'] }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const look = {
    running: { text: 'Preparing', color: c.accent.main },
    succeeded: { text: 'In the bucket', color: c.status.success },
    failed: { text: 'Stopped', color: c.status.error },
    cancelled: { text: 'Cancelled', color: c.text.muted },
  }[state];
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.6,
        px: 0.9,
        height: 20,
        borderRadius: 10,
        fontSize: 11,
        fontWeight: 600,
        color: look.color,
        backgroundColor: alpha(look.color, 0.12),
      }}
    >
      {state === 'running' ? (
        <CircularProgress size={10} thickness={6} sx={{ color: look.color }} />
      ) : state === 'succeeded' ? (
        <CloudDoneOutlined sx={{ fontSize: 13 }} />
      ) : null}
      {look.text}
    </Box>
  );
}

function StageIcon({ state }: { state: StageStatus['state'] }) {
  const theme = useTheme();
  const c = theme.aa.color;
  switch (state) {
    case 'running':
      return <CircularProgress size={13} thickness={5} />;
    case 'done':
      return <CheckCircleRounded sx={{ fontSize: 15, color: c.status.success }} />;
    case 'failed':
      return <ErrorRounded sx={{ fontSize: 15, color: c.status.error }} />;
    case 'skipped':
      return <RemoveCircleOutlineRounded sx={{ fontSize: 15, color: c.text.disabled }} />;
    case 'cancelled':
      return <DoNotDisturbOnOutlined sx={{ fontSize: 15, color: c.text.muted }} />;
    default:
      return <RadioButtonUncheckedRounded sx={{ fontSize: 15, color: c.text.disabled }} />;
  }
}

function StageRow({ stage, open, onToggle }: { stage: StageStatus; open: boolean; onToggle: () => void }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const running = stage.state === 'running';
  const muted = stage.state === 'pending' || stage.state === 'skipped' || stage.state === 'cancelled';
  const took = stage.startedAt ? seconds(stage.startedAt, stage.finishedAt) : 0;
  const hasCommand = stage.command.length > 0;

  return (
    <Box
      sx={{
        '& + &': { borderTop: `1px solid ${c.border.subtle}` },
        backgroundColor: running ? alpha(c.accent.main, 0.06) : 'transparent',
        transition: 'background-color .3s',
      }}
    >
      <Box
        onClick={hasCommand ? onToggle : undefined}
        sx={{
          display: 'grid',
          gridTemplateColumns: '18px 1fr auto',
          columnGap: 0.9,
          alignItems: 'center',
          px: 1,
          py: 0.7,
          cursor: hasCommand ? 'pointer' : 'default',
          '&:hover': hasCommand ? { backgroundColor: c.bg.hover } : undefined,
        }}
        title={stage.description}
      >
        <Box sx={{ display: 'flex', justifyContent: 'center' }}>
          <StageIcon state={stage.state} />
        </Box>
        <Box sx={{ minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography
              sx={{ fontSize: 12, fontWeight: 600, color: muted ? c.text.muted : c.text.primary }}
            >
              {stage.label}
            </Typography>
            <Typography sx={{ fontSize: 10, fontFamily: theme.aa.font.mono, color: c.text.muted }}>
              {stage.tool}
            </Typography>
            <LevelChip level={stage.level} />
          </Box>
          {(stage.detail || running) && (
            <Typography
              sx={{
                fontSize: 10.5,
                color: stage.state === 'failed' ? c.status.error : c.text.secondary,
                lineHeight: 1.45,
                mt: 0.15,
              }}
            >
              {stage.detail || stage.description}
            </Typography>
          )}
        </Box>
        <Typography sx={{ fontSize: 10, color: c.text.muted, fontVariantNumeric: 'tabular-nums' }}>
          {took ? formatDuration(took) : ''}
        </Typography>
      </Box>
      {running && (
        <LinearProgress
          variant={stage.total > 0 ? 'determinate' : 'indeterminate'}
          value={stage.total > 0 ? (100 * stage.done) / stage.total : undefined}
          sx={{ height: 2, backgroundColor: 'transparent' }}
        />
      )}
      <Collapse in={open && hasCommand} unmountOnExit>
        <Box
          component="pre"
          sx={{
            m: 0,
            mx: 1,
            mb: 0.9,
            px: 1,
            py: 0.6,
            borderRadius: `${theme.aa.radius.sm}px`,
            backgroundColor: c.bg.editor,
            fontFamily: theme.aa.font.mono,
            fontSize: 10.5,
            lineHeight: 1.5,
            color: c.text.secondary,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {stage.command.map(quote).join(' ')}
          {stage.output && (
            <Box component="span" sx={{ display: 'block', color: c.syntax.string, mt: 0.5 }}>
              → {stage.output}
            </Box>
          )}
        </Box>
      </Collapse>
    </Box>
  );
}

const ORDER: Asset['kind'][] = ['echodata', 'sv', 'echogram', 'report', 'request'];

function Results({
  assets,
  base,
  onInspect,
  onReveal,
}: {
  assets: Asset[];
  base: string;
  onInspect: (asset: Asset) => void;
  onReveal: (asset: Asset) => void;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const sorted = [...assets].sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
  const [main, ...rest] = sorted;
  if (!main) return null;

  const name = (uri: string) => uri.replace(/\/$/, '').split('/').pop() ?? uri;
  const actions = (asset: Asset, visible: boolean) => (
    <Box sx={{ display: 'flex', alignItems: 'center', flexShrink: 0 }}>
      <CopyPathButton value={asset.uri} label="Copy gs:// URI" alwaysVisible={visible} />
      {(asset.kind === 'echodata' || asset.kind === 'sv') && (
        <Tooltip title="Select it: Metadata shows its provenance, and it becomes the Pipelines input">
          <IconButton size="small" onClick={() => onInspect(asset)} sx={{ p: 0.4 }}>
            <FindInPageOutlined sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      )}
      <Tooltip title="Show in the Products panel">
        <IconButton size="small" onClick={() => onReveal(asset)} sx={{ p: 0.4 }}>
          <FolderOpenOutlined sx={{ fontSize: 14 }} />
        </IconButton>
      </Tooltip>
    </Box>
  );

  const MainIcon = KIND_ICON[main.kind];
  const echogram = assets.find((a) => a.kind === 'echogram');
  return (
    <Box
      sx={{
        borderRadius: `${theme.aa.radius.md}px`,
        border: `1px solid ${alpha(c.status.success, 0.35)}`,
        backgroundColor: alpha(c.status.success, 0.05),
        overflow: 'hidden',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.1, py: 1 }}>
        <Box
          sx={{
            width: 30,
            height: 30,
            borderRadius: `${theme.aa.radius.md}px`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: alpha(c.accent.main, 0.14),
            flexShrink: 0,
          }}
        >
          <MainIcon sx={{ fontSize: 17, color: c.accent.main }} />
        </Box>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Typography sx={{ fontSize: 12, fontWeight: 600, color: c.text.primary }}>
              {main.label}
            </Typography>
            <LevelChip level={main.level} />
          </Box>
          <FileName name={name(main.uri)} base={base} strong />
        </Box>
        {actions(main, true)}
      </Box>
      {echogram && !BASELINE_SIMULATED && <Thumbnail asset={echogram} />}
      <Box sx={{ borderTop: `1px solid ${alpha(c.status.success, 0.2)}`, py: 0.4 }}>
        {rest.map((asset) => {
          const Icon = KIND_ICON[asset.kind];
          return (
            <Box
              key={asset.uri}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                pl: 1.4,
                pr: 1.1,
                height: 26,
                '&:hover .aa-copy': { opacity: 1 },
              }}
              title={asset.uri}
            >
              <Icon sx={{ fontSize: 13, color: c.text.muted }} />
              <Typography sx={{ fontSize: 11, color: c.text.primary, flexShrink: 0 }}>{asset.label}</Typography>
              <LevelChip level={asset.level} />
              <Box sx={{ flex: 1, minWidth: 0, display: 'flex', justifyContent: 'flex-end' }}>
                <FileName name={name(asset.uri)} base={base} size={10} />
              </Box>
              {actions(asset, false)}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

/** "2016-07-03 06:00 → 12:00 UTC · 18 raw files" */
function rangeText(run: RunStatus): string {
  const a = parseUtc(run.request.start);
  const b = parseUtc(run.request.end);
  if (a === null || b === null) return '';
  const from = formatUtc(a, false);
  const to = formatUtc(b, false);
  const same = from.slice(0, 10) === to.slice(0, 10);
  const n = run.request.expectedFiles.length;
  return `${from} → ${same ? to.slice(11) : to} UTC${n ? ` · ${n} raw ${n === 1 ? 'file' : 'files'}` : ''}`;
}

/**
 * The echogram the run drew, as the first look at the data. Its top edge is
 * the first channel's echogram, so the crop shows that; a click opens the
 * whole picture. Absent (not an error) when it cannot be read.
 */
function Thumbnail({ asset }: { asset: Asset }) {
  const theme = useTheme();
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const src = imageUrl(asset.uri);
  return (
    <Box
      component="a"
      href={src}
      target="_blank"
      rel="noopener noreferrer"
      title="Open the echogram"
      sx={{
        display: 'block',
        mx: 1.1,
        mb: 1,
        borderRadius: `${theme.aa.radius.sm}px`,
        overflow: 'hidden',
        border: `1px solid ${theme.aa.color.border.subtle}`,
        backgroundColor: '#fff',
        height: 118,
      }}
    >
      <Box
        component="img"
        src={src}
        alt="Echogram of the Sv"
        onError={() => setFailed(true)}
        sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'top' }}
      />
    </Box>
  );
}

/**
 * The working space a running run holds, measured every few seconds: what it
 * holds now, the most so far, and the estimate the card started it on.
 */
function WorkLine({ run }: { run: RunStatus }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const work = run.work!;
  const share = work.needBytes ? Math.min(1, work.usedBytes / work.needBytes) : 0;
  return (
    <Box title={`Working folder: ${run.scratch}`}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <SaveOutlined sx={{ fontSize: 13, color: c.syntax.entity }} />
        <Typography sx={{ fontSize: 11, color: c.text.secondary, fontVariantNumeric: 'tabular-nums' }}>
          Working space {formatSize(work.usedBytes)}
          <Box component="span" sx={{ color: c.text.muted }}>
            {' '}· at most {formatSize(work.peakBytes)}
            {work.needBytes ? ` of about ${formatSize(work.needBytes)}` : ''}
            {work.freedBytes ? ` · ${formatSize(work.freedBytes)} freed` : ''}
          </Box>
        </Typography>
      </Box>
      {work.needBytes > 0 && (
        <LinearProgress
          variant="determinate"
          value={share * 100}
          aria-label="Working space in use, against the estimate"
          sx={{ mt: 0.5, height: 3, borderRadius: 2, backgroundColor: alpha(c.text.muted, 0.18) }}
        />
      )}
    </Box>
  );
}
