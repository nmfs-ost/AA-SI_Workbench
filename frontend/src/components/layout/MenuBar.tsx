import { useRef, useState } from 'react';
import {
  Box,
  Button,
  Menu,
  MenuItem,
  Tooltip,
  Divider,
  Typography,
  useTheme,
} from '@mui/material';
import { CheckOutlined } from '@mui/icons-material';

import type { MenuItemDefinition } from '../../types';
import { useLayout } from '../../context/LayoutContext';
import { openDialog } from '../../state/dialogs';
import { saveActiveDoc } from '../../state/editors';
import { setThemeMode, useThemeMode } from '../../state/theme';
import { NoaaMark } from '../branding/NoaaMark';
import { menus } from './menuConfig';

/** A row that shows a tick: it names one of a set of mutually exclusive states. */
function isCheckable(item: MenuItemDefinition): boolean {
  return item.layoutVariant !== undefined || item.themeMode !== undefined;
}

/** True when any row in this menu carries a tick, so all its rows get the column. */
function menuHasChecks(items: MenuItemDefinition[]): boolean {
  return items.some(isCheckable);
}

/**
 * Desktop-style menu bar. Clicking a top-level label opens its menu; while any
 * menu is open, hovering a sibling label switches to it (classic menu-bar feel).
 * The bar sits above the menu's click-away backdrop so hovering keeps working.
 *
 * Menu commands dispatch through the layout controller (window management) or
 * the dialog store (shell modals). Actions with no shell behaviour yet are
 * inert placeholders.
 */
export function MenuBar() {
  const theme = useTheme();
  const { resetLayout, closeAllPanels, openPanel, applyLayout, layoutVariant } =
    useLayout();
  const themeMode = useThemeMode();

  /* Which state a row names, and whether it is the one in force. Both facts are
     runtime, so neither is stored in the menu definition. */
  const isChecked = (item: MenuItemDefinition): boolean =>
    (item.layoutVariant !== undefined && item.layoutVariant === layoutVariant) ||
    (item.themeMode !== undefined && item.themeMode === themeMode);

  const [openId, setOpenId] = useState<string | null>(null);
  const buttonRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  const close = () => setOpenId(null);

  const toggle = (id: string) =>
    setOpenId((prev) => (prev === id ? null : id));

  const handleEnter = (id: string) =>
    setOpenId((prev) => (prev !== null && prev !== id ? id : prev));

  const dispatch = (item: MenuItemDefinition) => {
    switch (item.action) {
      case 'reset-layout':
        resetLayout();
        break;
      case 'close-all-panels':
        closeAllPanels();
        break;
      case 'open-panel':
        if (item.panelId) openPanel(item.panelId);
        break;
      case 'open-dialog':
        if (item.dialogId) openDialog(item.dialogId, item.dialogPayload);
        break;
      case 'open-external':
        if (item.href) window.open(item.href, '_blank', 'noopener,noreferrer');
        break;
      case 'save-active-file':
        void saveActiveDoc();
        break;
      case 'apply-layout':
        if (item.layoutVariant) applyLayout(item.layoutVariant);
        break;
      case 'set-theme':
        if (item.themeMode) setThemeMode(item.themeMode);
        break;
      default:
        // 'noop' / unimplemented placeholder.
        break;
    }
    close();
  };

  return (
    <Box
      component="nav"
      sx={{
        display: 'flex',
        alignItems: 'center',
        height: theme.aa.size.menuBar,
        flexShrink: 0,
        px: 1,
        gap: 0.25,
        backgroundColor: theme.aa.color.bg.chrome,
        borderBottom: `1px solid ${theme.aa.color.border.strong}`,
        // Sit above the menu backdrop so hover-to-switch works.
        position: 'relative',
        zIndex: (t) => t.zIndex.modal + 1,
        userSelect: 'none',
      }}
    >
      {/* The mark stands in for the wordmark that used to be here. It inherits
          `color`, so it needs no per-theme variant; the name it replaces lives
          on the tooltip and the accessible label rather than being lost. */}
      <Tooltip title="AA-SI Workbench — NOAA Fisheries" placement="bottom-start">
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            px: 1,
            mr: 0.5,
            color: theme.aa.color.text.secondary,
            transition: 'color .12s',
            '&:hover': { color: theme.aa.color.accent.main },
            '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
          }}
        >
          <NoaaMark size={19} />
        </Box>
      </Tooltip>

      {menus.map((menu) => {
        const isOpen = openId === menu.id;
        return (
          <Box key={menu.id}>
            <Button
              ref={(el) => {
                buttonRefs.current[menu.id] = el;
              }}
              onClick={() => toggle(menu.id)}
              onMouseEnter={() => handleEnter(menu.id)}
              disableRipple
              sx={{
                minWidth: 0,
                px: 1,
                height: 24,
                fontSize: 13,
                fontWeight: 400,
                lineHeight: 1,
                color: theme.aa.color.text.primary,
                backgroundColor: isOpen
                  ? theme.aa.color.bg.hover
                  : 'transparent',
                '&:hover': { backgroundColor: theme.aa.color.bg.hover },
              }}
            >
              {menu.label}
            </Button>

            <Menu
              open={isOpen}
              anchorEl={buttonRefs.current[menu.id] ?? undefined}
              onClose={close}
              disableScrollLock
              anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
              transformOrigin={{ vertical: 'top', horizontal: 'left' }}
              MenuListProps={{ dense: true }}
            >
              {menu.items.map((item) =>
                item.divider ? (
                  <Divider key={item.id} sx={{ my: 0.5 }} />
                ) : (
                  <MenuItem
                    key={item.id}
                    disabled={item.disabled}
                    onClick={() => dispatch(item)}
                    title={item.panelId ? undefined : item.label}
                    {...(isCheckable(item)
                      ? { role: 'menuitemradio', 'aria-checked': isChecked(item) }
                      : {})}
                  >
                    {/* A tick column, present on every row in a menu that has
                        any checkable item, so labels stay aligned. */}
                    {menuHasChecks(menu.items) && (
                      <Box
                        component="span"
                        aria-hidden
                        sx={{
                          width: 16,
                          flexShrink: 0,
                          display: 'flex',
                          alignItems: 'center',
                          color: theme.aa.color.accent.main,
                        }}
                      >
                        {isChecked(item) && <CheckOutlined sx={{ fontSize: 14 }} />}
                      </Box>
                    )}
                    <Box
                      component="span"
                      sx={{ flex: 1, whiteSpace: 'nowrap', pr: 3 }}
                    >
                      {item.label}
                    </Box>
                    {item.shortcut && (
                      <Typography
                        component="span"
                        sx={{
                          fontSize: 11.5,
                          color: theme.aa.color.text.muted,
                          fontVariantNumeric: 'tabular-nums',
                        }}
                      >
                        {item.shortcut}
                      </Typography>
                    )}
                  </MenuItem>
                ),
              )}
            </Menu>
          </Box>
        );
      })}
    </Box>
  );
}
