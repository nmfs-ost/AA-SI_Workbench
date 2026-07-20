import { Box } from '@mui/material';

import { MenuBar } from './MenuBar';
import { AppToolbar } from './AppToolbar';
import { DockLayout } from './DockLayout';
import { StatusBar } from './StatusBar';

/**
 * The application shell. A fixed vertical stack — menu bar, toolbar, docking
 * surface, status bar — filling the viewport. The docking surface is the only
 * region that grows; everything else keeps its fixed height.
 */
export function AppShell() {
  return (
    <Box
      sx={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        backgroundColor: (theme) => theme.aa.color.bg.editor,
      }}
    >
      <MenuBar />
      <AppToolbar />
      <DockLayout />
      <StatusBar />
    </Box>
  );
}
