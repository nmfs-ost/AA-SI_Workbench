import { Box, CircularProgress, Typography, useTheme } from '@mui/material';

import { openDialog } from '../../state/dialogs';
import { useUpdateJobState } from '../../state/environment';

/**
 * A slim status strip along the bottom of the shell. Global chrome that frames
 * the window and hosts lightweight status text.
 *
 * The right-hand slot reflects the environment update job, so a run started
 * from the dialog stays visible after the dialog is closed; clicking it reopens
 * the dialog.
 */
export function StatusBar() {
  const theme = useTheme();
  const jobState = useUpdateJobState();

  const labelSx = {
    fontSize: 11.5,
    color: theme.aa.color.text.muted,
    letterSpacing: 0.2,
  } as const;

  const status: Record<string, { text: string; color?: string }> = {
    idle: { text: 'Ready' },
    running: { text: 'Updating environment…', color: theme.aa.color.accent.main },
    succeeded: { text: 'Environment updated', color: theme.aa.color.status.success },
    failed: { text: 'Environment update failed', color: theme.aa.color.status.error },
    cancelled: {
      text: 'Environment update cancelled',
      color: theme.aa.color.status.warning,
    },
  };
  const current = status[jobState] ?? status.idle;
  const interactive = jobState !== 'idle';

  return (
    <Box
      component="footer"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: theme.aa.size.statusBar,
        flexShrink: 0,
        px: 1.5,
        backgroundColor: theme.aa.color.bg.base,
        borderTop: `1px solid ${theme.aa.color.border.strong}`,
        userSelect: 'none',
      }}
    >
      <Typography sx={labelSx}>Active Acoustics Strategic Initiative</Typography>

      <Box
        onClick={interactive ? () => openDialog('environment') : undefined}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          cursor: interactive ? 'pointer' : 'default',
          '&:hover': interactive ? { opacity: 0.85 } : undefined,
        }}
      >
        {jobState === 'running' && <CircularProgress size={10} thickness={6} />}
        <Typography sx={{ ...labelSx, color: current.color ?? labelSx.color }}>
          {current.text}
        </Typography>
      </Box>
    </Box>
  );
}
