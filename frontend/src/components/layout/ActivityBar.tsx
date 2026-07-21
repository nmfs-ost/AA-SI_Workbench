import { Box, CircularProgress, Divider, Tooltip, Typography, useTheme } from '@mui/material';
import {
  BugReportOutlined,
  SystemUpdateAltOutlined,
} from '@mui/icons-material';

import type { DialogId, IconComponent, PanelId } from '../../types';
import { panelDefinitions } from '../panels/registry';
import { useLayout } from '../../context/LayoutContext';
import { openDialog } from '../../state/dialogs';
import { useUpdateJobState } from '../../state/environment';

/**
 * The vertical strip of icons down the far-left edge — the only navigation in
 * the shell that never moves.
 *
 * The problem it solves: four different storage systems live in the left dock —
 * a public S3 archive, the workstation's own disk, a GCS bucket of derived
 * products, and the OMAO fleet — and a row of small text tabs makes it easy to
 * lose track of which one you're reading. JupyterLab's answer is a permanent
 * column of icons where the current one is unmistakably marked, and that's what
 * this is. The sidebar's tab strip is hidden (see `syncSidebarChrome`), so
 * these icons are its *only* label; the active state therefore carries three
 * cues — accent hairline, tinted background, full-strength icon colour — and
 * the names live in the tooltips, which are also the accessible labels.
 *
 * Sources are generated from the panel registry (`region: 'left'`), so
 * registering a new one puts an icon here with no further wiring.
 *
 * Beneath them, after a divider, sit the shell's two standing actions. They
 * used to live in a separate toolbar strip; that strip held nothing else, so
 * the strip is gone and its buttons joined the column. Same size, same column,
 * same left edge — the divider is what says "these do something rather than
 * show something".
 */

interface ActionItem {
  id: string;
  label: string;
  icon: IconComponent;
  dialogId: DialogId;
}

const ACTIONS: readonly ActionItem[] = [
  {
    id: 'environment',
    label: 'Update Python environment (aa-setup)',
    icon: SystemUpdateAltOutlined,
    dialogId: 'environment',
  },
  {
    id: 'feedback',
    label: 'Report a problem or suggest an improvement',
    icon: BugReportOutlined,
    dialogId: 'feedback',
  },
];

/** Every icon in the column is this tall, so they read as one list. */
const ITEM_HEIGHT = 42;

function TipBody({ title, detail }: { title: string; detail?: string }) {
  const theme = useTheme();
  return (
    <Box>
      <Typography sx={{ fontSize: 12, fontWeight: 600 }}>{title}</Typography>
      {detail && (
        <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.secondary }}>
          {detail}
        </Typography>
      )}
    </Box>
  );
}

export function ActivityBar() {
  const theme = useTheme();
  const { activeLeftPanelId, leftCollapsed, toggleLeftPanel } = useLayout();
  const updating = useUpdateJobState() === 'running';

  const sources = panelDefinitions.filter(
    (definition) => definition.region === 'left' && !definition.dynamic,
  );

  const itemSx = (selected: boolean) => ({
    position: 'relative' as const,
    height: ITEM_HEIGHT,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    border: 'none',
    background: 'none',
    cursor: 'pointer',
    color: selected ? theme.aa.color.text.primary : theme.aa.color.text.muted,
    backgroundColor: selected ? theme.aa.color.bg.selected : 'transparent',
    transition: 'color .12s, background-color .12s',
    '&:hover': {
      color: theme.aa.color.text.primary,
      backgroundColor: selected
        ? theme.aa.color.bg.selected
        : theme.aa.color.bg.hover,
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
      backgroundColor: selected ? theme.aa.color.accent.main : 'transparent',
    },
  });

  return (
    <Box
      sx={{
        width: 44,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        // No top padding: the first icon sits flush with the top of the dock
        // beside it, so the column and the panel share one baseline.
        pt: 0,
        pb: 0.5,
        backgroundColor: theme.aa.color.bg.base,
        borderRight: `1px solid ${theme.aa.color.border.strong}`,
        userSelect: 'none',
      }}
    >
      <Box role="tablist" aria-label="File sources" aria-orientation="vertical">
        {sources.map((source) => {
          const Icon = source.icon;
          const selected = activeLeftPanelId === source.id && !leftCollapsed;

          return (
            <Tooltip
              key={source.id}
              title={<TipBody title={source.title} detail={source.description} />}
              placement="right"
              disableInteractive
            >
              <Box
                component="button"
                role="tab"
                aria-selected={selected}
                aria-label={source.title}
                onClick={() => toggleLeftPanel(source.id as PanelId)}
                sx={{ ...itemSx(selected), width: '100%' }}
              >
                <Icon sx={{ fontSize: 20 }} />
              </Box>
            </Tooltip>
          );
        })}
      </Box>

      <Divider
        sx={{ mx: 1.25, my: 0.75, borderColor: theme.aa.color.border.subtle }}
      />

      {ACTIONS.map((action) => {
        const Icon = action.icon;
        const busy = updating && action.id === 'environment';
        return (
          <Tooltip
            key={action.id}
            title={
              <TipBody
                title={busy ? 'Environment update running…' : action.label}
              />
            }
            placement="right"
            disableInteractive
          >
            <Box
              component="button"
              aria-label={action.label}
              onClick={() => openDialog(action.dialogId)}
              sx={itemSx(false)}
            >
              {busy ? (
                <CircularProgress size={15} thickness={5} />
              ) : (
                <Icon sx={{ fontSize: 20 }} />
              )}
            </Box>
          </Tooltip>
        );
      })}
    </Box>
  );
}
