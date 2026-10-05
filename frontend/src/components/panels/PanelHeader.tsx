import type { ReactNode } from 'react';
import { Box, Typography, useTheme } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';

/**
 * The first row of every docked panel: icon, title, a quiet subtitle, and the
 * panel's actions at the right.
 *
 * Exactly one row tall (tokens.size.row, the docks' tab-strip height), border
 * included, so the line under it continues the line under the tab strip of the
 * dock beside it, and the side strip's highlight for this panel spans exactly
 * this row. Panels used to size their own headers from padding and font, and
 * no two came out the same height.
 */
export function PanelHeader({
  icon,
  title,
  subtitle,
  actions,
  sx,
}: {
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  sx?: SxProps<Theme>;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  return (
    <Box
      sx={[
        {
          height: theme.aa.size.row,
          boxSizing: 'border-box',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          pl: 1.25,
          pr: 0.75,
          borderBottom: `1px solid ${c.border.subtle}`,
          minWidth: 0,
          '& .panel-header-icon': { fontSize: 15, color: c.accent.main, flexShrink: 0 },
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {icon}
      <Typography
        component="h2"
        sx={{
          fontSize: 12.5,
          fontWeight: 600,
          color: c.text.primary,
          whiteSpace: 'nowrap',
          flexShrink: 0,
          m: 0,
        }}
      >
        {title}
      </Typography>
      <Box
        sx={{
          flex: 1,
          minWidth: 0,
          fontSize: 11,
          color: c.text.muted,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {subtitle}
      </Box>
      {actions && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>{actions}</Box>
      )}
    </Box>
  );
}

/** A second row under a PanelHeader (a filter, a toolbar): one row tall too. */
export function PanelBar({ children, sx }: { children: ReactNode; sx?: SxProps<Theme> }) {
  const theme = useTheme();
  return (
    <Box
      sx={[
        {
          height: theme.aa.size.row,
          boxSizing: 'border-box',
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
          minWidth: 0,
        },
        ...(Array.isArray(sx) ? sx : sx ? [sx] : []),
      ]}
    >
      {children}
    </Box>
  );
}
