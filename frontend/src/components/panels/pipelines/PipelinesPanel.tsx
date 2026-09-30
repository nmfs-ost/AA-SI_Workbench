import { useState } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { Box, Tooltip, Typography, useTheme } from '@mui/material';
import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import AddOutlined from '@mui/icons-material/AddOutlined';

import { useLayout } from '../../../context/LayoutContext';
import { useActiveSubject } from '../../../state/activeSubject';
import {
  clearSelection,
  createPipeline,
  currentConfig,
  isDirty,
  setActivePipeline,
  toggleSelected,
  usePipelines,
} from '../../../state/pipelines';
import { PipelineCard } from './PipelineCard';
import { PipelineRunControls } from './PipelineRunControls';
import { NewPipelineDialog } from './NewPipelineDialog';
import { defaultValues } from './pipelineTypes';

/**
 * Pipelines panel — the saved console-tool workflows, as cards.
 *
 * Tick one or more cards and the file selected in the NCEI panel is injected as
 * their input automatically; the run controls directly beneath the header show
 * exactly what would run. Clicking a card focuses it, opening its settings in
 * the Configuration panel. A dashed card at the end (and the + in the header)
 * creates a new pipeline.
 */
export const PipelinesPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const { openPanel } = useLayout();
  const theme = useTheme();
  const state = usePipelines();
  const subject = useActiveSubject();
  const asset = subject?.asset ?? null;
  const [createOpen, setCreateOpen] = useState(false);

  /* An NCEI file is injected by name (the first tools look it up in NCEI); a
     product in the bucket — one Prepare EchoData just made, or one picked in
     Derived — by its gs:// URI, which every aa-* tool reads directly. */
  const product =
    !asset && subject && /^gs:\/\/.+\.(nc|zarr)\/?$/i.test(subject.uri) ? subject : null;
  const injectedInput = asset?.fileName ?? product?.uri ?? null;
  const injectedSource = asset
    ? `${asset.survey} · ${asset.sonar}`
    : product
      ? product.origin
      : null;

  const selectedPipelines = state.pipelines.filter((p) => state.selected.has(p.id));

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.aa.color.bg.editor,
      }}
    >
      {/* Header */}
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
        <AccountTreeOutlined sx={{ fontSize: 16 }} />
        <Typography sx={{ fontSize: 12, fontWeight: 600, flex: 1 }}>Pipelines</Typography>
        <Typography sx={{ fontSize: 11, color: theme.aa.color.text.muted }}>
          {state.pipelines.length} saved
        </Typography>
        <Tooltip title="New pipeline">
          <Box
            component="button"
            onClick={() => setCreateOpen(true)}
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.25,
              background: 'none',
              border: `1px solid ${theme.aa.color.border.subtle}`,
              borderRadius: `${theme.aa.radius.sm}px`,
              color: theme.aa.color.text.secondary,
              cursor: 'pointer',
              px: 0.6,
              py: 0.15,
              fontSize: 11,
              '&:hover': {
                borderColor: theme.aa.color.accent.main,
                color: theme.aa.color.accent.main,
              },
            }}
          >
            <AddOutlined sx={{ fontSize: 13 }} />
            New
          </Box>
        </Tooltip>
      </Box>

      <PipelineRunControls
        selectedPipelines={selectedPipelines}
        draftsFor={(id) => {
          const pipeline = state.pipelines.find((p) => p.id === id);
          return state.drafts[id] ?? (pipeline ? defaultValues(pipeline) : {});
        }}
        injectedInput={injectedInput}
        injectedSource={injectedSource}
        onClearSelection={clearSelection}
      />

      {/* Cards */}
      <Box
        sx={{
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          p: 1.25,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.25,
        }}
      >
        {state.pipelines.map((pipeline) => {
          const config = currentConfig(state, pipeline.id);
          return (
            <PipelineCard
              key={pipeline.id}
              pipeline={pipeline}
              selected={state.selected.has(pipeline.id)}
              active={state.activePipelineId === pipeline.id}
              dirty={isDirty(state, pipeline.id)}
              configName={config?.name ?? 'Default'}
              onToggleSelected={() => toggleSelected(pipeline.id)}
              onActivate={() => setActivePipeline(pipeline.id)}
              onEdit={() => {
                // Focus it, then surface the panel that owns every setting.
                setActivePipeline(pipeline.id);
                openPanel('configuration');
              }}
            />
          );
        })}

        {/* Create-new affordance */}
        <Box
          onClick={() => setCreateOpen(true)}
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 0.75,
            py: 1.75,
            borderRadius: `${theme.aa.radius.md}px`,
            border: `1px dashed ${theme.aa.color.border.subtle}`,
            color: theme.aa.color.text.muted,
            cursor: 'pointer',
            transition: 'border-color 120ms, color 120ms',
            '&:hover': {
              borderColor: theme.aa.color.accent.main,
              color: theme.aa.color.accent.main,
            },
          }}
        >
          <AddOutlined sx={{ fontSize: 17 }} />
          <Typography sx={{ fontSize: 12.5, fontWeight: 500 }}>
            Create new pipeline
          </Typography>
        </Box>
      </Box>

      <NewPipelineDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={({ name, description, stages, values }) => {
          // The dialog builds both, because a stage list alone cannot carry the
          // flags the user typed or the verbatim text of a hand-written step.
          createPipeline({ name, description, stages, values });
          setCreateOpen(false);
        }}
      />
    </Box>
  );
};
