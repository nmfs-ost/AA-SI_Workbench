import { useState } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { Box, Tooltip, Typography, useTheme } from '@mui/material';
import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import AddOutlined from '@mui/icons-material/AddOutlined';

import { useActiveAsset } from '../../../state/activeAsset';
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
import { makeStage } from './toolCatalog';
import { defaultValues } from './pipelineTypes';

/**
 * Pipelines panel — the saved console-tool workflows, as cards.
 *
 * Tick one or more cards and the file selected in the NCEI panel is injected as
 * their input automatically; the run controls at the bottom show exactly what
 * would run. Clicking a card focuses it, opening its settings in the
 * Configuration panel. A dashed card at the end (and the + in the header)
 * creates a new pipeline.
 */
export const PipelinesPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const state = usePipelines();
  const asset = useActiveAsset();
  const [createOpen, setCreateOpen] = useState(false);

  const injectedInput = asset?.fileName ?? null;
  const injectedSource = asset ? `${asset.survey} · ${asset.sonar}` : null;

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

      <NewPipelineDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreate={({ name, description, tools }) => {
          createPipeline({
            name,
            description,
            stages: tools.map((template, index) => makeStage(template, index)),
          });
          setCreateOpen(false);
        }}
      />
    </Box>
  );
};
