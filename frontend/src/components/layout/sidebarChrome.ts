import type { PanelRegion } from '../../types';

/** The three edges that carry a docked panel group and an icon strip beside it. */
export type DockSide = 'left' | 'right' | 'bottom';

export const DOCK_SIDES: readonly DockSide[] = ['left', 'right', 'bottom'];

/**
 * True for a region that lives against an edge rather than in the centre.
 *
 * The bottom joined the two sides once its dock got a strip of its own. Before
 * that it was deliberately excluded, because a dock whose only labels are its
 * tabs must keep those tabs; now that its icons live outside Dockview, hiding
 * its tab strip and collapsing it whole are both safe, and everything keyed off
 * this predicate — chrome-less groups, per-side active tracking, the
 * click-to-collapse toggle — starts working for it with no code of its own.
 *
 * The centre is the one region that can never be here. It holds the open files,
 * whose tabs are the only way to tell them apart.
 */
export function isDockSide(region: PanelRegion | undefined): region is DockSide {
  return region === 'left' || region === 'right' || region === 'bottom';
}

/**
 * Which edge a dock group belongs to, or null if it isn't a sidebar.
 *
 * Every edge dock renders without a tab strip — the icon strip on the outside
 * of each already names its panels, marks the active one, and switches between
 * them, so tabs say it twice. This decides which groups get that treatment.
 *
 * The test is deliberately "every", not "any". A group holding only left-region
 * panels is the sources sidebar, one holding only right-region panels is the
 * inspector, one holding only bottom-region panels is the tools dock; a *mixed*
 * group is something the user assembled by dragging, and it
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
