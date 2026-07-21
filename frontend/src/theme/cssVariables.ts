import type { AaTokens } from './tokens';

/**
 * The bridge between the token objects and the two static stylesheets.
 *
 * `global.css` and `dockview-overrides.css` can't import TypeScript, so before
 * the themes existed they simply repeated the hex values — with a comment
 * asking whoever edited one to remember the other. That is the same class of
 * duplication that let three Dockview selectors sit dead in the overrides file
 * for months, and it makes a runtime theme switch impossible: a stylesheet
 * loaded once can't be re-rendered with different colours.
 *
 * So the stylesheets now name `var(--aa-*)` and this writes those variables
 * onto the document element. Switching themes rewrites ~30 custom properties
 * and every rule that references them repaints — including Dockview's own,
 * because its `--dv-*` variables are declared in terms of ours.
 *
 * The flattening is generic on purpose: `color.bg.tabActive` becomes
 * `--aa-bg-tab-active` by rule, so a token added to the palette is exposed to
 * CSS with no second edit and no chance of the two drifting.
 */

const kebab = (value: string): string =>
  value.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

export function cssVariablesFor(tokens: AaTokens): Record<string, string> {
  const variables: Record<string, string> = {};
  for (const [group, entries] of Object.entries(tokens.color)) {
    for (const [name, value] of Object.entries(entries)) {
      variables[`--aa-${kebab(group)}-${kebab(name)}`] = value;
    }
  }
  variables['--aa-font-ui'] = tokens.font.ui;
  variables['--aa-font-mono'] = tokens.font.mono;
  return variables;
}

/** Apply a palette to the document. Returns nothing; this is a side effect. */
export function applyCssVariables(tokens: AaTokens): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(cssVariablesFor(tokens))) {
    root.style.setProperty(name, value);
  }
}
