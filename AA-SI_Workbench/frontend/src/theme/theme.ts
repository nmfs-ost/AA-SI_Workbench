import { createTheme } from '@mui/material/styles';
import { tokens, type AaTokens } from './tokens';

/**
 * Expose the raw AA-SI tokens on the MUI theme as `theme.aa` so any component
 * can read the exact chrome colours via `useTheme()` without importing tokens
 * directly. This keeps colour usage centralised and themeable.
 */
declare module '@mui/material/styles' {
  interface Theme {
    aa: AaTokens;
  }
  interface ThemeOptions {
    aa?: AaTokens;
  }
}

const { color, font, radius } = tokens;

export const theme = createTheme({
  aa: tokens,

  palette: {
    mode: 'dark',
    primary: {
      main: color.accent.main,
      dark: color.accent.main,
      light: color.accent.hover,
      contrastText: '#ffffff',
    },
    error: { main: color.status.error },
    warning: { main: color.status.warning },
    success: { main: color.status.success },
    info: { main: color.status.info },
    background: {
      default: color.bg.editor,
      paper: color.bg.elevated,
    },
    text: {
      primary: color.text.primary,
      secondary: color.text.secondary,
      disabled: color.text.disabled,
    },
    divider: color.border.subtle,
  },

  shape: {
    borderRadius: radius.sm,
  },

  typography: {
    fontFamily: font.ui,
    // IDE density: a 13px base with tight line heights.
    fontSize: 13,
    htmlFontSize: 16,
    button: {
      textTransform: 'none',
      fontWeight: 500,
      fontSize: 13,
    },
    body2: {
      fontSize: 13,
      lineHeight: 1.5,
    },
    caption: {
      fontSize: 12,
      color: color.text.secondary,
    },
  },

  components: {
    // Menus / popovers — square-ish, subtle border, no heavy elevation shadow.
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiMenu: {
      defaultProps: {
        transitionDuration: 90,
      },
      styleOverrides: {
        paper: {
          backgroundColor: color.bg.elevated,
          border: `1px solid ${color.border.subtle}`,
          borderRadius: radius.md,
          marginTop: 2,
          minWidth: 200,
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
        },
        list: {
          paddingTop: 4,
          paddingBottom: 4,
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontSize: 13,
          minHeight: 30,
          paddingTop: 4,
          paddingBottom: 4,
          gap: 10,
          '&:hover': {
            backgroundColor: color.bg.hover,
          },
          '&.Mui-selected': {
            backgroundColor: color.bg.selected,
          },
          '&.Mui-disabled': {
            opacity: 1,
            color: color.text.disabled,
          },
        },
      },
    },
    MuiListItemIcon: {
      styleOverrides: {
        root: {
          minWidth: 0,
          color: 'inherit',
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: color.border.subtle,
        },
      },
    },
    MuiIconButton: {
      defaultProps: {
        size: 'small',
        disableRipple: false,
      },
      styleOverrides: {
        root: {
          color: color.text.secondary,
          borderRadius: radius.sm,
          '&:hover': {
            backgroundColor: color.bg.hover,
            color: color.text.primary,
          },
          '&.Mui-disabled': {
            color: color.text.disabled,
          },
        },
      },
    },
    MuiButton: {
      defaultProps: {
        disableElevation: true,
      },
      styleOverrides: {
        root: {
          borderRadius: radius.sm,
          minWidth: 0,
        },
      },
    },
    MuiTooltip: {
      defaultProps: {
        enterDelay: 500,
        enterNextDelay: 300,
      },
      styleOverrides: {
        tooltip: {
          backgroundColor: color.bg.base,
          border: `1px solid ${color.border.subtle}`,
          color: color.text.primary,
          fontSize: 12,
          fontWeight: 400,
          padding: '4px 8px',
          borderRadius: radius.sm,
        },
        arrow: {
          color: color.bg.base,
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: {
          minHeight: 32,
        },
        indicator: {
          height: 2,
          backgroundColor: color.accent.main,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          minHeight: 32,
          fontSize: 12.5,
          fontWeight: 500,
          padding: '0 12px',
        },
      },
    },
    MuiDialog: {
      styleOverrides: {
        paper: {
          backgroundColor: color.bg.elevated,
          border: `1px solid ${color.border.subtle}`,
          backgroundImage: 'none',
        },
      },
    },
  },
});

export type AppTheme = typeof theme;
