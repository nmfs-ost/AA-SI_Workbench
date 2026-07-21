import type { PanelRegion } from '../../types';

/**
 * True when every panel in a group is a left-region data source.
 *
 * The sources sidebar renders without a tab strip — the activity bar beside it
 * already names and switches between the sources, so tabs say it twice. This
 * predicate decides which group that treatment applies to.
 *
 * The test is deliberately "every", not "any". A group holding only sources is
 * the sidebar; a *mixed* group is something the user assembled by dragging, and
 * it keeps its tabs — otherwise a panel dropped in beside a source would become
 * invisible with no way back to it. Getting this backwards in the permissive
 * direction would strip the tabs from the *centre* group, which is where every
 * open file lives.
 *
 * The region lookup is a parameter and the group is typed structurally, so this
 * needs neither the panel registry nor a live Dockview instance — the registry
 * eagerly imports every panel component (including xterm), which is a heavy and
 * browser-only dependency to drag in for four lines of logic.
 */
export function isSourceGroup(
  group: { panels: readonly { id: string }[] },
  regionOf: (id: string) => PanelRegion | undefined,
): boolean {
  return (
    group.panels.length > 0 && group.panels.every((panel) => regionOf(panel.id) === 'left')
  );
}
