import {
  Box,
  Checkbox,
  Chip,
  IconButton,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { TuneOutlined } from '@mui/icons-material';

import type { PipelineDefinition } from './pipelineTypes';
import { PipelineFlow } from './PipelineFlow';

interface Props {
  pipeline: PipelineDefinition;
  selected: boolean;
  active: boolean;
  dirty: boolean;
  configName: string;
  onToggleSelected: () => void;
  onActivate: () => void;
  /** Focus this pipeline and open the Configuration panel to edit it. */
  onEdit: () => void;
}

/**
 * One saved pipeline. The checkbox picks it for a run; clicking the card focuses
 * it so the Configuration panel shows its settings.
 *
 * The card shows what the pipeline *is* — its tool chain and which
 * configuration is loaded — and stays free of parameter controls: every setting
 * lives in the Configuration panel, so there is exactly one place to change it.
 * The Edit button is a shortcut to that panel, not a second way to edit.
 */
export function PipelineCard({
  pipeline,
  selected,
  active,
  dirty,
  configName,
  onToggleSelected,
  onActivate,
  onEdit,
}: Props) {
  const theme = useTheme();

  return (
    <Box
      onClick={onActivate}
      sx={{
        borderRadius: `${theme.aa.radius.md}px`,
        border: `1px solid ${
          active ? theme.aa.color.accent.main : theme.aa.color.border.subtle
        }`,
        backgroundColor: active ? theme.aa.color.bg.selected : theme.aa.color.bg.panel,
        p: 1.1,
        cursor: 'pointer',
        transition: 'border-color 120ms, background-color 120ms',
        '&:hover': { borderColor: theme.aa.color.accent.main },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
        <Checkbox
          size="small"
          checked={selected}
          onClick={(e) => e.stopPropagation()}
          onChange={onToggleSelected}
          sx={{ p: 0.5, mt: -0.25 }}
        />
        <Tooltip title="Edit this pipeline's settings">
          <IconButton
            size="small"
            aria-label={`Edit ${pipeline.name}`}
            onClick={(e) => {
              e.stopPropagation();
              onEdit();
            }}
            sx={{ order: 2, ml: 'auto', flexShrink: 0, alignSelf: 'flex-start' }}
          >
            <TuneOutlined sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
            <Typography
              sx={{ fontSize: 13, fontWeight: 600, color: theme.aa.color.text.primary }}
            >
              {pipeline.name}
            </Typography>
            <Tooltip title="Configuration in use">
              <Chip
                label={configName}
                size="small"
                sx={{
                  height: 17,
                  fontSize: 10,
                  backgroundColor: theme.aa.color.bg.elevated,
                  color: theme.aa.color.text.secondary,
                }}
              />
            </Tooltip>
            {dirty && (
              <Tooltip title="Unsaved changes to this configuration">
                <Chip
                  label="modified"
                  size="small"
                  sx={{
                    height: 17,
                    fontSize: 10,
                    backgroundColor: theme.aa.color.accent.soft,
                    color: theme.aa.color.accent.main,
                  }}
                />
              </Tooltip>
            )}
          </Box>

          <Typography
            sx={{
              fontSize: 11.5,
              color: theme.aa.color.text.secondary,
              mt: 0.25,
              mb: 0.75,
              lineHeight: 1.45,
            }}
          >
            {pipeline.description}
          </Typography>

          <PipelineFlow pipeline={pipeline} />
        </Box>
      </Box>
    </Box>
  );
}
