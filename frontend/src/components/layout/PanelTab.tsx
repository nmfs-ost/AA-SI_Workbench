import { useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import type { IDockviewPanelHeaderProps } from 'dockview';
import { Box, Tooltip, Typography, useTheme } from '@mui/material';
import CloseOutlined from '@mui/icons-material/CloseOutlined';

import { getPanelDefinition } from '../panels/registry';
import { tabPresentation } from './tabPresentation';

/**
 * Every tab in the dock.
 *
 * Registered tools render as their icon, the way they already do on the strips
 * down either edge; open files render as their filename, because that is the
 * only thing telling one file apart from another. `tabPresentation` holds the
 * rule and the reasoning — this file is just the surface.
 *
 * Both kinds share one shape — label slot, then close button — so the only
 * difference between them is what fills the slot.
 *
 * Nothing here computes active state. Dockview sets `color` on the `.tab`
 * element for all four combinations of (group focused?) x (panel fronted?), so
 * an icon drawn in `currentColor` picks up the same full-strength-against-muted
 * treatment the side strips use, and keeps it when focus moves to the editor.
 * The accent marker is CSS too, in dockview-overrides.css. Subscribing to
 * `api.isActive` here would actually be *worse*: it means "fronted AND the
 * group has focus", so the bottom dock would forget which panel it was showing
 * the moment you clicked into a file.
 */

/**
 * Width of the icon's slot in an icon tab. The icon is centred in it, and the
 * close button follows — the same two-part shape as a text tab, so both kinds
 * put their close control in the same place.
 *
 * An earlier version floated the close button over the icon, revealed on hover,
 * to keep icon tabs as narrow as possible. It read as a detached artefact
 * rather than part of the tab, and it made the two tab kinds behave
 * differently for no reason a user could see. A tab that is a few pixels wider
 * is the cheaper trade.
 */
const ICON_LABEL_WIDTH = 24;

function useTitle(api: IDockviewPanelHeaderProps['api']): string {
  const [title, setTitle] = useState(api.title ?? '');
  useEffect(() => {
    setTitle(api.title ?? '');
    const disposable = api.onDidTitleChange((event) => setTitle(event.title ?? ''));
    return () => disposable.dispose();
  }, [api]);
  return title;
}

export function PanelTab({ api }: IDockviewPanelHeaderProps) {
  const theme = useTheme();
  const title = useTitle(api);
  const definition = getPanelDefinition(api.id);
  const presentation = tabPresentation(definition);

  /* `preventDefault` on pointerdown stops the close button starting a tab drag;
     the click itself must not bubble, or Dockview fronts the panel it is about
     to remove. Both are what Dockview's own default tab does. */
  const closeSx = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    p: '1px',
    border: 'none',
    background: 'none',
    color: 'inherit',
    cursor: 'pointer',
    borderRadius: `${theme.aa.radius.sm}px`,
    '&:hover': { backgroundColor: theme.aa.color.bg.hover },
    '&:focus-visible': {
      outline: `1px solid ${theme.aa.color.accent.main}`,
      outlineOffset: -1,
    },
  } as const;

  const onClose = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    api.close();
  };

  const closeButton = (
    <Box
      component="button"
      aria-label={`Close ${title}`}
      onPointerDown={(event: MouseEvent) => event.preventDefault()}
      onClick={onClose}
      sx={closeSx}
    >
      <CloseOutlined sx={{ fontSize: 13 }} />
    </Box>
  );

  if (presentation === 'icon' && definition) {
    const Icon = definition.icon;
    return (
      <Tooltip
        title={
          <Box>
            <Typography sx={{ fontSize: 12, fontWeight: 600 }}>
              {definition.title}
            </Typography>
            <Typography
              sx={{ fontSize: 11.5, color: theme.aa.color.text.secondary }}
            >
              {definition.description}
            </Typography>
          </Box>
        }
        placement="top"
        disableInteractive
      >
        <Box
          aria-label={definition.title}
          sx={{
            boxSizing: 'border-box',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 0.75,
            pl: 1.25,
            pr: 0.75,
            color: 'inherit',
          }}
        >
          {/* The icon occupies the label's slot and is centred in it, so it
              sits where a title would rather than hugging the leading edge. */}
          <Box
            sx={{
              flex: 1,
              minWidth: ICON_LABEL_WIDTH,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              lineHeight: 0,
            }}
          >
            <Icon sx={{ fontSize: 17, display: 'block' }} />
          </Box>
          {closeButton}
        </Box>
      </Tooltip>
    );
  }

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 0.75,
        pl: 1.25,
        pr: 0.75,
        maxWidth: 220,
        color: 'inherit',
      }}
    >
      <Typography
        sx={{
          fontSize: 12.5,
          fontWeight: 500,
          color: 'inherit',
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {title}
      </Typography>
      {closeButton}
    </Box>
  );
}
