import { Box, Tooltip, Typography, useTheme } from '@mui/material';
import ChevronRightOutlined from '@mui/icons-material/ChevronRightOutlined';

import type { PipelineDefinition } from './pipelineTypes';

interface Props {
  pipeline: PipelineDefinition;
}

/**
 * The console-tool chain a pipeline runs, drawn left-to-right.
 *
 * This is a *picture* of the workflow, not a form: each step shows the tool it
 * invokes and what that step does. Editing lives in the Configuration panel, so
 * cards stay scannable and there is exactly one place to change a setting.
 *
 * Generated from the pipeline definition, so it always matches what will run.
 */
export function PipelineFlow({ pipeline }: Props) {
  const theme = useTheme();

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 0.25,
        p: 0.75,
        borderRadius: `${theme.aa.radius.sm}px`,
        backgroundColor: theme.aa.color.bg.base,
        border: `1px solid ${theme.aa.color.border.subtle}`,
      }}
    >
      {pipeline.stages.map((stage, index) => (
        <Box key={stage.id} sx={{ display: 'flex', alignItems: 'center' }}>
          <Tooltip title={stage.description}>
            <Box
              sx={{
                px: 0.85,
                py: 0.5,
                borderRadius: `${theme.aa.radius.sm}px`,
                backgroundColor: theme.aa.color.bg.panel,
                border: `1px solid ${theme.aa.color.border.subtle}`,
                lineHeight: 1.25,
              }}
            >
              <Typography
                sx={{
                  fontFamily: theme.aa.font.mono,
                  fontSize: 10.5,
                  fontWeight: 600,
                  color: theme.aa.color.accent.main,
                  whiteSpace: 'nowrap',
                }}
              >
                {stage.tool}
              </Typography>
              <Typography
                sx={{
                  fontSize: 9.5,
                  color: theme.aa.color.text.muted,
                  whiteSpace: 'nowrap',
                }}
              >
                {stage.label}
              </Typography>
            </Box>
          </Tooltip>

          {index < pipeline.stages.length - 1 && (
            <ChevronRightOutlined
              sx={{ fontSize: 14, color: theme.aa.color.text.muted, mx: 0.1 }}
            />
          )}
        </Box>
      ))}
    </Box>
  );
}
