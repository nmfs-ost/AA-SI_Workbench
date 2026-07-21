import type { PanelDefinition } from '../../types';

/** How a Dockview tab labels itself. */
export type TabPresentation = 'icon' | 'text';

/**
 * Whether a tab shows its registered icon or its title.
 *
 * The shell already has one navigation language: a column of icons down each
 * outer edge, where the icon *is* the label and the name lives in the tooltip.
 * The bottom dock was the one place that still spelled its panels out in words,
 * so five fixed tools (Terminal, Log, Progress, Console, Map) spent a strip of
 * text on names that never change. Icons say the same thing in a quarter of the
 * width and match the strips either side.
 *
 * The rule is *tools get icons, documents get names*, and the second half is
 * what makes it safe. An editor tab's title is the filename — the only thing
 * distinguishing it from every other editor tab — so it must stay text. Editors
 * are the registry's one `dynamic` panel, which is exactly the "this is a
 * document, not a tool" flag, so the rule reads it rather than maintaining a
 * second list that could drift from it.
 *
 * Anything the registry doesn't know is text too. A panel added at runtime has
 * no icon to fall back on, and a blank tab is worse than a wide one.
 *
 * The definition arrives as a parameter rather than being looked up here: the
 * registry eagerly imports every panel component, including xterm, which is
 * browser-only and would make this rule untestable under Node. Same reason
 * `sidebarChrome.ts` takes its region lookup as an argument.
 */
export function tabPresentation(
  definition: Pick<PanelDefinition, 'dynamic'> | undefined,
): TabPresentation {
  if (!definition) return 'text';
  return definition.dynamic === true ? 'text' : 'icon';
}
