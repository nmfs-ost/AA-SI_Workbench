import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  BlockRounded,
  CheckCircleRounded,
  CloseRounded,
  DataObjectOutlined,
  ErrorRounded,
  ExpandMoreRounded,
  InputRounded,
  LayersOutlined,
  RadioButtonUncheckedRounded,
  RecyclingRounded,
  RemoveCircleOutlineRounded,
  StopRounded,
} from '@mui/icons-material';

import type { ProductInfo, RunStatus, StageRun } from '../../../services/pipelinesApi';
import { cancelRun, dismissRun, inputFromProduct, setActiveRun } from '../../../state/pipelines';
import { setActiveArtifact } from '../../../state/activeSubject';
import { revealInDerived } from '../../../state/derivedReveal';
import { useLayout } from '../../../context/LayoutContext';
import { formatBytes } from '../rowFormat';
import { Note } from '../prepare/ui';
import { HashTag, IntegrityMark, KindTag } from '../products/ProductBits';

/** "1 m 05 s", from two ISO times (the second may be now). */
export function elapsed(from: string, to?: string): string {
  if (!from) return '';
  const end = to ? Date.parse(to) : Date.now();
  const s = Math.max(0, Math.round((end - Date.parse(from)) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} m ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} m`;
}

/**
 * One run of a pipeline on one product: each stage's state as it goes, then
 * the products it made, each with its hashes and the three things to do next
 * (inspect it, find it in the bucket, run another pipeline on it).
 */
export function RunCard({ run, open }: { run: RunStatus; open: boolean }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const [, tick] = useState(0);
  useEffect(() => {
    if (run.state !== 'running') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [run.state]);

  const done = run.stages.filter((s) => s.state === 'succeeded').length;
  const ran = run.stages.filter((s) => s.state !== 'skipped').length;
  const tone =
    run.state === 'succeeded' ? c.status.success : run.state === 'failed' ? c.status.error : run.state === 'cancelled' ? c.text.muted : c.accent.main;

  return (
    <Box
      sx={{
        borderRadius: `${theme.aa.radius.md}px`,
        border: `1px solid ${open ? alpha(tone, 0.45) : c.border.subtle}`,
        backgroundColor: c.bg.panel,
        overflow: 'hidden',
      }}
    >
      <Box
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setActiveRun(open ? null : run.id)}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setActiveRun(open ? null : run.id);
          }
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.25,
          height: 38,
          cursor: 'pointer',
          boxShadow: `inset 3px 0 0 ${tone}`,
        }}
      >
        <StateIcon state={run.state} size={16} />
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: c.text.primary }} noWrap>
            {run.pipelineName}
            <Box component="span" sx={{ fontWeight: 400, color: c.text.muted }}>
              {' '}
              on {run.input.name}
            </Box>
          </Typography>
        </Box>
        <Typography sx={{ fontSize: 11, color: c.text.muted, flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {run.state === 'running'
            ? `${done} of ${ran} · ${elapsed(run.createdAt)}`
            : `${run.state === 'succeeded' ? 'Done' : run.state === 'failed' ? 'Failed' : 'Cancelled'} · ${elapsed(run.createdAt, run.finishedAt)}`}
        </Typography>
        {run.state === 'running' ? (
          <Tooltip title="Stop this run">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                void cancelRun(run.id);
              }}
            >
              <StopRounded sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        ) : (
          <Tooltip title="Remove from this list">
            <IconButton
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                dismissRun(run.id);
              }}
            >
              <CloseRounded sx={{ fontSize: 15 }} />
            </IconButton>
          </Tooltip>
        )}
        <ExpandMoreRounded
          sx={{ fontSize: 18, color: c.text.muted, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
        />
      </Box>

      {open && (
        <Box sx={{ px: 1.25, pb: 1.25, pt: 0.5, borderTop: `1px solid ${c.border.subtle}` }}>
          {run.stages.map((stage) => (
            <StageRow key={stage.index} stage={stage} />
          ))}
          {run.error && (
            <Box sx={{ mt: 1 }}>
              <Note tone="error" icon={<ErrorRounded className="note-icon" />}>
                <Box sx={{ whiteSpace: 'pre-wrap', fontFamily: theme.aa.font.mono, fontSize: 11 }}>{run.error}</Box>
              </Note>
            </Box>
          )}
          {run.outputs.length > 0 && (
            <Box sx={{ mt: 1.25 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5, minWidth: 0 }}>
                <Typography sx={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: c.text.muted, flexShrink: 0 }}>
                  Products
                </Typography>
                <Typography sx={{ fontSize: 10.5, color: c.text.muted, minWidth: 0 }} noWrap title={run.destination}>
                  {run.destination}
                </Typography>
              </Box>
              {run.outputs.map((p) => (
                <OutputRow key={p.uri} product={p} />
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

function StateIcon({ state, size = 15 }: { state: string; size?: number }) {
  const theme = useTheme();
  const c = theme.aa.color;
  switch (state) {
    case 'running':
      return <CircularProgress size={size - 2} thickness={5} sx={{ flexShrink: 0 }} />;
    case 'succeeded':
      return <CheckCircleRounded sx={{ fontSize: size, color: c.status.success, flexShrink: 0 }} />;
    case 'failed':
      return <ErrorRounded sx={{ fontSize: size, color: c.status.error, flexShrink: 0 }} />;
    case 'cancelled':
      return <BlockRounded sx={{ fontSize: size, color: c.text.muted, flexShrink: 0 }} />;
    case 'skipped':
      return <RemoveCircleOutlineRounded sx={{ fontSize: size, color: c.text.disabled, flexShrink: 0 }} />;
    default:
      return <RadioButtonUncheckedRounded sx={{ fontSize: size, color: c.text.disabled, flexShrink: 0 }} />;
  }
}

function StageRow({ stage }: { stage: StageRun }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const [open, setOpen] = useState(false);
  const output = stage.output.split('/').pop() ?? '';
  return (
    <Box sx={{ '& + &': { borderTop: `1px dashed ${c.border.subtle}` } }}>
      <Box
        role="button"
        tabIndex={0}
        aria-expanded={open}
        aria-label={`${stage.label}: ${stage.state}. Show its command and log.`}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            setOpen((v) => !v);
          }
        }}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.9,
          minHeight: 28,
          cursor: 'pointer',
          opacity: stage.state === 'skipped' ? 0.6 : 1,
          outline: 'none',
          '&:focus-visible': { boxShadow: `inset 0 0 0 1px ${c.accent.main}` },
        }}
      >
        <StateIcon state={stage.state} />
        <Typography sx={{ fontSize: 12, fontWeight: 600, color: c.text.primary, flexShrink: 0 }}>{stage.label}</Typography>
        <Typography sx={{ fontSize: 11, color: c.text.muted, flexShrink: 0 }}>{stage.tool}</Typography>
        <Typography sx={{ flex: 1, minWidth: 0, fontSize: 11, color: c.text.secondary }} noWrap title={stage.output || stage.detail}>
          {stage.state === 'succeeded' ? output : stage.detail}
        </Typography>
        {stage.reused && (
          <Tooltip title="Already in the bucket with the same inputs and settings: the tool reused it instead of recomputing.">
            <RecyclingRounded sx={{ fontSize: 14, color: c.syntax.reference }} />
          </Tooltip>
        )}
        {stage.product?.productHash && <HashTag hash={stage.product.productHash} />}
        <Typography sx={{ fontSize: 10.5, color: c.text.muted, width: 58, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' }}>
          {stage.startedAt ? elapsed(stage.startedAt, stage.finishedAt || undefined) : ''}
        </Typography>
      </Box>
      {open && (stage.command.length > 0 || stage.log.length > 0) && (
        <Box
          component="pre"
          sx={{
            m: 0,
            mb: 0.75,
            ml: 3,
            p: 0.9,
            borderRadius: `${theme.aa.radius.sm}px`,
            backgroundColor: c.bg.editor,
            border: `1px solid ${c.border.subtle}`,
            fontFamily: theme.aa.font.mono,
            fontSize: 10.5,
            lineHeight: 1.5,
            color: c.text.secondary,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            maxHeight: 220,
            overflow: 'auto',
          }}
        >
          {stage.command.length > 0 && `$ ${stage.command.join(' ')}\n`}
          {stage.log.join('\n')}
        </Box>
      )}
    </Box>
  );
}

function OutputRow({ product: p }: { product: ProductInfo }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const { openPanel } = useLayout();
  return (
    <Box
      title={p.uri}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.9,
        minHeight: 30,
        px: 0.75,
        borderRadius: `${theme.aa.radius.sm}px`,
        '&:hover': { backgroundColor: c.bg.hover },
        '&:hover .out-actions': { opacity: 1 },
      }}
    >
      <KindTag kind={p.kind} level={p.level} />
      <Typography sx={{ flex: 1, minWidth: 0, fontSize: 12, color: c.text.primary }} noWrap>
        {p.name}
      </Typography>
      <IntegrityMark intact={p.intact} />
      <HashTag hash={p.productHash} />
      <Typography sx={{ fontSize: 10.5, color: c.text.muted, width: 58, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {p.sizeBytes ? formatBytes(p.sizeBytes) : ''}
      </Typography>
      <Box className="out-actions" sx={{ display: 'flex', opacity: 0.55, transition: 'opacity .12s' }}>
        <Tooltip title="Inspect (Metadata)">
          <IconButton
            size="small"
            onClick={() => {
              setActiveArtifact({ uri: p.uri, label: p.name, origin: 'Pipelines' });
              openPanel('metadata');
            }}
          >
            <DataObjectOutlined sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Show in the Products panel">
          <IconButton
            size="small"
            onClick={() => {
              revealInDerived(p.uri);
              openPanel('derived');
            }}
          >
            <LayersOutlined sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        {p.kind !== 'echogram' && p.kind !== 'html' && (
          <Button
            size="small"
            startIcon={<InputRounded sx={{ fontSize: 14 }} />}
            onClick={() => inputFromProduct(p)}
            sx={{ fontSize: 11, textTransform: 'none', py: 0, minWidth: 0 }}
          >
            Use as input
          </Button>
        )}
      </Box>
    </Box>
  );
}
