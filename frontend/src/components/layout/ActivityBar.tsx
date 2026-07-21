import { Box, Tooltip, Typography, useTheme } from '@mui/material';

import { panelDefinitions } from '../panels/registry';
import { useLayout } from '../../context/LayoutContext';

/**
 * The vertical strip of source icons down the far-left edge.
 *
 * The problem it solves: four different storage systems live in the left dock —
 * a public S3 archive, the workstation's own disk, a GCS bucket of derived
 * products, and the OMAO fleet — and a row of small text tabs makes it easy to
 * lose track of which one you're reading. JupyterLab's answer is a permanent
 * column of icons where the current one is unmistakably marked, and that's what
 * this is.
 *
 * It is generated from the panel registry (`region: 'left'`), so registering a
 * new data source puts an icon here automatically. Clicking the source you're
 * already in collapses the dock and hands the width back to the editor.
 *
 * The icons don't replace the dock's tabs — those are still how a panel gets
 * dragged somewhere else. They replace *hunting* for them.
 */
export function ActivityBar() {
  const theme = useTheme();
  const { activeLeftPanelId, leftCollapsed, toggleLeftPanel } = useLayout();

  const sources = panelDefinitions.filter(
    (definition) => definition.region === 'left' && !definition.dynamic,
  );

  return (
    <Box
      role="tablist"
      aria-label="File sources"
      aria-orientation="vertical"
      sx={{
        width: 44,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        py: 0.5,
        backgroundColor: theme.aa.color.bg.base,
        borderRight: `1px solid ${theme.aa.color.border.strong}`,
        userSelect: 'none',
      }}
    >
      {sources.map((source) => {
        const Icon = source.icon;
        const selected = activeLeftPanelId === source.id && !leftCollapsed;

        return (
          <Tooltip
            key={source.id}
            title={
              <Box>
                <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
                  {source.title}
                </Typography>
                <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.secondary }}>
                  {source.description}
                </Typography>
              </Box>
            }
            placement="right"
            disableInteractive
          >
            <Box
              component="button"
              role="tab"
              aria-selected={selected}
              aria-label={source.title}
              onClick={() => toggleLeftPanel(source.id)}
              sx={{
                position: 'relative',
                height: 42,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: 'none',
                background: 'none',
                cursor: 'pointer',
                color: selected
                  ? theme.aa.color.text.primary
                  : theme.aa.color.text.muted,
                transition: 'color .12s, background-color .12s',
                '&:hover': {
                  color: theme.aa.color.text.primary,
                  backgroundColor: theme.aa.color.bg.hover,
                },
                '&:focus-visible': {
                  outline: `1px solid ${theme.aa.color.accent.main}`,
                  outlineOffset: -2,
                },
                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                // The active marker: a hairline of accent against the edge.
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  left: 0,
                  top: 6,
                  bottom: 6,
                  width: 2,
                  borderRadius: 1,
                  backgroundColor: selected
                    ? theme.aa.color.accent.main
                    : 'transparent',
                },
              }}
            >
              <Icon sx={{ fontSize: 20 }} />
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}
