import type { ThemeMode } from '../types';

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

const dark = {
  color: {
    /* Layered backgrounds, from deepest chrome to elevated surfaces. */
    bg: {
      base: '#16181d', // activity/status strips — the deepest layer
      chrome: '#1c1f26', // menu bar + toolbar
      editor: '#1e2127', // docking surface / central workspace
      panel: '#22262e', // panel body surfaces
      tabActive: '#2b303a', // fronted tab in the focused group
      tabActiveUnfocused: '#23272f', // fronted tab elsewhere
      tabInactive: '#1c1f26', // tab behind another
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
      /* The fronted tab of an *unfocused* group. Present enough to answer
         "which panel is this dock showing" while the editor has focus. */
      muted: 'rgba(77, 141, 240, 0.45)',
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

    /* Scrollbar thumb. Lives here because global.css now reads every colour
       from these tokens rather than repeating hex values it can't switch. */
    scrollbar: {
      thumb: '#3a4049',
      thumbHover: '#4a515c',
    },

    /* The two ANSI slots that break when the terminal background changes.
       xterm's built-in palette assumes a dark background, so `white` and
       `brightWhite` — what a shell reaches for to make text stand out — are
       near-white and vanish on a light panel. Everything else in the ANSI set
       is dark enough to survive both. */
    terminalAnsi: {
      white: '#c8ced8',
      brightWhite: '#f0f3f7',
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

/**
 * Widen the literal types `as const` produces.
 *
 * Without this `AaTokens` would be `{ base: '#16181d', ... }` — the dark
 * palette's *values* as types — and the light palette would fail to typecheck
 * on every single colour for the crime of being a different colour. `as const`
 * is still worth keeping on the reference palette: it is what makes the shape
 * exact, so a palette that forgets a token or invents one is a type error.
 */
type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : { [K in keyof T]: Widen<T[K]> };

/** The shape every palette must satisfy. Dark is the reference. */
export type AaTokens = Widen<typeof dark>;

/**
 * The light palette.
 *
 * Not an inversion. Flipping a dark IDE's lightness gives you dark grey text on
 * mid grey, and the layering reads backwards: in the dark theme the deepest
 * chrome is *darkest* and panels lift towards the viewer, so lightening it
 * naively makes the chrome the brightest thing on screen. Here the layers run
 * the other way — chrome is the greyest surface and panel bodies go to white —
 * which keeps the same rule underneath: the surface you read from has the most
 * contrast with its neighbours.
 *
 * The accent is the same blue rôle at a different lightness. #4d8df0 carries
 * about 2.4:1 against white, so on a light background it fails as text and as a
 * 2px marker; #1d64cd is the same hue with the contrast the job needs. Syntax
 * colours are darkened for the same reason and kept equally desaturated, so an
 * open Python file still reads as part of the chrome rather than a rainbow.
 */
const light: AaTokens = {
  color: {
    bg: {
      base: '#e6e9ee', // strips + status bar — the greyest layer
      chrome: '#eff1f5', // menu bar
      editor: '#f6f7f9', // docking surface
      panel: '#ffffff', // panel body surfaces
      tabActive: '#ffffff',
      tabActiveUnfocused: '#f2f4f7',
      tabInactive: '#e6e9ee',
      elevated: '#ffffff', // menus, dialogs, popovers
      hover: '#dde1e8',
      selected: 'rgba(29, 100, 205, 0.13)',
    },

    border: {
      subtle: '#d8dce3',
      strong: '#bcc3cd',
    },

    text: {
      primary: '#1b1f27',
      secondary: '#4a5261',
      muted: '#6d7583',
      disabled: '#9aa2ae',
    },

    accent: {
      main: '#1d64cd',
      hover: '#1854ad',
      soft: 'rgba(29, 100, 205, 0.13)',
      muted: 'rgba(29, 100, 205, 0.42)',
    },

    syntax: {
      comment: '#79828f',
      string: '#3f6f33',
      keyword: '#27508f',
      number: '#8a5216',
      entity: '#5c4491',
      reference: '#1a6070',
    },

    scrollbar: {
      thumb: '#c3c9d2',
      thumbHover: '#adb4bf',
    },

    terminalAnsi: {
      white: '#4a5261',
      brightWhite: '#1b1f27',
    },

    status: {
      success: '#1a7f37',
      warning: '#8a6100',
      error: '#c0332b',
      info: '#1d64cd',
    },
  },

  font: dark.font,
  radius: dark.radius,
  size: dark.size,
};

export const palettes: Record<ThemeMode, AaTokens> = { dark, light };

/** The tokens for a mode. */
export function tokensFor(mode: ThemeMode): AaTokens {
  return palettes[mode];
}

/**
 * The dark tokens, for the handful of places that want a palette without
 * caring which one is showing (type defaults, tests).
 */
export const tokens = dark;
