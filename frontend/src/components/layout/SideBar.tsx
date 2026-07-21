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
import type { DockSide } from './sidebarChrome';

/**
 * The vertical strip of icons down an outer edge — the only navigation in the
 * shell that never moves.
 *
 * The problem it solves, twice over. On the left, four different storage
 * systems share one dock (a public S3 archive, the workstation's own disk, a
 * GCS bucket of derived products, the OMAO fleet); on the right, four different
 * views of the current selection. In both cases a row of small text tabs makes
 * it easy to lose track of which one you're reading, and "Processing Queue"
 * eats a third of a narrow dock's width just to name itself. JupyterLab's
 * answer is a permanent column of icons where the current one is unmistakably
 * marked, and that's what this is.
 *
 * Both docks' tab strips are hidden (see `syncSidebarChrome`), so these icons
 * are their *only* label. The active state therefore carries three cues —
 * accent hairline, tinted background, full-strength icon colour — and the names
 * live in the tooltips, which are also the accessible labels.
 *
 * Everything is generated from the panel registry by `region`, so registering a
 * new panel on either edge puts an icon here with no further wiring.
 *
 * The left strip also carries the shell's two standing actions beneath a
 * divider. They used to be a separate toolbar; that strip held nothing else, so
 * it went and its buttons joined the column. Same size, same column, same edge
 * — the divider is what says "these do something rather than show something".
 */

interface ActionItem {
  id: string;
  label: string;
  icon: IconComponent;
  dialogId: DialogId;
}

/** Shell actions, shown once, on the left strip only. */
const SHELL_ACTIONS: readonly ActionItem[] = [
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

const STRIP_WIDTH = 44;
/** Every icon in a column is this tall, so they read as one list. */
const ITEM_HEIGHT = 42;

const STRIP_LABEL: Record<DockSide, string> = {
  left: 'Data sources',
  right: 'Inspectors',
};

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

export function SideBar({ side }: { side: DockSide }) {
  const theme = useTheme();
  const { activeDockPanel, dockCollapsed, toggleDockPanel } = useLayout();
  const updating = useUpdateJobState() === 'running';

  const panels = panelDefinitions.filter(
    (definition) => definition.region === side && !definition.dynamic,
  );

  const itemSx = (selected: boolean) => ({
    position: 'relative' as const,
    height: ITEM_HEIGHT,
    width: '100%',
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
    // The active marker: a hairline of accent against the outer edge, so the
    // two strips mirror each other rather than both pointing left.
    '&::before': {
      content: '""',
      position: 'absolute',
      [side]: 0,
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
        width: STRIP_WIDTH,
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        // No top padding: the first icon sits flush with the top of the dock
        // beside it, so the column and the panel share one baseline.
        pt: 0,
        pb: 0.5,
        backgroundColor: theme.aa.color.bg.base,
        [side === 'left' ? 'borderRight' : 'borderLeft']:
          `1px solid ${theme.aa.color.border.strong}`,
        userSelect: 'none',
      }}
    >
      <Box role="tablist" aria-label={STRIP_LABEL[side]} aria-orientation="vertical">
        {panels.map((definition) => {
          const Icon = definition.icon;
          const selected =
            activeDockPanel[side] === definition.id && !dockCollapsed[side];

          return (
            <Tooltip
              key={definition.id}
              title={
                <TipBody title={definition.title} detail={definition.description} />
              }
              placement={side === 'left' ? 'right' : 'left'}
              disableInteractive
            >
              <Box
                component="button"
                role="tab"
                aria-selected={selected}
                aria-label={definition.title}
                onClick={() => toggleDockPanel(definition.id as PanelId)}
                sx={itemSx(selected)}
              >
                <Icon sx={{ fontSize: 20 }} />
              </Box>
            </Tooltip>
          );
        })}
      </Box>

      {side === 'left' && (
        <>
          <Divider
            sx={{ mx: 1.25, my: 0.75, borderColor: theme.aa.color.border.subtle }}
          />
          {SHELL_ACTIONS.map((action) => {
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
        </>
      )}
    </Box>
  );
}
