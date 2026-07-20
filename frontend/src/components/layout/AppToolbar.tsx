import { Box, IconButton, Tooltip, Divider, useTheme } from '@mui/material';

import { toolbarItems } from './toolbarConfig';

/**
 * The application toolbar: a thin strip of icon buttons beneath the menu bar.
 * Buttons are affordance-only for the shell milestone; each has a tooltip and an
 * accessible label so it is ready to be wired to an action.
 */
export function AppToolbar() {
  const theme = useTheme();

  return (
    <Box
      component="div"
      role="toolbar"
      aria-label="Main toolbar"
      sx={{
        display: 'flex',
        alignItems: 'center',
        height: theme.aa.size.toolBar,
        flexShrink: 0,
        px: 1,
        gap: 0.25,
        backgroundColor: theme.aa.color.bg.chrome,
        borderBottom: `1px solid ${theme.aa.color.border.strong}`,
      }}
    >
      {toolbarItems.map((item) => {
        if (item.kind === 'divider') {
          return (
            <Divider
              key={item.id}
              orientation="vertical"
              flexItem
              sx={{
                mx: 0.75,
                my: 1,
                borderColor: theme.aa.color.border.subtle,
              }}
            />
          );
        }

        const Icon = item.icon;
        return (
          <Tooltip key={item.id} title={item.label} arrow>
            <IconButton aria-label={item.label} sx={{ width: 30, height: 30 }}>
              <Icon sx={{ fontSize: 18 }} />
            </IconButton>
          </Tooltip>
        );
      })}
    </Box>
  );
}
