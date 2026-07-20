import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { Box, Typography, useTheme } from '@mui/material';

/**
 * The central workspace. This is the large surface that future visualisations
 * (maps, plots, editors, 3-D views …) will mount into. For the shell milestone
 * it displays only the application name and status.
 */
export const WorkspacePanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();

  return (
    <Box
      sx={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        userSelect: 'none',
        backgroundColor: theme.aa.color.bg.editor,
      }}
    >
      <Typography
        component="h1"
        sx={{
          fontSize: 26,
          fontWeight: 600,
          letterSpacing: 0.4,
          color: theme.aa.color.text.primary,
        }}
      >
        AA-SI Workspace
      </Typography>
      <Typography
        sx={{
          fontSize: 14,
          color: theme.aa.color.text.muted,
          letterSpacing: 0.3,
        }}
      >
        Ready
      </Typography>
    </Box>
  );
};
