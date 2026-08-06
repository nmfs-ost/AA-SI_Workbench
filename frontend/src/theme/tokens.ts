import type { ThemeBase, ThemeMode } from '../types';

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

    /**
     * A decorative band in the chrome, painted under the menu bar.
     *
     * The one token here that is not a colour: it is whatever CSS `background`
     * accepts, which for four of the five palettes is the keyword
     * `transparent` and for `pride` is a gradient. It exists because a rainbow
     * cannot be expressed as a palette entry — every other slot is a single
     * value used for text or fill, and a gradient in any of them would fail
     * the contrast rules those slots are held to, correctly.
     *
     * Defaulting to `transparent` rather than to the accent is deliberate: the
     * band renders in every theme, and any visible default would have changed
     * the appearance of four palettes to introduce a fifth.
     */
    decoration: {
      band: 'transparent',
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

  /* Fixed extents for the chrome regions (px). */
  size: {
    menuBar: 32,
    statusBar: 24,
    /* Width of a vertical icon strip — and therefore the width of the column
       the menu bar's mark has to sit in the middle of. It lived in
       `SideBar.tsx` as a module constant until the mark needed to agree with
       it: two files each holding their own 44 is exactly how the two drift a
       pixel apart and nobody can see why the logo looks off-centre. */
    sideStrip: 44,
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

    /* No band. See the dark palette's note on this token. */
    decoration: {
      band: 'transparent',
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

/**
 * The NOAA palette.
 *
 * The agency emblem is three colours — Pantone 287 (#003087), Process Blue
 * (#0085CA) and white — so this is a *dark* theme whose neutrals are navy
 * rather than slate. It is the dark theme's layering rule with the greys
 * replaced: deepest chrome at the back, panel bodies lifting towards the
 * viewer, one accent.
 *
 * Both brand blues appear literally, but not in the roles you would first
 * reach for. #003087 is `bg.tabActive` — the fronted tab in the focused group,
 * which is where the eye goes anyway, and a background is the one place a
 * mid-dark blue can be exactly itself. The accent is #29a0e0: Process Blue's
 * hue (200°) lightened, because #0085CA carries only 3.7:1 against these
 * panels and the accent is used as text and as a 2px marker, not just as fill.
 * That is the same substitution the light palette already makes when it swaps
 * #4d8df0 for #1d64cd — same rôle, same hue, the contrast the job needs.
 *
 * Syntax keeps the six-hue rule and stays desaturated, warmed slightly so it
 * doesn't disappear into a blue field.
 */
const noaa: AaTokens = {
  color: {
    bg: {
      base: '#000d26', // strips + status bar — deepest
      chrome: '#001438', // menu bar
      editor: '#001a45', // docking surface
      panel: '#002055', // panel body surfaces
      tabActive: '#003087', // Pantone 287 — the brand blue, most lifted surface
      tabActiveUnfocused: '#002662',
      tabInactive: '#001438',
      elevated: '#002a70', // menus, dialogs, popovers
      hover: '#003c90',
      selected: 'rgba(41, 160, 224, 0.20)',
    },

    border: {
      subtle: '#0a3a80',
      strong: '#00081c',
    },

    text: {
      primary: '#e8f1fa',
      secondary: '#a9c4e0',
      muted: '#7593b8',
      disabled: '#5a7699',
    },

    accent: {
      main: '#29a0e0',
      hover: '#4db3ea',
      soft: 'rgba(41, 160, 224, 0.20)',
      muted: 'rgba(41, 160, 224, 0.48)',
    },

    syntax: {
      comment: '#6b87ab',
      string: '#7fd4a8',
      keyword: '#64b6f7',
      number: '#f0b866',
      entity: '#c3a8f0',
      reference: '#56cfd8',
    },

    /* No band. See the dark palette's note on this token. */
    decoration: {
      band: 'transparent',
    },

    scrollbar: {
      thumb: '#0e4590',
      thumbHover: '#1a5aad',
    },

    terminalAnsi: {
      white: '#cadcf0',
      brightWhite: '#ffffff',
    },

    status: {
      success: '#4ecd63',
      warning: '#e0a94a',
      error: '#ff6b62',
      info: '#29a0e0',
    },
  },

  font: dark.font,
  radius: dark.radius,
  size: dark.size,
};

/**
 * The spring palette.
 *
 * Light-based, and green/yellow the way a season is rather than the way a
 * highlighter is. The temptation with "green and yellow" is to make the accent
 * yellow, which cannot work: yellow's whole character is high luminance, so any
 * yellow legible as text on white has stopped being yellow. The two colours are
 * therefore given different jobs. Green carries the accent — a leaf green that
 * clears 4.5:1 against the tinted strips as well as against white — the strips
 * are the surface that catches this out, not the panels.
 * Yellow lives where a warm hue is free: the entire neutral ramp is tinted
 * towards it, so chrome, strips and inactive tabs read as sunlight on paper
 * rather than grey, and it takes the `string` slot in the editor, where a deep
 * gold is both legible and the most common token on screen.
 *
 * The light theme's layering rule is unchanged: chrome is the most tinted
 * surface, panel bodies go to white, and what you read from has the most
 * contrast with its neighbours.
 */
const spring: AaTokens = {
  color: {
    bg: {
      base: '#e8ecd5', // strips + status bar — most tinted
      chrome: '#f1f4e3', // menu bar
      editor: '#f8faf0', // docking surface
      panel: '#ffffff', // panel body surfaces
      tabActive: '#ffffff',
      tabActiveUnfocused: '#f4f7ea',
      tabInactive: '#e8ecd5',
      elevated: '#ffffff', // menus, dialogs, popovers
      hover: '#dfe5c8',
      selected: 'rgba(55, 115, 41, 0.15)',
    },

    border: {
      subtle: '#dce3c4',
      strong: '#bcc79c',
    },

    text: {
      primary: '#1c2417',
      secondary: '#46523c',
      muted: '#6b7862',
      disabled: '#9aa691',
    },

    accent: {
      main: '#377329',
      hover: '#2b5c20',
      soft: 'rgba(55, 115, 41, 0.15)',
      muted: 'rgba(55, 115, 41, 0.45)',
    },

    syntax: {
      comment: '#79826d',
      string: '#8c6a00', // the deep gold — yellow where it can still be read
      keyword: '#2b5c20',
      number: '#a34b1a',
      entity: '#6a4a9c',
      reference: '#1a6a76',
    },

    /* No band. See the dark palette's note on this token. */
    decoration: {
      band: 'transparent',
    },

    scrollbar: {
      thumb: '#c8d2b3',
      thumbHover: '#b0bd97',
    },

    terminalAnsi: {
      white: '#46523c',
      brightWhite: '#1c2417',
    },

    status: {
      success: '#2d7a1f',
      warning: '#8a6100',
      error: '#b83228',
      info: '#377329',
    },
  },

  font: dark.font,
  radius: dark.radius,
  size: dark.size,
};


/**
 * The pride palette.
 *
 * Six saturated hues and a legible instrument are not obviously compatible, so
 * the colours are given jobs rather than sprinkled. Three rules do the work.
 *
 * **The neutrals stay neutral.** The background ramp is a near-black carrying
 * only a trace of violet — enough that it is not the dark theme's slate, not
 * enough to compete. With six hues in play on an open file, a tinted chrome
 * would leave nothing on screen that is *not* colour, and the eye needs
 * somewhere to rest.
 *
 * **The flag lives in the editor.** The six syntax slots have always been the
 * one place this UI admits more than one hue — "the colours *are* the
 * information", as the dark palette's note puts it — so they carry five of the
 * six stripes directly, lightened for a dark background the same way the NOAA
 * palette lightens Process Blue. Red is the sixth, and it is deliberately not
 * a syntax slot: red already means `status.error` everywhere in this
 * application, and a red that means "string literal" in one panel and
 * "the run failed" in another is worse than a five-stripe editor.
 *
 * **The rainbow itself is a band, not a fill.** A gradient cannot be a token
 * that text is drawn in — it would fail every contrast rule in `theme.test.ts`,
 * correctly — so it is `decoration.band`, two pixels under the menu bar, where
 * it is unmistakable and sits behind nothing.
 *
 * The accent is pink rather than one of the six. It has to clear 4.5:1 against
 * three surfaces *and* be distinguishable from all six stripes at a glance,
 * since it marks focus and selection while they are on screen; a seventh hue is
 * the honest answer, and pink is the one the flag's own family suggests.
 */
const pride: AaTokens = {
  color: {
    bg: {
      base: '#16121c', // strips + status bar — deepest
      chrome: '#1c1726', // menu bar
      editor: '#1f1a2a', // docking surface
      panel: '#241f31', // panel body surfaces
      tabActive: '#2f2840', // most lifted surface
      tabActiveUnfocused: '#282137',
      tabInactive: '#1c1726',
      elevated: '#2a2338', // menus, dialogs, popovers
      hover: '#332b45',
      selected: 'rgba(255, 111, 174, 0.18)',
    },

    border: {
      subtle: '#352c48',
      strong: '#0f0c14',
    },

    text: {
      primary: '#ece7f5',
      secondary: '#c0b4d4',
      muted: '#8f83a5',
      disabled: '#6d6382',
    },

    accent: {
      main: '#ff6fae',
      hover: '#ff92c4',
      soft: 'rgba(255, 111, 174, 0.18)',
      muted: 'rgba(255, 111, 174, 0.48)',
    },

    /* Five of the six stripes, lightened for a dark background. Red is absent
       on purpose — see the note above. */
    syntax: {
      comment: '#7d7291',
      string: '#4ade80', // green
      keyword: '#82b8ff', // blue
      number: '#ffa94d', // orange
      entity: '#c084fc', // violet
      reference: '#ffe066', // yellow
    },

    /* The flag, in the order it is flown. These are the same five hues the
       editor uses plus the red that `status.error` carries, so the band is the
       palette's own colours rather than a decoration pasted on top of it. */
    decoration: {
      band:
        'linear-gradient(90deg, #ff7a7a 0%, #ffa94d 20%, #ffe066 40%, ' +
        '#4ade80 60%, #82b8ff 80%, #c084fc 100%)',
    },

    scrollbar: {
      thumb: '#453a5c',
      thumbHover: '#584a75',
    },

    terminalAnsi: {
      white: '#cdc3dd',
      brightWhite: '#ffffff',
    },

    status: {
      success: '#5cd97e',
      warning: '#ffb454',
      error: '#ff7a7a',
      info: '#ff6fae',
    },
  },

  font: dark.font,
  radius: dark.radius,
  size: dark.size,
};

/**
 * A palette and the facts about it that aren't colours.
 *
 * `base` is what MUI, `color-scheme` and Dockview are told (see `ThemeBase`).
 * `label` is what the View menu shows — kept here so that adding a theme is one
 * object in one file rather than an object here and an entry in `menuConfig`
 * that has to be remembered. This repo has been bitten repeatedly by exactly
 * that shape of duplication.
 */
export interface PaletteDefinition {
  id: ThemeMode;
  label: string;
  base: ThemeBase;
  tokens: AaTokens;
}

export const palettes: Record<ThemeMode, PaletteDefinition> = {
  dark: { id: 'dark', label: 'Dark Theme', base: 'dark', tokens: dark },
  light: { id: 'light', label: 'Light Theme', base: 'light', tokens: light },
  noaa: { id: 'noaa', label: 'NOAA Theme', base: 'dark', tokens: noaa },
  spring: { id: 'spring', label: 'Spring Theme', base: 'light', tokens: spring },
  pride: { id: 'pride', label: 'Pride Theme', base: 'dark', tokens: pride },
};

/** Menu order. Object key order is not a contract; this is. */
export const paletteList: readonly PaletteDefinition[] = [
  palettes.dark,
  palettes.light,
  palettes.noaa,
  palettes.spring,
  palettes.pride,
];

/** The tokens for a mode. */
export function tokensFor(mode: ThemeMode): AaTokens {
  return palettes[mode].tokens;
}

/** Whether a palette behaves as light or dark, for the three consumers that
    only understand those two words. */
export function baseFor(mode: ThemeMode): ThemeBase {
  return palettes[mode].base;
}

/**
 * Narrow an unknown value to a palette id.
 *
 * Used on the persisted mode: a value written by an older or newer build (or
 * edited by hand) must not leave the shell trying to render a palette that
 * isn't there, which would throw on the first token read.
 */
export function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === 'string' && Object.hasOwn(palettes, value);
}

/**
 * The dark tokens, for the handful of places that want a palette without
 * caring which one is showing (type defaults, tests).
 */
export const tokens = dark;
