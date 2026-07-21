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
 * The strip of icons along an outer edge — the only navigation in the shell
 * that never moves.
 *
 * The problem it solves, three times over. On the left, four different storage
 * systems share one dock (a public S3 archive, the workstation's own disk, a
 * GCS bucket of derived products, the OMAO fleet); on the right, four different
 * views of the current selection; along the bottom, five places output turns
 * up. In every case a row of small text tabs makes it easy to lose track of
 * which one you're reading, and "Processing Queue" eats a third of a narrow
 * dock's width just to name itself. JupyterLab's answer is a permanent strip of
 * icons where the current one is unmistakably marked, and that's what this is.
 *
 * All three docks' tab strips are hidden (see `syncSidebarChrome`), so these
 * icons are their *only* label. The active state therefore carries three cues —
 * accent hairline, tinted background, full-strength icon colour — and the names
 * live in the tooltips, which are also the accessible labels.
 *
 * The bottom strip is why the tools dock can be collapsed at all. Its icons
 * used to be the dock's own tabs, which meant hiding the dock hid the only
 * control that could bring it back; moving them out here, beside the dock
 * rather than inside it, is what makes clicking one close the whole thing
 * safely — the same gesture, and the same code path, as either side.
 *
 * Everything is generated from the panel registry by `region`, so registering a
 * new panel on any of the three edges puts an icon here with no further wiring.
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

/** Thickness of a vertical strip. */
const STRIP_WIDTH = 44;
/**
 * Thickness of the horizontal one. It is the tab strip's own height, so the
 * bottom dock's chrome costs exactly what it did before the icons moved out of
 * it — the collapse this buys is free in vertical space.
 */
const STRIP_HEIGHT = 34;
/** Extent of one icon along the strip, so they read as one list. */
const ITEM_EXTENT = 42;

const STRIP_LABEL: Record<DockSide, string> = {
  left: 'Data sources',
  right: 'Inspectors',
  bottom: 'Output and diagnostics',
};

/** Which way a tooltip opens: outward, away from the dock the strip serves. */
const TIP_PLACEMENT: Record<DockSide, 'left' | 'right' | 'top'> = {
  left: 'right',
  right: 'left',
  bottom: 'top',
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

  const vertical = side !== 'bottom';

  const panels = panelDefinitions.filter(
    (definition) => definition.region === side && !definition.dynamic,
  );

  const itemSx = (selected: boolean) => ({
    position: 'relative' as const,
    boxSizing: 'border-box' as const,
    height: vertical ? ITEM_EXTENT : '100%',
    width: vertical ? '100%' : ITEM_EXTENT,
    p: 0,
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
    // strips mirror each other rather than all pointing the same way.
    '&::before': {
      content: '""',
      position: 'absolute',
      [side]: 0,
      ...(vertical
        ? { top: 6, bottom: 6, width: 2 }
        : { left: 6, right: 6, height: 2 }),
      borderRadius: 1,
      backgroundColor: selected ? theme.aa.color.accent.main : 'transparent',
    },
  });

  return (
    <Box
      sx={{
        ...(vertical
          ? { width: STRIP_WIDTH, flexDirection: 'column' }
          : { height: STRIP_HEIGHT, flexDirection: 'row' }),
        flexShrink: 0,
        display: 'flex',
        alignItems: 'stretch',
        // No padding on the leading edge: the first icon sits flush with the
        // start of the dock beside it, so strip and panel share one baseline.
        ...(vertical ? { pt: 0, pb: 0.5 } : { pl: 0, pr: 0.5 }),
        backgroundColor: theme.aa.color.bg.base,
        [vertical ? (side === 'left' ? 'borderRight' : 'borderLeft') : 'borderTop']:
          `1px solid ${theme.aa.color.border.strong}`,
        userSelect: 'none',
      }}
    >
      <Box
        role="tablist"
        aria-label={STRIP_LABEL[side]}
        aria-orientation={vertical ? 'vertical' : 'horizontal'}
        sx={{ display: 'flex', flexDirection: vertical ? 'column' : 'row' }}
      >
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
              placement={TIP_PLACEMENT[side]}
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
                <Icon sx={{ fontSize: 20, display: 'block' }} />
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
                    <Icon sx={{ fontSize: 20, display: 'block' }} />
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
