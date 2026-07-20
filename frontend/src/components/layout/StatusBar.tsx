import { Box, Typography, useTheme } from '@mui/material';

/**
 * A slim status strip along the bottom of the shell. Global chrome that frames
 * the window and hosts lightweight status text. Kept deliberately minimal.
 */
export function StatusBar() {
  const theme = useTheme();

  const labelSx = {
    fontSize: 11.5,
    color: theme.aa.color.text.muted,
    letterSpacing: 0.2,
  } as const;

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
      <Typography sx={labelSx}>Ready</Typography>
    </Box>
  );
}
