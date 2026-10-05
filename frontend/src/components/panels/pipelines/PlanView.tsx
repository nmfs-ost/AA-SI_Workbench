import { useEffect, useState } from 'react';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  FormControlLabel,
  IconButton,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  CloudUploadOutlined,
  ContentCopyOutlined,
  ErrorOutlineRounded,
  ExpandMoreRounded,
  PlayArrowRounded,
  TuneRounded,
  WarningAmberRounded,
} from '@mui/icons-material';

import type { Catalogue, PipelineSpec, Plan, ProductRef } from '../../../services/pipelinesApi';
import { setDest, setForce, startRuns } from '../../../state/pipelines';
import { useLayout } from '../../../context/LayoutContext';
import { Caption, LevelChip, Note, PathText } from '../prepare/ui';
import { compactFieldSx } from '../panelStyles';
import { describeValues, kindLabel, toolOf } from './chain';

/**
 * The open pipeline's plan, as the server made it for the selected input:
 * which stages run (and which the input is already past), with what settings,
 * where the products go, what is wrong, and the exact commands. Run is here,
 * and says why when it cannot.
 */
export function PlanView({
  pipeline,
  catalogue,
  inputs,
  plan,
  planning,
  planError,
  dest,
  force,
  starting,
  runError,
}: {
  pipeline: PipelineSpec;
  catalogue: Catalogue | null;
  inputs: ProductRef[];
  plan: Plan | null;
  planning: boolean;
  planError: string;
  dest: string;
  force: boolean;
  starting: boolean;
  runError: string;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const { openPanel } = useLayout();
  const [editingDest, setEditingDest] = useState(Boolean(dest));
  const [showScript, setShowScript] = useState(false);
  const [destDraft, setDestDraft] = useState(dest);
  useEffect(() => setDestDraft(dest), [dest]);

  const stale =
    planning || !plan || plan.pipelineId !== pipeline.id || plan.input.uri !== inputs[0]?.uri;
  const why = !inputs.length
    ? 'Choose a product to run on (Products panel).'
    : planError
      ? planError
      : plan?.problems.length
        ? 'Fix what is listed above first.'
        : stale
          ? 'Checking the plan…'
          : '';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {/* Stages */}
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.5 }}>
          <Caption>Stages</Caption>
          <Box sx={{ flex: 1 }} />
          <Button
            size="small"
            startIcon={<TuneRounded sx={{ fontSize: 15 }} />}
            onClick={() => openPanel('configuration')}
            sx={{ fontSize: 11, textTransform: 'none', py: 0 }}
          >
            Settings
          </Button>
        </Box>
        <Box sx={{ display: 'flex', flexDirection: 'column' }}>
          {pipeline.stages.map((stage, i) => {
            const tool = toolOf(catalogue, stage.tool);
            const planned = plan && !stale ? plan.stages[i] : undefined;
            const skip = planned?.action === 'skip';
            const changed = describeValues(stage, tool);
            return (
              <Box
                key={`${stage.tool}-${i}`}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '22px minmax(0, 1fr) auto',
                  columnGap: 1,
                  alignItems: 'start',
                  py: 0.6,
                  opacity: skip ? 0.55 : 1,
                  '& + &': { borderTop: `1px dashed ${c.border.subtle}` },
                }}
              >
                <Box
                  sx={{
                    width: 18,
                    height: 18,
                    mt: '1px',
                    borderRadius: '50%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 700,
                    color: skip ? c.text.muted : c.accent.main,
                    border: `1px solid ${skip ? c.border.strong : alpha(c.accent.main, 0.5)}`,
                  }}
                >
                  {i + 1}
                </Box>
                <Box sx={{ minWidth: 0 }}>
                  <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap' }}>
                    <Typography sx={{ fontSize: 12, fontWeight: 600, color: c.text.primary }}>
                      {tool?.label ?? stage.tool}
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: c.text.muted }}>{stage.tool}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: 11, color: skip ? c.text.muted : c.text.secondary, lineHeight: 1.5 }}>
                    {skip
                      ? planned?.reason
                      : changed
                        ? changed
                        : 'The tool’s defaults.'}
                  </Typography>
                  {planned?.echodata && (
                    <Typography sx={{ fontSize: 10.5, color: c.text.muted }}>
                      Reads the EchoData it came from: {planned.echodata.split('/').pop()}
                    </Typography>
                  )}
                  {[...(planned?.problems ?? [])].map((p) => (
                    <Typography key={p} sx={{ fontSize: 11, color: c.status.error }}>
                      {p}
                    </Typography>
                  ))}
                  {[...(planned?.warnings ?? [])].map((p) => (
                    <Typography key={p} sx={{ fontSize: 11, color: c.status.warning }}>
                      {p}
                    </Typography>
                  ))}
                </Box>
                {tool && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mt: '1px' }}>
                    <LevelChip level={tool.level} />
                    <Typography sx={{ fontSize: 10.5, color: c.text.muted }}>
                      {kindLabel(planned?.produces || tool.produces, catalogue)}
                    </Typography>
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Destination */}
      <Box>
        <Caption>Products go to</Caption>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75 }}>
          <CloudUploadOutlined sx={{ fontSize: 15, color: c.syntax.entity, mt: '2px' }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 12, color: c.text.primary, wordBreak: 'break-all' }}>
              {plan?.destination ? <PathText path={plan.destination} /> : inputs.length ? '…' : 'Beside the input, in the bucket.'}
            </Typography>
            {plan?.destinationReason && (
              <Typography sx={{ fontSize: 11, color: c.text.muted }}>
                {plan.destinationReason}
                {plan.project ? ` Project ${plan.project}.` : ''}
              </Typography>
            )}
          </Box>
          <Button
            size="small"
            onClick={() => {
              if (editingDest) {
                setDest('');
                setDestDraft('');
              }
              setEditingDest((v) => !v);
            }}
            sx={{ fontSize: 11, textTransform: 'none', py: 0, flexShrink: 0 }}
          >
            {editingDest ? 'Back to the default' : 'Elsewhere…'}
          </Button>
        </Box>
        {editingDest && (
          <TextField
            size="small"
            fullWidth
            value={destDraft}
            placeholder="gs://bucket/folder/"
            onChange={(e) => setDestDraft(e.target.value)}
            onBlur={() => setDest(destDraft.trim())}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setDest(destDraft.trim());
            }}
            inputProps={{ spellCheck: false, 'aria-label': 'Where the products go' }}
            sx={{ ...compactFieldSx, mt: 0.75 }}
          />
        )}
        <FormControlLabel
          sx={{ mt: 0.25, ml: -0.75 }}
          control={<Checkbox size="small" checked={force} onChange={(e) => setForce(e.target.checked)} />}
          label={
            <Typography sx={{ fontSize: 11.5, color: c.text.secondary }}>
              Recompute products already in the bucket (normally reused: same inputs and settings, same product)
            </Typography>
          }
        />
      </Box>

      {/* What is wrong */}
      {planError && (
        <Note tone="error" icon={<ErrorOutlineRounded className="note-icon" />}>
          {planError}
        </Note>
      )}
      {plan && !stale && plan.problems.length > 0 && (
        <Note tone="error" icon={<ErrorOutlineRounded className="note-icon" />}>
          {plan.problems.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </Note>
      )}
      {plan && !stale && plan.warnings.length > 0 && (
        <Note tone="warning" icon={<WarningAmberRounded className="note-icon" />}>
          {plan.warnings.map((p) => (
            <div key={p}>{p}</div>
          ))}
        </Note>
      )}

      {/* The commands */}
      {plan && !stale && plan.script && (
        <Box>
          <Button
            size="small"
            onClick={() => setShowScript((v) => !v)}
            aria-expanded={showScript}
            endIcon={
              <ExpandMoreRounded
                sx={{ fontSize: 16, transform: showScript ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
              />
            }
            sx={{ fontSize: 11.5, textTransform: 'none', px: 0.5, ml: -0.5, color: c.text.secondary }}
          >
            Console commands
          </Button>
          {showScript && (
          <Box sx={{ position: 'relative' }}>
            <Tooltip title="Copy the script">
              <IconButton
                size="small"
                onClick={() => void navigator.clipboard?.writeText(plan.script)}
                sx={{ position: 'absolute', top: 4, right: 4 }}
              >
                <ContentCopyOutlined sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
            <Box
              component="pre"
              sx={{
                m: 0,
                p: 1,
                pr: 4,
                borderRadius: `${theme.aa.radius.sm}px`,
                backgroundColor: c.bg.editor,
                border: `1px solid ${c.border.subtle}`,
                fontFamily: theme.aa.font.mono,
                fontSize: 11,
                lineHeight: 1.55,
                color: c.text.secondary,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                maxHeight: 260,
                overflow: 'auto',
              }}
            >
              {plan.script}
            </Box>
          </Box>
          )}
        </Box>
      )}

      {/* Run */}
      {runError && (
        <Note tone="error" icon={<ErrorOutlineRounded className="note-icon" />}>
          <Box sx={{ whiteSpace: 'pre-wrap' }}>{runError}</Box>
        </Note>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ flex: 1, fontSize: 11, color: why ? c.text.muted : c.text.secondary }}>
          {why ||
            (inputs.length > 1
              ? `${inputs.length} runs, one per product.`
              : `${plan?.stages.filter((s) => s.action === 'run').length ?? 0} stages will run.`)}
        </Typography>
        {planning && <CircularProgress size={14} />}
        <Button
          variant="contained"
          disableElevation
          startIcon={starting ? <CircularProgress size={14} color="inherit" /> : <PlayArrowRounded />}
          disabled={Boolean(why) || starting}
          onClick={() => void startRuns()}
          sx={{ textTransform: 'none', fontSize: 12.5, px: 2 }}
        >
          {inputs.length > 1 ? `Run on ${inputs.length} products` : 'Run'}
        </Button>
      </Box>
    </Box>
  );
}
