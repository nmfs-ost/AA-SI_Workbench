import { useCallback, useEffect, useRef, useState } from 'react';
import type { DockviewApi, DockviewReadyEvent } from 'dockview';

/** Structural type for a Dockview event subscription handle. */
type Disposable = { dispose: () => void };

import type { PanelId, PanelRegion } from '../types';
import { LAYOUT_STORAGE_KEY, LAYOUT_VERSION } from '../types';
import type { PersistedLayout } from '../types';
import {
  getPanelDefinition,
  panelDefinitions,
} from '../components/panels/registry';
import { buildDefaultLayout } from '../components/layout/defaultLayout';
import {
  editorPanelId,
  editorPathFromPanelId,
} from '../components/panels/editor/panelIds';
import { closeDoc, getEditorsState, isDirty } from '../state/editors';

/* ------------------------------------------------------------------ */
/* Persistence helpers                                                 */
/* ------------------------------------------------------------------ */

function loadLayout(): PersistedLayout | null {
  try {
    const raw = window.localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedLayout;
    if (parsed.version !== LAYOUT_VERSION) return null;
    return parsed;
  } catch {
    // Corrupt JSON or storage disabled — fall back to the default layout.
    return null;
  }
}

function saveLayout(api: DockviewApi): void {
  try {
    const payload: PersistedLayout = {
      version: LAYOUT_VERSION,
      layout: api.toJSON(),
    };
    window.localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota / availability errors — persistence is best-effort.
  }
}

function clearLayout(): void {
  try {
    window.localStorage.removeItem(LAYOUT_STORAGE_KEY);
  } catch {
    // no-op
  }
}

/* ------------------------------------------------------------------ */
/* Controller                                                          */
/* ------------------------------------------------------------------ */

const REGION_DIRECTION: Record<
  Exclude<PanelRegion, 'center'>,
  'left' | 'right' | 'below'
> = {
  left: 'left',
  right: 'right',
  bottom: 'below',
};

/** Width the left dock returns to when it hasn't been resized. */
const DEFAULT_LEFT_WIDTH = 360;
/** Below this the left dock counts as collapsed rather than merely narrow. */
const COLLAPSED_THRESHOLD = 8;

export interface LayoutController {
  /** Wire to <DockviewReact onReady={...} />. */
  onReady: (event: DockviewReadyEvent) => void;
  /** True once the Dockview instance exists and the layout is applied. */
  ready: boolean;
  /** Discard the saved layout and rebuild the default arrangement. */
  resetLayout: () => void;
  /** Focus a panel if open, otherwise open it in its default region. */
  openPanel: (id: PanelId) => void;
  /** Close every user-closeable panel (keeps the workspace). */
  closeAllPanels: () => void;
  /** Open a file as a centre tab, or focus it if it's already open. */
  openEditor: (path: string, name: string) => void;
  /** Which left-region panel is fronted — what the activity bar highlights. */
  activeLeftPanelId: PanelId | null;
  /** True when the left dock is collapsed to nothing. */
  leftCollapsed: boolean;
  /**
   * Activity-bar click: front the panel, or collapse the dock if it's already
   * fronted. The same gesture JupyterLab and VS Code use.
   */
  toggleLeftPanel: (id: PanelId) => void;
}

/**
 * Owns the Dockview instance lifecycle: restores a persisted layout (or builds
 * the default), autosaves on change, and exposes the window-management actions
 * the menu bar and toolbar dispatch. All layout mutation flows through here.
 */
