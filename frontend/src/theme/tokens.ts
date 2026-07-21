/**
 * Design tokens for AA-SI.
 *
 * A single source of truth for every colour, font and radius used in the
 * application chrome. The MUI theme (theme.ts) and the Dockview CSS variable
 * overrides (dockview-overrides.css) are both derived from these values so the
 * MUI-rendered chrome and the Dockview-rendered docking surface stay visually
 * identical.
 *
 * Direction: a quiet, dense, dark IDE. Neutral slate greys, one restrained
 * blue accent, no gradients, tight corner radii.
 */

export const tokens = {
  color: {
    /* Layered backgrounds, from deepest chrome to elevated surfaces. */
    bg: {
      base: '#16181d', // activity/status strips — the deepest layer
      chrome: '#1c1f26', // menu bar + toolbar
      editor: '#1e2127', // docking surface / central workspace
      panel: '#22262e', // panel body surfaces
      tabActive: '#2b303a', // active tab
      tabInactive: '#1c1f26', // inactive tab
      elevated: '#262b34', // menus, dialogs, popovers
      hover: '#2e343e', // hover feedback on interactive chrome
      selected: 'rgba(77, 141, 240, 0.16)', // selected row / active nav item
    },

    /* Hairline separators. `strong` reads as a seam between major regions. */
    border: {
      subtle: '#2a2f38',
      strong: '#14171c',
    },

    /* Text ramp. */
    text: {
      primary: '#d5dae2',
      secondary: '#9aa3b1',
      muted: '#6b7280',
      disabled: '#565d68',
    },

    /* The single accent. Used for focus, active affordances and drop targets. */
    accent: {
      main: '#4d8df0',
      hover: '#5f9bf5',
      soft: 'rgba(77, 141, 240, 0.16)',
    },

    /* Syntax colours for the code editor.
       Highlighting is the one place the single-accent rule has to bend: the
       colours *are* the information. They're kept heavily desaturated so an
       open Python file still reads as part of the same quiet chrome rather
       than a rainbow pasted into it. Six hues, no more. */
    syntax: {
      comment: '#5f6a78',
      string: '#a3c78d',
      keyword: '#7fa6e8',
      number: '#d8a76a',
      /* Definitions and decorators — the names a file introduces. */
      entity: '#c9b6ea',
      /* Names a file refers to: variables, keys, links. */
      reference: '#7cbdd0',
    },

    /* Semantic colours. Defined for future log levels / status; used sparingly. */
    status: {
      success: '#3fb950',
      warning: '#d9a441',
      error: '#e5534b',
      info: '#4d8df0',
    },
  },

  font: {
    /* UI text. Inter first, then a robust system stack for offline hosts. */
    ui: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
    /* Fixed-width, for the terminal / console / log surfaces. */
    mono: "'JetBrains Mono', 'SFMono-Regular', 'SF Mono', Menlo, Consolas, 'Liberation Mono', monospace",
  },

  radius: {
    sm: 3,
    md: 5,
  },

  /* Fixed heights for the chrome regions (px). */
  size: {
    menuBar: 32,
    statusBar: 24,
  },
} as const;

export type AaTokens = typeof tokens;
