import type { DockviewApi } from 'dockview';

/**
 * Builds the initial IDE arrangement programmatically.
 *
 *   ┌──────────┬───────────────────────┬──────────┐
 *   │  LEFT    │       WORKSPACE        │  RIGHT   │
 *   │ (tabs)   ├───────────────────────┤ (tabs)   │
 *   │          │   BOTTOM  (tabs)       │          │
 *   └──────────┴───────────────────────┴──────────┘
 *
 * Panels added with `direction: 'within'` join the referenced panel's group and
 * therefore render as tabs. The workspace is added first so every other region
 * can be positioned relative to it. All sizes are initial hints — the user can
 * resize and re-dock freely afterwards.
 */
export function buildDefaultLayout(api: DockviewApi): void {
  api.clear();

  // Center — added first as the anchor for the other regions. The center is
  // split vertically: Pipelines + Workspace on the left, the Echogram viewer on the right.
  api.addPanel({ id: 'workspace', component: 'workspace', title: 'Workspace' });
  api.addPanel({
    id: 'pipelines',
    component: 'pipelines',
    title: 'Pipelines',
    position: { referencePanel: 'workspace', direction: 'within' },
  });

  // Left sidebar — data sources.
  api.addPanel({
    id: 'ncei',
    component: 'ncei',
    title: 'NCEI',
    position: { referencePanel: 'workspace', direction: 'left' },
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
    position: { referencePanel: 'workspace', direction: 'right' },
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

  // Right half of the center split: the Echogram viewer opens as its own group to
  // the right of the Pipelines/Workspace group, before the right sidebar.
  api.addPanel({
    id: 'echogram',
    component: 'echogram',
    title: 'Echogram',
    position: { referencePanel: 'workspace', direction: 'right' },
  });

  // Bottom dock — sits beneath the central workspace.
  api.addPanel({
    id: 'terminal',
    component: 'terminal',
    title: 'Terminal',
    position: { referencePanel: 'workspace', direction: 'below' },
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

  // Surface the primary tab in each dock; Echogram fronts the split center.
  api.getPanel('terminal')?.api.setActive();
  api.getPanel('metadata')?.api.setActive();
  api.getPanel('ncei')?.api.setActive();
  api.getPanel('pipelines')?.api.setActive();
}