export function useLayoutController(): LayoutController {
  const apiRef = useRef<DockviewApi | null>(null);
  const disposablesRef = useRef<Disposable[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Width to restore the left dock to after a collapse. */
  const leftWidthRef = useRef(DEFAULT_LEFT_WIDTH);
  const [ready, setReady] = useState(false);
  const [activeLeftPanelId, setActiveLeftPanelId] = useState<PanelId | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  const scheduleSave = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    // Debounce: layout events can fire in bursts during a drag/resize.
    saveTimerRef.current = setTimeout(() => saveLayout(api), 250);
  }, []);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      apiRef.current = api;

      const saved = loadLayout();
      if (saved) {
        try {
          api.fromJSON(saved.layout);
        } catch {
          // A saved layout that no longer deserializes (e.g. a renamed panel)
          // should never brick startup — rebuild from scratch.
          buildDefaultLayout(api);
        }
      } else {
        buildDefaultLayout(api);
      }

      /* Which data source is fronted, for the activity bar. Tracked from the
         active-panel event rather than polled: a panel can be fronted by a tab
         click, the Window menu, a drag, or a restored layout, and they all end
         up here. */
      const syncActiveLeft = () => {
        const active = api.activePanel;
        if (active && getPanelDefinition(active.id)?.region === 'left') {
          setActiveLeftPanelId(active.id);
        }
      };
      const seedActiveLeft = () => {
        const leftPanel = api.panels.find(
          (panel) => getPanelDefinition(panel.id)?.region === 'left',
        );
        const fronted = leftPanel?.group?.activePanel ?? leftPanel;
        if (fronted) setActiveLeftPanelId(fronted.id);
        // A layout saved while collapsed restores at zero width; believe the
        // layout rather than the fresh component state.
        if (leftPanel) {
          setLeftCollapsed(leftPanel.group.api.width < COLLAPSED_THRESHOLD);
        }
      };

      seedActiveLeft();

      disposablesRef.current = [
        api.onDidLayoutChange(scheduleSave),
        api.onDidActivePanelChange(syncActiveLeft),
        api.onDidLayoutChange(() => {
          // A left panel can disappear (closed, or dragged elsewhere); keep the
          // activity bar's highlight pointing at something that exists.
          setActiveLeftPanelId((current) =>
            current && api.getPanel(current) ? current : null,
          );
        }),
        /* Closing an editor tab drops its buffer — unless it has unsaved edits,
           which are kept so reopening the file restores them. Nothing here can
           veto the close (Dockview reports it after the fact), so preserving
           the work is the only honest option. */
        api.onDidRemovePanel((panel) => {
          const path = editorPathFromPanelId(panel.id);
          if (path && !isDirty(getEditorsState().docs[path])) closeDoc(path);
        }),
      ];
      setReady(true);
    },
    [scheduleSave],
  );

  const resetLayout = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    clearLayout();
    buildDefaultLayout(api);
  }, []);

  const openPanel = useCallback((id: PanelId) => {
    const api = apiRef.current;
    if (!api) return;

    const existing = api.getPanel(id);
    if (existing) {
      existing.api.setActive();
      return;
    }

    const definition = getPanelDefinition(id);
    if (!definition) return;

    // Prefer opening as a tab beside an existing panel from the same region.
    const sibling = panelDefinitions.find(
      (candidate) =>
        candidate.region === definition.region &&
        candidate.id !== id &&
        api.getPanel(candidate.id) !== undefined,
    );

    if (sibling) {
      api.addPanel({
        id: definition.id,
        component: definition.id,
        title: definition.title,
        position: { referencePanel: sibling.id, direction: 'within' },
      });
      return;
    }

    // No sibling open: dock a fresh region relative to the workspace.
    if (definition.region === 'center') {
      api.addPanel({
        id: definition.id,
        component: definition.id,
        title: definition.title,
        position: { referencePanel: 'workspace', direction: 'within' },
      });
      return;
    }

    api.addPanel({
      id: definition.id,
      component: definition.id,
      title: definition.title,
      position: {
        referencePanel: 'workspace',
        direction: REGION_DIRECTION[definition.region],
      },
    });
  }, []);

  /**
   * Open a file as a tab in the centre. Editors group with each other first and
   * with the workspace otherwise, so opening a second file lands next to the
   * first rather than splitting the layout.
   */
  const openEditor = useCallback((path: string, name: string) => {
    const api = apiRef.current;
    if (!api) return;

    const id = editorPanelId(path);
    const existing = api.getPanel(id);
    if (existing) {
      existing.api.setActive();
      return;
    }

    const reference =
      [...api.panels].reverse().find((panel) => editorPathFromPanelId(panel.id)) ??
      api.getPanel('workspace') ??
      api.panels.find((panel) => getPanelDefinition(panel.id)?.region === 'center');

    api.addPanel({
      id,
      component: 'editor',
      title: name,
      params: { path },
      ...(reference
        ? { position: { referencePanel: reference.id, direction: 'within' as const } }
        : {}),
    });
  }, []);

  const toggleLeftPanel = useCallback(
    (id: PanelId) => {
      const api = apiRef.current;
      if (!api) return;

      const panel = api.getPanel(id);
      if (!panel) {
        openPanel(id);
        setLeftCollapsed(false);
        return;
      }

      const group = panel.group;
      const fronted = group.activePanel?.id === id;
      const collapsed = group.api.width < COLLAPSED_THRESHOLD;

      if (collapsed || !fronted) {
        // Expand and front. Dockview clamps a group to its minimum width, so
        // the constraint has to be restored before the size is.
        if (collapsed) {
          group.api.setConstraints({ minimumWidth: 100 });
          group.api.setSize({ width: leftWidthRef.current });
        }
        panel.api.setActive();
        setActiveLeftPanelId(id);
        setLeftCollapsed(false);
        return;
      }

      // Clicking the source you're already in collapses the dock, the way it
      // does in JupyterLab — the fastest way to hand the width to the editor.
      leftWidthRef.current = Math.max(group.api.width, 200);
      group.api.setConstraints({ minimumWidth: 0 });
      group.api.setSize({ width: 0 });
      setLeftCollapsed(true);
    },
    [openPanel],
  );

  const closeAllPanels = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    // Snapshot first: removing mutates api.panels.
    for (const panel of [...api.panels]) {
      const definition = getPanelDefinition(panel.id);
      if (definition?.closeable === false) continue;
      api.removePanel(panel);
    }
  }, []);

  // Tear down subscriptions on unmount.
  useEffect(() => {
    return () => {
      for (const disposable of disposablesRef.current) disposable.dispose();
      disposablesRef.current = [];
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return {
    onReady,
    ready,
    resetLayout,
    openPanel,
    closeAllPanels,
    openEditor,
    activeLeftPanelId,
    leftCollapsed,
    toggleLeftPanel,
  };
}
