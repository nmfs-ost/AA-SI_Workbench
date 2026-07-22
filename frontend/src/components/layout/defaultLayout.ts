import type { DockviewApi } from 'dockview';

import type { LayoutVariant } from '../../types';

/**
 * The landscape arrangement — the default, and what most workstations get.
 *
 *   ┌──┬──────────┬───────────────────────┬──────────┬──┐
 *   │A │  LEFT    │  CENTER: Pipelines and│  RIGHT   │I │
 *   │  │          │  any open files, as   │          │  │
 *   │  │          │  tabs                 │          │  │
 *   │  │          ├───────────────────────┤          │  │
 *   │  │          │   BOTTOM  (tabs)      │          │  │
 *   └──┴──────────┴───────────────────────┴──────────┴──┘
 *
 * The icon strips (A, I) on the outer edges are shell chrome rather than
 * Dockview regions — see SideBar.tsx. Neither side dock has visible tabs; the
 * strips are their tab strips.
 *
 * Panels added with `direction: 'within'` join the referenced panel's group and
 * therefore render as tabs. Pipelines is added first and every other region is
 * positioned relative to it — it is the anchor, not because it is special but
 * because something has to be placed before anything can be placed beside it.
 * All sizes are initial hints; the user can resize and re-dock freely.
 *
 * See `buildVerticalLayout` below for the counterpart that runs the tools dock
 * the full width instead. Both are offered under View; neither is a mode the
 * rest of the app knows about — each just arranges the same panels differently
 * and then gets out of the way.
 */
export function buildHorizontalLayout(api: DockviewApi): void {
  api.clear();

  // Center — added first as the anchor for the other regions. It is one group:
  // Pipelines, plus every file the user opens, arriving as tabs the way
  // documents do in any editor.
  api.addPanel({ id: 'pipelines', component: 'pipelines', title: 'Pipelines' });
  // Recipes sits directly beside Pipelines: the same centre group, one tab
  // over. Deliberately a tab and not a split — the two are peer answers to
  // "run a workflow", and the user picks one at a time the way they pick a
  // document. Added immediately after the anchor so Pipelines keeps the
  // fronted position on a fresh install.
  api.addPanel({
    id: 'recipes',
    component: 'recipes',
    title: 'Recipes',
    position: { referencePanel: 'pipelines', direction: 'within' },
  });
  api.getPanel('pipelines')?.api.setActive();

  // Left sidebar — data sources. These four are added as one group, but that
  // group renders without a tab strip: `syncSidebarChrome` in
  // useLayoutController hides the header and locks it against drops, because
  // the icon strip beside it already names and switches between them.
  api.addPanel({
    id: 'ncei',
    component: 'ncei',
    title: 'NCEI',
    position: { referencePanel: 'pipelines', direction: 'left' },
    initialWidth: 360,
  });
  api.addPanel({
    id: 'files',
    component: 'files',
    title: 'Files',
    position: { referencePanel: 'ncei', direction: 'within' },
  });
  api.addPanel({
    id: 'derived',
    component: 'derived',
    title: 'Derived',
    position: { referencePanel: 'ncei', direction: 'within' },
  });
  api.addPanel({
    id: 'omao',
    component: 'omao',
    title: 'OMAO',
    position: { referencePanel: 'ncei', direction: 'within' },
  });

  // Right sidebar.
  api.addPanel({
    id: 'metadata',
    component: 'metadata',
    title: 'Metadata',
    position: { referencePanel: 'pipelines', direction: 'right' },
    initialWidth: 300,
  });
  api.addPanel({
    id: 'configuration',
    component: 'configuration',
    title: 'Configuration',
    position: { referencePanel: 'metadata', direction: 'within' },
  });
  api.addPanel({
    id: 'calibration',
    component: 'calibration',
    title: 'Calibration',
    position: { referencePanel: 'metadata', direction: 'within' },
  });
  api.addPanel({
    id: 'processingQueue',
    component: 'processingQueue',
    title: 'Processing Queue',
    position: { referencePanel: 'metadata', direction: 'within' },
  });

  /* Tools dock — added last, so it splits the centre's cell and sits beneath
     that column only, with the side docks running past it to the floor. The
     vertical layout adds this same block first and gets a full-width band; see
     `buildVerticalLayout`. */
  api.addPanel({
    id: 'terminal',
    component: 'terminal',
    title: 'Terminal',
    position: { referencePanel: 'pipelines', direction: 'below' },
    initialHeight: 260,
  });
  api.addPanel({
    id: 'log',
    component: 'log',
    title: 'Log',
    position: { referencePanel: 'terminal', direction: 'within' },
  });
  api.addPanel({
    id: 'progress',
    component: 'progress',
    title: 'Progress',
    position: { referencePanel: 'terminal', direction: 'within' },
  });
  api.addPanel({
    id: 'console',
    component: 'console',
    title: 'Console',
    position: { referencePanel: 'terminal', direction: 'within' },
  });
  api.addPanel({
    id: 'map',
    component: 'map',
    title: 'Map',
    position: { referencePanel: 'terminal', direction: 'within' },
  });

  // Surface the primary tab in each dock.
  api.getPanel('terminal')?.api.setActive();
  api.getPanel('metadata')?.api.setActive();
  api.getPanel('ncei')?.api.setActive();
}

