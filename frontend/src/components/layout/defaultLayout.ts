import type { DockviewApi } from 'dockview';

import type { LayoutVariant } from '../../types';

/**
 * The landscape arrangement — the default, and what most workstations get.
 *
 *   ┌──┬──────────┬───────────────────────┬──────────┐
 *   │A │  LEFT    │  CENTER: Pipelines and│  RIGHT   │
 *   │C │          │  any open files, as   │ (tabs)   │
 *   │T │          │  tabs                 │          │
 *   │  │          ├───────────────────────┤          │
 *   │  │          │   BOTTOM  (tabs)      │          │
 *   └──┴──────────┴───────────────────────┴──────────┘
 *
 * The activity bar (A) on the far left is shell chrome rather than a Dockview
 * region — see ActivityBar.tsx. The LEFT dock has no visible tabs; the activity
 * bar is its tab strip.
 *
 * Panels added with `direction: 'within'` join the referenced panel's group and
 * therefore render as tabs. Pipelines is added first and every other region is
 * positioned relative to it — it is the anchor, not because it is special but
 * because something has to be placed before anything can be placed beside it.
 * All sizes are initial hints; the user can resize and re-dock freely.
 *
 * See `buildVerticalLayout` below for the portrait counterpart. Both are offered
 * under View; neither is a mode the rest of the app knows about — each just
 * arranges the same panels differently and then gets out of the way.
 */
export function buildHorizontalLayout(api: DockviewApi): void {
  api.clear();

  // Center — added first as the anchor for the other regions. It is one group:
  // Pipelines, plus every file the user opens, arriving as tabs the way
  // documents do in any editor.
  api.addPanel({ id: 'pipelines', component: 'pipelines', title: 'Pipelines' });

  // Left sidebar — data sources. These four are added as one group, but that
  // group renders without a tab strip: `syncSidebarChrome` in
  // useLayoutController hides the header and locks it against drops, because
  // the activity bar beside it already names and switches between them.
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

  // Bottom dock — sits beneath the centre.
  api.addPanel({
    id: 'terminal',
    component: 'terminal',
    title: 'Terminal',
    position: { referencePanel: 'pipelines', direction: 'below' },
    initialHeight: 200,
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
 * The portrait arrangement: four full-width bands, stacked.
 *
 *   ┌──┬─────────────────────────┐
 *   │A │  SOURCES                │  NCEI · Files · Derived · OMAO
 *   │C ├─────────────────────────┤
 *   │T │  CENTER                 │  Pipelines · open files
 *   │  │                         │
 *   │  ├─────────────────────────┤
 *   │  │  INSPECTOR              │  Metadata · Configuration · Calibration
 *   │  ├─────────────────────────┤
 *   │  │  TOOLS                  │  Terminal · Log · Progress · Console · Map
 *   └──┴─────────────────────────┘
 *
 * **Nothing is ever split side by side.** That is the whole idea. A portrait
 * monitor is typically 1080–1200px wide, and the horizontal layout spends ~700
 * of them on the activity bar plus two sidebars before the centre gets any —
 * which leaves an echogram path, a command preview, and a file tree all fighting
 * over what's left. Height is the abundant resource here, so every region takes
 * the full width and pays in height instead.
 *
 * The band order follows the work: choose data, work on it, inspect it, watch it
 * run. That is the same left-to-right order the horizontal layout reads in, so
 * switching between monitors doesn't mean relearning where anything lives.
 *
 * The activity bar stays a vertical strip on the far left in both layouts. It is
 * shell chrome outside Dockview, it still drives the sources band, and moving it
 * per-layout would cost the one piece of navigation that never moves.
 */
export function buildVerticalLayout(api: DockviewApi): void {
  api.clear();

  // Center first, as the anchor. Everything else is placed relative to it.
  api.addPanel({ id: 'pipelines', component: 'pipelines', title: 'Pipelines' });

  // Sources band, above. Tall enough for a file listing to be worth reading —
  // a 150px tree is a scrollbar with a few rows attached.
  api.addPanel({
    id: 'ncei',
    component: 'ncei',
    title: 'NCEI',
    position: { referencePanel: 'pipelines', direction: 'above' },
    initialHeight: 320,
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

  // Inspector band, below the centre: what the selection *is*, and how the
  // pipeline is configured.
  api.addPanel({
    id: 'metadata',
    component: 'metadata',
    title: 'Metadata',
    position: { referencePanel: 'pipelines', direction: 'below' },
    initialHeight: 260,
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

  // Tools band, at the foot — where output appears, so it reads last.
  api.addPanel({
    id: 'terminal',
    component: 'terminal',
    title: 'Terminal',
    position: { referencePanel: 'metadata', direction: 'below' },
    initialHeight: 240,
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

  api.getPanel('terminal')?.api.setActive();
  api.getPanel('metadata')?.api.setActive();
  api.getPanel('ncei')?.api.setActive();
}

/** Build whichever arrangement the user has chosen. */
export function buildLayout(api: DockviewApi, variant: LayoutVariant): void {
  if (variant === 'vertical') buildVerticalLayout(api);
  else buildHorizontalLayout(api);
}
