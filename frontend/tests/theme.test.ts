import { describe, expect, it } from 'vitest';

import { cssVariablesFor } from '../src/theme/cssVariables';
import { baseFor, isThemeMode, paletteList, palettes, tokensFor } from '../src/theme/tokens';
import type { AaTokens } from '../src/theme/tokens';

/**
 * Palette invariants.
 *
 * Imports `theme/tokens` and `theme/cssVariables` directly rather than the
 * `theme/` barrel: the barrel also exports `theme.ts`, which pulls in MUI, and
 * the rule in this suite is that tests reach only for modules that are pure.
 * (See `sidebarChrome.ts` for the same pattern applied to the panel registry.)
 *
 * There are three separate things here that a person cannot check by looking:
 *
 *  1. **Shape.** `AaTokens` already makes a missing token a type error, so this
 *     only covers what the type cannot: that the *registry* is complete in both
 *     directions, and that every palette declares a base MUI can understand.
 *  2. **CSS variable parity.** Switching themes rewrites custom properties onto
 *     the document element; it never removes them. A palette that emitted a
 *     variable another one lacks would leave the previous theme's value in
 *     place after a switch — one stale colour in an otherwise repainted UI,
 *     which is close to impossible to attribute by eye.
 *  3. **Contrast.** The light palette shipped with its contrast reasoned about
 *     rather than measured, and that was recorded as a known gap. Reasoning is
 *     the part a person is worst at: #0085CA looks perfectly readable in a
 *     swatch and carries 3.7:1 on navy. These are computed.
 */

/* WCAG 2.1 relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const value = hex.replace('#', '');
  const channels = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255);
  const [r, g, b] = channels.map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(foreground: string, background: string): number {
  const a = luminance(foreground);
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Every key path in a token tree, so two palettes can be compared as sets. */
function keyPaths(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    keyPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

const ALL = paletteList;

/* Thresholds are calibrated against the two palettes that shipped first, which
   are the reference for what this UI considers readable — not against the WCAG
   AA number for every rôle. `comment` and `disabled` are deliberately quiet in
   both original palettes (dark's comment is 2.9:1), and raising them to 4.5
   here would not be a stricter test, it would be a different design. */
const MIN = {
  primary: 7,
  secondary: 4.5,
  muted: 3,
  disabled: 2,
  accent: 4.5,
  syntax: 4.5,
  comment: 2.9,
  status: 4,
  terminal: 4.5,
};

describe('palette registry', () => {
  it('has a palette for every declared mode, and no orphans', () => {
    const ids = ALL.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(ids)).toEqual(new Set(Object.keys(palettes)));
  });

  it('gives every palette a base MUI and color-scheme understand', () => {
    for (const palette of ALL) {
      expect(['light', 'dark']).toContain(palette.base);
      expect(baseFor(palette.id)).toBe(palette.base);
    }
  });

  it('gives every palette a menu label', () => {
    for (const palette of ALL) expect(palette.label.trim().length).toBeGreaterThan(0);
  });

  it('narrows only real palette ids', () => {
    for (const palette of ALL) expect(isThemeMode(palette.id)).toBe(true);
    for (const value of ['', 'Dark', 'noaa ', 'sepia', null, undefined, 7, {}]) {
      expect(isThemeMode(value)).toBe(false);
    }
  });
});

describe('token shape', () => {
  const reference = keyPaths(tokensFor('dark')).sort();

  it.each(ALL.map((p) => p.id))('%s defines exactly the dark palette tokens', (id) => {
    expect(keyPaths(tokensFor(id)).sort()).toEqual(reference);
  });

  it.each(ALL.map((p) => p.id))('%s emits the same CSS variables', (id) => {
    const reference = Object.keys(cssVariablesFor(tokensFor('dark'))).sort();
    expect(Object.keys(cssVariablesFor(tokensFor(id))).sort()).toEqual(reference);
  });

  it('flattens nested token names into kebab-cased custom properties', () => {
    const variables = cssVariablesFor(tokensFor('dark'));
    expect(variables['--aa-bg-tab-active']).toBe(tokensFor('dark').color.bg.tabActive);
    expect(variables['--aa-terminal-ansi-bright-white']).toBeDefined();
  });
});

describe('contrast', () => {
  /* The surfaces text is actually read from. `base` carries the status bar and
     the icon strips, `chrome` the menu bar, `editor` the docking surface and
     `panel` every panel body. */
  const surfaces = (t: AaTokens) => [t.color.bg.panel, t.color.bg.editor, t.color.bg.base];

  it.each(ALL.map((p) => p.id))('%s: the text ramp is readable on every surface', (id) => {
    const t = tokensFor(id);
    for (const bg of surfaces(t)) {
      expect(contrast(t.color.text.primary, bg)).toBeGreaterThanOrEqual(MIN.primary);
      expect(contrast(t.color.text.secondary, bg)).toBeGreaterThanOrEqual(MIN.secondary);
      expect(contrast(t.color.text.muted, bg)).toBeGreaterThanOrEqual(MIN.muted);
      expect(contrast(t.color.text.disabled, bg)).toBeGreaterThanOrEqual(MIN.disabled);
    }
  });

  it.each(ALL.map((p) => p.id))('%s: the accent works as text, not just as fill', (id) => {
    const t = tokensFor(id);
    /* The accent is a 2px marker in places, but it is also link text and the
       injected-parameter colour in the pipelines form, so it is held to the
       text threshold rather than the 3:1 non-text one. */
    for (const bg of surfaces(t)) {
      expect(contrast(t.color.accent.main, bg)).toBeGreaterThanOrEqual(MIN.accent);
      expect(contrast(t.color.accent.hover, bg)).toBeGreaterThanOrEqual(MIN.accent);
    }
  });

  it.each(ALL.map((p) => p.id))('%s: syntax colours are readable in the editor', (id) => {
    const t = tokensFor(id);
    const { comment, ...rest } = t.color.syntax;
    for (const value of Object.values(rest)) {
      expect(contrast(value, t.color.bg.editor)).toBeGreaterThanOrEqual(MIN.syntax);
      expect(contrast(value, t.color.bg.panel)).toBeGreaterThanOrEqual(MIN.syntax);
    }
    /* Comments recede on purpose in every palette here. */
    expect(contrast(comment, t.color.bg.editor)).toBeGreaterThanOrEqual(MIN.comment);
  });

  it.each(ALL.map((p) => p.id))('%s: syntax hues are distinguishable from each other', (id) => {
    /* Six hues that all read as "some colour" defeat the point of highlighting.
       Not a contrast requirement — just that no two slots collapsed onto the
       same value while someone was tuning them. */
    const values = Object.values(tokensFor(id).color.syntax);
    expect(new Set(values).size).toBe(values.length);
  });

  it.each(ALL.map((p) => p.id))('%s: status colours are readable on a panel', (id) => {
    const t = tokensFor(id);
    for (const value of Object.values(t.color.status)) {
      expect(contrast(value, t.color.bg.panel)).toBeGreaterThanOrEqual(MIN.status);
    }
  });

  it.each(ALL.map((p) => p.id))('%s: the terminal ANSI whites survive the panel', (id) => {
    /* This is the bug that shipped once: the terminal built its xterm palette
       from the static dark tokens and painted near-white text on a white panel.
       These two slots exist precisely because xterm's defaults assume a dark
       background, so they are the two worth asserting. */
    const t = tokensFor(id);
    for (const value of Object.values(t.color.terminalAnsi)) {
      expect(contrast(value, t.color.bg.panel)).toBeGreaterThanOrEqual(MIN.terminal);
    }
  });
});
