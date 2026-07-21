import { useRef, useState } from 'react';
import {
  Box,
  Button,
  Menu,
  MenuItem,
  Divider,
  Typography,
  useTheme,
} from '@mui/material';
import { CheckOutlined } from '@mui/icons-material';

import type { MenuItemDefinition } from '../../types';
import { useLayout } from '../../context/LayoutContext';
import { openDialog } from '../../state/dialogs';
import { saveActiveDoc } from '../../state/editors';
import { menus } from './menuConfig';

/** True when any row in this menu carries a tick, so all its rows get the column. */
function menuHasChecks(items: MenuItemDefinition[]): boolean {
  return items.some((item) => item.layoutVariant !== undefined);
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
      <Typography
        sx={{
          fontSize: 12.5,
          fontWeight: 700,
          letterSpacing: 0.6,
          color: theme.aa.color.text.secondary,
          px: 1,
          mr: 0.5,
        }}
      >
        AA-SI
      </Typography>

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
                    {...(item.layoutVariant
                      ? {
                          role: 'menuitemradio',
                          'aria-checked': item.layoutVariant === layoutVariant,
                        }
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
                        {item.layoutVariant === layoutVariant && (
                          <CheckOutlined sx={{ fontSize: 14 }} />
                        )}
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
