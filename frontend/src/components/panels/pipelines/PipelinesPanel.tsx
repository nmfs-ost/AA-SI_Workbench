import { useEffect, useMemo, useRef, useState } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import {
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  AccountTreeOutlined,
  AddRounded,
  ErrorOutlineRounded,
  RefreshRounded,
} from '@mui/icons-material';

import type { PipelineSpec } from '../../../services/pipelinesApi';
import {
  deletePipeline,
  effective,
  initPipelines,
  isEdited,
  loadCatalogue,
  loadPipelines,
  setActivePipeline,
  usePipelines,
} from '../../../state/pipelines';
import { PanelHeader } from '../PanelHeader';
import { Caption, Note } from '../prepare/ui';
import { InputCard } from './InputCard';
import { PipelineCard } from './PipelineCard';
import { PipelineEditorDialog } from './PipelineEditorDialog';
import { PlanView } from './PlanView';
import { RunCard } from './RunCard';
import { fit, kindLabel } from './chain';

/**
 * Pipelines: console tools chained, run on products in the bucket.
 *
 * Top to bottom, the order of the work: the input (products chosen in the
 * Products panel, with their hashes), the pipelines that can take it (each
 * drawn as the products it passes along; the open one shows the server's plan
 * and runs it), and the runs, each stage's state and then the products made,
 * which can be inspected, found in the bucket, or fed to the next pipeline.
 * A pipeline's settings are edited in Configuration.
 */
