import { useCallback } from 'react';
import type { IDockviewPanelHeaderProps } from 'dockview';
import { Box, Tooltip, Typography, useTheme } from '@mui/material';
import CloseOutlined from '@mui/icons-material/CloseOutlined';

import { panelDefinitions } from '../panels/registry';

/**
 * A dock tab.
 *
 * Panels in the **left** dock render as their registry icon alone: that group
 * holds the data sources (NCEI, Files, Derived, OMAO), it is the narrowest
 * column in the shell, and four text labels eat width that belongs to the file
 * names underneath them. The icon carries the identity and a tooltip carries
 * the name, so nothing is lost but the horizontal space.
 *
 * Everywhere else keeps its text. Centre and bottom groups are wide, their
 * panels are less visually distinct from one another, and a row of anonymous
 * glyphs there would be a puzzle rather than a saving.
 *
 * Which panels get which treatment is decided by `region` in the registry, so
 * this never needs editing when a panel is added — the definition already says
 * where it lives.
 */
export function PanelTab(props: IDockviewPanelHeaderProps) {
  const theme = useTheme();
  const definition = panelDefinitions.find((d) => d.id === props.api.id);
  const Icon = definition?.icon;
  const title = props.api.title ?? definition?.title ?? props.api.id;
  const iconOnly = Boolean(Icon) && definition?.region === 'left';

  const close = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      props.api.close();
    },
    [props.api],
  );

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        height: '100%',
        px: iconOnly ? 1 : 1.25,
        // Only reveal the close control on hover, so a row of icon tabs stays
        // calm instead of showing eight crosses at rest.
        '&:hover .aa-tab-close': { opacity: 0.7 },
      }}
    >
      {iconOnly && Icon ? (
        <Tooltip title={title} placement="bottom">
          <Icon sx={{ fontSize: 17, display: 'block' }} />
        </Tooltip>
      ) : (
        <Typography
          component="span"
          sx={{ fontSize: 12, lineHeight: 1, whiteSpace: 'nowrap' }}
        >
          {title}
        </Typography>
      )}

      <Box
        className="aa-tab-close"
        onClick={close}
        role="button"
        aria-label={`Close ${title}`}
        sx={{
          display: 'flex',
          alignItems: 'center',
          opacity: 0,
          transition: 'opacity .1s',
          borderRadius: `${theme.aa.radius.sm}px`,
          '&:hover': { opacity: 1, backgroundColor: theme.aa.color.bg.chrome },
        }}
      >
        <CloseOutlined sx={{ fontSize: 13 }} />
      </Box>
    </Box>
  );
}
