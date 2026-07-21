import type { PanelRegion } from '../../types';

/** The two edges that carry a docked sidebar and an icon strip beside it. */
export type DockSide = 'left' | 'right';

export const DOCK_SIDES: readonly DockSide[] = ['left', 'right'];

/** True for a region that is docked to an edge rather than centre or bottom. */
export function isDockSide(region: PanelRegion | undefined): region is DockSide {
  return region === 'left' || region === 'right';
}

/**
 * Which edge a dock group belongs to, or null if it isn't a sidebar.
 *
 * Both sidebars render without a tab strip — the icon strip on the outside of
 * each already names its panels, marks the active one, and switches between
 * them, so tabs say it twice. This decides which groups get that treatment.
 *
 * The test is deliberately "every", not "any". A group holding only left-region
 * panels is the sources sidebar and one holding only right-region panels is the
 * inspector; a *mixed* group is something the user assembled by dragging, and it
 * keeps its tabs — otherwise a panel dropped in beside a source would become
 * invisible with no way back to it. Getting this wrong in the permissive
 * direction would strip the tabs from the *centre* group, which is where every
 * open file lives.
 *
 * The region lookup is a parameter and the group is typed structurally, so this
 * needs neither the panel registry nor a live Dockview instance — the registry
 * eagerly imports every panel component (including xterm), which is a heavy and
 * browser-only dependency to drag in for a few lines of logic.
 */
export function dockSideOfGroup(
  group: { panels: readonly { id: string }[] },
  regionOf: (id: string) => PanelRegion | undefined,
): DockSide | null {
  if (group.panels.length === 0) return null;
  const first = regionOf(group.panels[0].id);
  if (!isDockSide(first)) return null;
  return group.panels.every((panel) => regionOf(panel.id) === first) ? first : null;
}