/**
 * The full-width-tools arrangement.
 *
 *   ┌──┬──────────┬───────────────────────┬──────────┬──┐
 *   │A │  LEFT    │  CENTER: Pipelines and│  RIGHT   │I │
 *   │  │          │  any open files       │          │  │
 *   │  ├──────────┴───────────────────────┴──────────┤  │
 *   │  │              BOTTOM  (full width)           │  │
 *   └──┴─────────────────────────────────────────────┴──┘
 *
 * Identical to the landscape arrangement in every respect but one: the tools
 * dock runs the whole width beneath the other three, so the left and right
 * docks stop at its top edge instead of running past it to the floor.
 *
 * The only thing that produces that is the *order* the regions are added in.
 * Dockview's grid is nested splits, and `direction: 'below'` splits the cell
 * holding the referenced panel — so adding the tools dock after the sides puts
 * it under the centre column alone (the landscape layout), and adding it first,
 * while the centre still owns the entire grid, splits the root and leaves it
 * spanning everything the sides are later carved out of. Same panels, same
 * anchors, same sizes; one reordering.
 *
 * This is what a terminal wants. A shell, a log and a map are all read in long
 * lines, and under the centre column alone each of them is reading through a
 * slot a third of the monitor wide while two file trees sit either side of it
 * with width they aren't using.
 *
 * (This replaced a portrait band-stack — four full-width regions, nothing split
 * sideways, aimed at a 1080px-wide monitor turned on its end. No panel arrangement
 * targets that shape now.)
 *
 * The icon strips stay on the outer edges in both layouts. They are shell chrome
 * outside Dockview, they still drive their docks, and moving them per-layout
 * would cost the one piece of navigation that never moves.
 */
export function buildVerticalLayout(api: DockviewApi): void {
  api.clear();

  // Centre first, as the anchor. Everything else is placed relative to it.
  api.addPanel({ id: 'pipelines', component: 'pipelines', title: 'Pipelines' });
  // Recipes beside Pipelines, same as the horizontal builder.
  api.addPanel({
    id: 'recipes',
    component: 'recipes',
    title: 'Recipes',
    position: { referencePanel: 'pipelines', direction: 'within' },
  });
  api.getPanel('pipelines')?.api.setActive();

  /* Tools dock, added *before* the side docks — this is the whole difference
     between this layout and the landscape one. Right now the centre occupies
     the entire grid, so splitting it downwards yields a band the full width of
     the window; the sides are then carved out of the top cell and leave it
     alone. Move this block below them and the band narrows to the centre
     column. */
  api.addPanel({
    id: 'terminal',
    component: 'terminal',
    title: 'Terminal',
    position: { referencePanel: 'pipelines', direction: 'below' },
    initialHeight: 280,
  });
  for (const [id, title] of [
    ['log', 'Log'],
    ['progress', 'Progress'],
    ['console', 'Console'],
    ['map', 'Map'],
  ] as const) {
    api.addPanel({
      id,
      component: id,
      title,
      position: { referencePanel: 'terminal', direction: 'within' },
    });
  }

  // Left dock — data sources. Splits the top cell, so it ends where the tools
  // dock begins.
  api.addPanel({
    id: 'ncei',
    component: 'ncei',
    title: 'NCEI',
    position: { referencePanel: 'pipelines', direction: 'left' },
    initialWidth: 360,
  });
  for (const [id, title] of [
    ['files', 'Files'],
    ['derived', 'Derived'],
    ['omao', 'OMAO'],
  ] as const) {
    api.addPanel({
      id,
      component: id,
      title,
      position: { referencePanel: 'ncei', direction: 'within' },
    });
  }

  // Right dock — details about the current selection.
  api.addPanel({
    id: 'metadata',
    component: 'metadata',
    title: 'Metadata',
    position: { referencePanel: 'pipelines', direction: 'right' },
    initialWidth: 300,
  });
  for (const [id, title] of [
    ['configuration', 'Configuration'],
    ['calibration', 'Calibration'],
    ['processingQueue', 'Processing Queue'],
  ] as const) {
    api.addPanel({
      id,
      component: id,
      title,
      position: { referencePanel: 'metadata', direction: 'within' },
    });
  }

  api.getPanel('terminal')?.api.setActive();
  api.getPanel('metadata')?.api.setActive();
  api.getPanel('ncei')?.api.setActive();
}

/** Build whichever arrangement the user has chosen. */
export function buildLayout(api: DockviewApi, variant: LayoutVariant): void {
  if (variant === 'vertical') buildVerticalLayout(api);
  else buildHorizontalLayout(api);
}
