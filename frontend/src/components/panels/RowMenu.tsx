import { useCallback, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import {
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import MoreVertOutlined from '@mui/icons-material/MoreVertOutlined';

import type { IconComponent } from '../../types';
import { panelDensity } from './panelStyles';

/**
 * The per-row action menu shared by every file browser in the shell.
 *
 * One component, because the three browsers sit one icon apart in the same
 * dock and do the same job on different storage. `panelStyles.ts` records what
 * happened the last time they were allowed to diverge — they read as three
 * different applications — and a context menu is a much bigger surface to let
 * drift than a font size.
 *
 * Two ways in, one menu:
 *
 *   • **Right-click anywhere on the row.** What anyone tries first, and what
 *     JupyterLab, VS Code and every file manager offer.
 *   • **A ⋮ button at the row's right edge**, revealed on hover, the way
 *     `CopyPathButton` already is. Right-click is undiscoverable — nothing on
 *     screen says it is there — and it is unavailable outright to anyone
 *     driving this from a touchscreen or an assistive pointer. The button is
 *     what makes the actions *visible*; the right-click is what makes them
 *     fast.
 *
 * Both anchor the same menu, so there is one action list per row rather than
 * two that can disagree.
 *
 * ## Disabled items say why
 *
 * An action the current identity cannot use is rendered disabled *with its
 * reason*, not hidden. A hidden action is indistinguishable from an action
 * that does not exist, which sends people to the terminal to do the thing by
 * hand — the exact outcome the menu was added to prevent. See
 * `services/identityApi.ts` for why those reasons are predictions rather than
 * permissions.
 */

export interface RowAction {
  id: string;
  label: string;
  icon?: IconComponent;
  /** Run on select. The menu closes first, so a dialog can take focus. */
  onSelect: () => void;
  disabled?: boolean;
  /** Why it is disabled — shown as a tooltip. Required in spirit: a disabled
      item with no reason is the thing this component exists to avoid. */
  disabledReason?: string;
  /** Draw in the error colour: trashing, and nothing else so far. */
  danger?: boolean;
  /** Draw a separator above this item. */
  dividerBefore?: boolean;
  /** Right-aligned hint, e.g. a keyboard shortcut. */
  hint?: string;
}

/** Where the menu is anchored: a pointer position, or the ⋮ button. */
type Anchor =
  | { kind: 'position'; top: number; left: number }
  | { kind: 'element'; element: HTMLElement };

export interface RowMenuController {
  open: boolean;
  /** Attach to the row: `onContextMenu={menu.onContextMenu}`. */
  onContextMenu: (event: MouseEvent) => void;
  /** Attach to the ⋮ button. */
  onButtonClick: (event: MouseEvent<HTMLElement>) => void;
  close: () => void;
  anchor: Anchor | null;
}

/**
 * Anchor state for one row's menu.
 *
 * Held per row rather than per panel so that opening a second row's menu does
 * not first have to close the first one's — and, more practically, so the menu
 * cannot outlive the row it describes when a listing refreshes underneath it.
 */
export function useRowMenu(): RowMenuController {
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const onContextMenu = useCallback((event: MouseEvent) => {
    // Suppress the browser menu, and stop the row's own onClick from also
    // selecting/expanding — a right-click should not navigate.
    event.preventDefault();
    event.stopPropagation();
    setAnchor({ kind: 'position', top: event.clientY, left: event.clientX });
  }, []);

  const onButtonClick = useCallback((event: MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setAnchor({ kind: 'element', element: event.currentTarget });
  }, []);

  const close = useCallback(() => setAnchor(null), []);

  return { open: anchor !== null, onContextMenu, onButtonClick, close, anchor };
}

/** The ⋮ affordance. Invisible until the row is hovered, or it has focus. */
export function RowMenuButton({
  controller,
  label = 'Actions',
}: {
  controller: RowMenuController;
  label?: string;
}) {
  return (
    <Tooltip title={label} placement="left" disableInteractive>
      <IconButton
        className="aa-rowmenu"
        size="small"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={controller.open}
        onClick={controller.onButtonClick}
        sx={{
          p: 0.25,
          flexShrink: 0,
          // Stays visible while its own menu is open, or the affordance
          // vanishes from under the pointer that just used it.
          opacity: controller.open ? 1 : 0,
          transition: 'opacity .12s',
          '&:focus-visible': { opacity: 1 },
        }}
      >
        <MoreVertOutlined sx={{ fontSize: 14 }} />
      </IconButton>
    </Tooltip>
  );
}

export function RowMenu({
  controller,
  actions,
  /** Shown greyed at the top — which row this menu belongs to. */
  title,
}: {
  controller: RowMenuController;
  actions: readonly RowAction[];
  title?: string;
}) {
  const theme = useTheme();
  const { anchor, close } = controller;

  const anchorProps =
    anchor?.kind === 'position'
      ? {
          anchorReference: 'anchorPosition' as const,
          anchorPosition: { top: anchor.top, left: anchor.left },
        }
      : { anchorEl: anchor?.kind === 'element' ? anchor.element : null };

  return (
    <Menu
      open={controller.open}
      onClose={close}
      {...anchorProps}
      /* A context menu that ate the click which opened it would swallow the
         next row's right-click too. */
      slotProps={{ paper: { sx: { minWidth: 190 } } }}
      MenuListProps={{ dense: true, sx: { py: 0.5 } }}
      onContextMenu={(event) => {
        // Right-clicking the menu itself should dismiss it, not stack a
        // browser menu on top of it.
        event.preventDefault();
        close();
      }}
    >
      {title && (
        <Typography
          sx={{
            px: 1.5,
            pb: 0.5,
            fontSize: panelDensity.font.meta,
            color: theme.aa.color.text.muted,
            fontFamily: theme.aa.font.mono,
            maxWidth: 260,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </Typography>
      )}

      {actions.map((action) => {
        const Icon = action.icon;
        const item = (
          <MenuItem
            key={action.id}
            disabled={action.disabled}
            onClick={() => {
              // Close first: several of these open a dialog, and a dialog
              // fighting a closing menu for focus loses.
              close();
              action.onSelect();
            }}
            sx={{
              fontSize: 12.5,
              py: 0.5,
              color: action.danger ? theme.aa.color.status.error : undefined,
            }}
          >
            {Icon && (
              <ListItemIcon sx={{ minWidth: 28 }}>
                <Icon
                  sx={{
                    fontSize: 16,
                    color: action.danger ? theme.aa.color.status.error : undefined,
                  }}
                />
              </ListItemIcon>
            )}
            <ListItemText
              primaryTypographyProps={{ fontSize: 12.5 }}
              sx={{ pr: action.hint ? 2 : 0 }}
            >
              {action.label}
            </ListItemText>
            {action.hint && (
              <Typography
                sx={{ fontSize: 10.5, color: theme.aa.color.text.muted }}
              >
                {action.hint}
              </Typography>
            )}
          </MenuItem>
        );

        /* A disabled MUI MenuItem fires no pointer events, so a Tooltip on it
           never opens. The wrapping span is what gives the tooltip something
           that still receives a hover — which matters here more than usual,
           because the reason *is* the message. */
        const body: ReactNode =
          action.disabled && action.disabledReason ? (
            <Tooltip
              key={action.id}
              title={action.disabledReason}
              placement="right"
            >
              <span style={{ display: 'block' }}>{item}</span>
            </Tooltip>
          ) : (
            item
          );

        return action.dividerBefore
          ? [
              <Divider
                key={`${action.id}-divider`}
                sx={{ my: 0.5, borderColor: theme.aa.color.border.subtle }}
              />,
              body,
            ]
          : body;
      })}
    </Menu>
  );
}