export const PipelinesPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const c = theme.aa.color;
  const s = usePipelines();
  const [filter, setFilter] = useState<'fits' | 'all'>('fits');
  const [editor, setEditor] = useState<{ open: boolean; initial: PipelineSpec | null }>({
    open: false,
    initial: null,
  });
  const [deleting, setDeleting] = useState<PipelineSpec | null>(null);

  useEffect(() => initPipelines(), []);

  // A run just started (or chosen): bring it into view, above the pipelines.
  const runsRef = useRef<HTMLDivElement | null>(null);
  const lastRun = useRef(s.activeRunId);
  useEffect(() => {
    if (s.activeRunId && s.activeRunId !== lastRun.current) {
      runsRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    lastRun.current = s.activeRunId;
  }, [s.activeRunId]);

  const kinds = useMemo(() => s.inputs.map((i) => i.kind).filter(Boolean), [s.inputs]);
  const rows = useMemo(
    () =>
      s.pipelines.map((p) => {
        const spec = effective(s, p.id) ?? p;
        return { spec, fit: s.catalogue ? fit(spec, kinds, s.catalogue) : null };
      }),
    [s, kinds],
  );
  const fitting = rows.filter((r) => r.fit?.ok !== false);
  const shown = filter === 'fits' && kinds.length ? fitting : rows;
  const mine = s.pipelines.filter((p) => !p.builtin).length;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: c.bg.editor, minHeight: 0 }}>
      <PanelHeader
        icon={<AccountTreeOutlined className="panel-header-icon" />}
        title="Pipelines"
        subtitle={
          s.catalogue
            ? `${s.pipelines.length - mine} built in · ${mine} yours · ${s.catalogue.tools.length} console tools${
                s.catalogue.aalibraryVersion ? ` (aalibrary ${s.catalogue.aalibraryVersion})` : ''
              }`
            : ''
        }
        actions={
          <>
            <Tooltip title="Read the installed console tools again">
              <IconButton
                size="small"
                onClick={() => {
                  void loadCatalogue(true);
                  void loadPipelines();
                }}
              >
                <RefreshRounded sx={{ fontSize: 16 }} />
              </IconButton>
            </Tooltip>
            <Button
              size="small"
              startIcon={<AddRounded sx={{ fontSize: 16 }} />}
              onClick={() => setEditor({ open: true, initial: null })}
              disabled={!s.catalogue?.tools.length}
              sx={{ textTransform: 'none', fontSize: 12 }}
            >
              New pipeline
            </Button>
          </>
        }
      />

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Box sx={{ maxWidth: 1040, mx: 'auto', px: 2, py: 1.75, display: 'flex', flexDirection: 'column', gap: 2 }}>
          {(s.catalogueError || s.listError) && (
            <Note tone="error" icon={<ErrorOutlineRounded className="note-icon" />}>
              {s.catalogueError || s.listError}
            </Note>
          )}
          {s.catalogue && s.catalogue.missing.length > 0 && !s.catalogue.problem && (
            <Note tone="warning">
              Not in the installed aalibrary, so not offered: {s.catalogue.missing.join(', ')}.
            </Note>
          )}

          <InputCard inputs={s.inputs} />

          {s.runs.length > 0 && (
            <Box ref={runsRef}>
              <Caption>Runs</Caption>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                {s.runs.map((run) => (
                  <RunCard key={run.id} run={run} open={run.id === s.activeRunId} />
                ))}
              </Box>
            </Box>
          )}

          <Box>
            <Box sx={{ display: 'flex', alignItems: 'center', mb: 0.75 }}>
              <Caption>Pipelines</Caption>
              <Box sx={{ flex: 1 }} />
              {kinds.length > 0 && (
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={filter}
                  onChange={(_, v) => v && setFilter(v)}
                  sx={{ '& .MuiToggleButton-root': { py: 0.1, px: 1, fontSize: 11, textTransform: 'none' } }}
                >
                  <ToggleButton value="fits">Can take the input ({fitting.length})</ToggleButton>
                  <ToggleButton value="all">All ({rows.length})</ToggleButton>
                </ToggleButtonGroup>
              )}
            </Box>
            {!s.catalogue && !s.catalogueError && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
                <CircularProgress size={14} />
                <Typography sx={{ fontSize: 12, color: c.text.muted }}>Reading the installed console tools…</Typography>
              </Box>
            )}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              {shown.map(({ spec, fit: f }) => {
                const active = spec.id === s.activePipelineId;
                return (
                  <PipelineCard
                    key={spec.id}
                    pipeline={spec}
                    catalogue={s.catalogue}
                    inputKind={s.inputs[0]?.kind ?? ''}
                    fit={f}
                    active={active}
                    edited={isEdited(s, spec.id)}
                    onOpen={() => setActivePipeline(active ? null : spec.id)}
                    onEdit={() => setEditor({ open: true, initial: spec })}
                    onDuplicate={() =>
                      setEditor({ open: true, initial: { ...spec, id: '', builtin: false, name: `${spec.name} (copy)` } })
                    }
                    onDelete={() => setDeleting(spec)}
                  >
                    {active && (
                      <PlanView
                        pipeline={spec}
                        catalogue={s.catalogue}
                        inputs={s.inputs}
                        plan={s.plan}
                        planning={s.planning}
                        planError={s.planError}
                        dest={s.dest}
                        force={s.force}
                        starting={s.starting}
                        runError={s.runError}
                      />
                    )}
                  </PipelineCard>
                );
              })}
              {s.catalogue && shown.length === 0 && (
                <Typography sx={{ fontSize: 12, color: c.text.muted, py: 1 }}>
                  No pipeline here reads {kindLabel(s.inputs[0]?.kind ?? '', s.catalogue)} products. Show all, or make
                  one with New pipeline.
                </Typography>
              )}
            </Box>
          </Box>

        </Box>
      </Box>

      <PipelineEditorDialog
        open={editor.open}
        initial={editor.initial}
        catalogue={s.catalogue}
        onClose={() => setEditor({ open: false, initial: null })}
      />
      <DeleteDialog pipeline={deleting} onClose={() => setDeleting(null)} />
    </Box>
  );
};

function DeleteDialog({ pipeline, onClose }: { pipeline: PipelineSpec | null; onClose: () => void }) {
  const [error, setError] = useState('');
  useEffect(() => setError(''), [pipeline]);
  return (
    <Dialog open={Boolean(pipeline)} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle sx={{ fontSize: 15 }}>Delete “{pipeline?.name}”?</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: 12.5 }}>
          The pipeline goes; the products it made stay in the bucket.
        </Typography>
        {error && (
          <Typography sx={{ fontSize: 12, mt: 1 }} color="error">
            {error}
          </Typography>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          Cancel
        </Button>
        <Button
          color="error"
          variant="contained"
          disableElevation
          sx={{ textTransform: 'none' }}
          onClick={() => {
            if (!pipeline) return;
            deletePipeline(pipeline.id).then(onClose, (e: Error) => setError(e.message));
          }}
        >
          Delete
        </Button>
      </DialogActions>
    </Dialog>
  );
}
