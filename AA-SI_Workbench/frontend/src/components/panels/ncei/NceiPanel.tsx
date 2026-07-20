import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { Alert, Box, IconButton, Tooltip, Typography, useTheme } from '@mui/material';
import Refresh from '@mui/icons-material/Refresh';
import PublicOutlined from '@mui/icons-material/PublicOutlined';

import { useNceiSearch } from './useNceiSearch';
import { NceiFilters } from './NceiFilters';
import { NceiResults } from './NceiResults';
import { NceiActions } from './NceiActions';

/**
 * NCEI panel — the graphical front-end to aa-find + aa-fetch + aa-combine,
 * scoped to the NCEI archive. Discover raw files by drilling down
 * vessel → survey → sonar with fuzzy search, select them, then download the
 * raws or combine them into a single derived .nc.
 */
export const NceiPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const controller = useNceiSearch();

  return (
    <Box
      sx={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.aa.color.bg.panel,
      }}
    >
      {/* Slim source header */}
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
        <PublicOutlined sx={{ fontSize: 16 }} />
        <Typography sx={{ fontSize: 12, fontWeight: 600, flex: 1 }}>
          NCEI · NOAA archive
        </Typography>
        <Tooltip title="Reset search">
          <IconButton size="small" onClick={() => controller.reload()}>
            <Refresh sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {controller.error && (
        <Alert severity="error" sx={{ fontSize: 12, borderRadius: 0 }}>
          {controller.error}
        </Alert>
      )}

      <NceiFilters controller={controller} />
      <NceiResults controller={controller} />
      <NceiActions controller={controller} />
    </Box>
  );
};
