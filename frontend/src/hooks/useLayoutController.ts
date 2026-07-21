import { useCallback, useEffect, useRef, useState } from 'react';
import type { DockviewApi, DockviewReadyEvent } from 'dockview';

/** Structural type for a Dockview event subscription handle. */
type Disposable = { dispose: () => void };

import type { PanelId, PanelRegion } from '../types';
import { LAYOUT_STORAGE_KEY, LAYOUT_VERSION } from '../types';
import type { LayoutVariant, PersistedLayout } from '../types';
import {
  getPanelDefinition,
  panelDefinitions,
} from '../components/panels/registry';
import { buildLayout } from '../components/layout/defaultLayout';
import { isSourceGroup } from '../components/layout/sidebarChrome';
import {
  editorPanelId,
  editorPathFromPanelId,
} from '../components/panels/editor/panelIds';
import { basename } from '../components/panels/editor/paths';
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

function saveLayout(api: DockviewApi, variant: LayoutVariant): void {
  try {
    const payload: PersistedLayout = {
      version: LAYOUT_VERSION,
      layout: api.toJSON(),
      variant,
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

/**
 * Repeat clicks on the same activity-bar icon inside this window count as one
 * intent. Long enough to swallow an OS double-click, short enough that nobody
 * notices it when deliberately toggling twice.
 */
const DOUBLE_CLICK_MS = 350;

export interface LayoutController {
  /** Wire to <DockviewReact onReady={...} />. */
  onReady: (event: DockviewReadyEvent) => void;
  /** True once the Dockview instance exists and the layout is applied. */
  ready: boolean;
  /** Discard the saved layout and rebuild the current arrangement from scratch. */
  resetLayout: () => void;
  /** Rebuild the dock for a landscape or portrait monitor. */
  applyLayout: (variant: LayoutVariant) => void;
  /** Which arrangement is in force — what the View menu ticks. */
  layoutVariant: LayoutVariant;
  /** Focus a panel if open, otherwise open it in its default region. */
  openPanel: (id: PanelId) => void;
  /** Close every user-closeable panel. */
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
 * Strip the tab strip from the sources sidebar.
 *
 * The activity bar already names every source, marks the active one, and
 * switches between them, so a row of text tabs directly beside it says the same
 * thing twice and costs 35px of vertical space in the narrowest part of the
 * window. Removing it makes the left dock a *sidebar* rather than a dock group,
 * which is what it has always behaved like.
 *
 * Two consequences are handled here rather than left to surprise someone:
 *   - With no header there is nothing to drag, so the sidebar is also locked
 *     against drops. Otherwise a tab dropped into it would vanish — no tab to
 *     show it, no close button to undo it.
 *   - A group that stops being all-sources gets its header back, so the state
 *     can't become unreachable.
 *
 * Dockview serializes both flags (`hideHeader`, `locked`), so this survives a
 * save/restore; it is re-applied on layout change anyway because re-opening a
 * closed source can build a brand-new group.
 */
function syncSidebarChrome(api: DockviewApi): void {
  for (const group of api.groups) {
    const sidebar = isSourceGroup(group, (id) => getPanelDefinition(id)?.region);
    if (group.header.hidden !== sidebar) group.header.hidden = sidebar;
    const locked = sidebar ? 'no-drop-target' : false;
    if (group.locked !== locked) group.locked = locked;
  }
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
  /** Last activity-bar toggle, for collapsing a double-click into one action. */
  const lastToggleRef = useRef<{ id: string; at: number }>({ id: '', at: 0 });
  /* Set while a layout is being torn down and rebuilt, so the panel-removal
     cleanup doesn't mistake a re-flow for the user closing their files. */
  const rebuildingRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [layoutVariant, setLayoutVariant] = useState<LayoutVariant>('horizontal');
  /* Autosave fires from Dockview callbacks that close over nothing; a ref keeps
     the variant reachable there without re-subscribing on every change. */
  const variantRef = useRef<LayoutVariant>('horizontal');
  const [activeLeftPanelId, setActiveLeftPanelId] = useState<PanelId | null>(null);
  const [leftCollapsed, setLeftCollapsed] = useState(false);

  const scheduleSave = useCallback(() => {
    const api = apiRef.current;
    if (!api) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    // Debounce: layout events can fire in bursts during a drag/resize.
    saveTimerRef.current = setTimeout(() => saveLayout(api, variantRef.current), 250);
  }, []);

  const onReady = useCallback(
    (event: DockviewReadyEvent) => {
      const api = event.api;
      apiRef.current = api;

      const saved = loadLayout();
      // Records written before the vertical layout existed carry no variant.
      const variant: LayoutVariant = saved?.variant ?? 'horizontal';
      variantRef.current = variant;
      setLayoutVariant(variant);

      if (saved) {
        try {
          api.fromJSON(saved.layout);
        } catch {
          // A saved layout that no longer deserializes (e.g. a renamed panel)
          // should never brick startup — rebuild from scratch, in the shape the
          // user last chose.
          buildLayout(api, variant);
        }
      } else {
        buildLayout(api, variant);
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
        // Visibility is serialized with the layout, so a sidebar collapsed
        // before a reload comes back collapsed. Believe the layout rather than
        // the fresh component state.
        if (leftPanel) setLeftCollapsed(!leftPanel.group.api.isVisible);
      };

      seedActiveLeft();
      syncSidebarChrome(api);

      disposablesRef.current = [
        api.onDidLayoutChange(scheduleSave),
        api.onDidLayoutChange(() => syncSidebarChrome(api)),
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
          if (rebuildingRef.current) return;
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
    buildLayout(api, variantRef.current);
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

    /* No sibling open, so dock relative to whatever holds the centre. Nothing
       is guaranteed to be open — every panel is closeable — so the last resort
       is a positionless add, which Dockview places in a group of its own. */
    const anchor = api.panels.find(
      (candidate) => getPanelDefinition(candidate.id)?.region === 'center',
    );

    if (!anchor) {
      api.addPanel({
        id: definition.id,
        component: definition.id,
        title: definition.title,
      });
      return;
    }

    api.addPanel({
      id: definition.id,
      component: definition.id,
      title: definition.title,
      position: {
        referencePanel: anchor.id,
        direction:
          definition.region === 'center'
            ? 'within'
            : REGION_DIRECTION[definition.region],
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

  /**
   * Rebuild the dock for a monitor shape.
   *
   * This is a full teardown. Dockview has no "re-flow" operation, and moving
   * regions one at a time through a grid that is already the wrong shape gives
   * worse arrangements than starting over.
   *
   * Open files are carried across: their paths are captured first, the removal
   * cleanup is suppressed for the duration so no buffer is dropped, and the
   * tabs are re-added afterwards. Changing which monitor you're on is not a
   * reason to lose the file you were editing.
   */
  const applyLayout = useCallback(
    (variant: LayoutVariant) => {
      const api = apiRef.current;
      if (!api) return;

      const openPaths = api.panels
        .map((panel) => editorPathFromPanelId(panel.id))
        .filter((path): path is string => path !== null);

      variantRef.current = variant;
      setLayoutVariant(variant);

      rebuildingRef.current = true;
      try {
        buildLayout(api, variant);
      } finally {
        rebuildingRef.current = false;
      }

      for (const path of openPaths) {
        openEditor(path, getEditorsState().docs[path]?.name ?? basename(path));
      }

      setLeftCollapsed(false);
      saveLayout(api, variant);
    },
    [openEditor],
  );

  const toggleLeftPanel = useCallback(
    (id: PanelId) => {
      const api = apiRef.current;
      if (!api) return;

      /* A double-click is two click events. Left alone, the second undoes the
         first, so a user who double-clicks to close the sidebar sees it flash
         and stay open. Repeats on the *same* icon collapse into one action;
         clicking a different source is a different intent and stays instant. */
      const now = Date.now();
      const last = lastToggleRef.current;
      if (last.id === id && now - last.at < DOUBLE_CLICK_MS) return;
      lastToggleRef.current = { id, at: now };

      const panel = api.getPanel(id);
      if (!panel) {
        openPanel(id);
        setLeftCollapsed(false);
        return;
      }

      const group = panel.group;
      /* Collapse is `setVisible`, not a resize to zero. Dockview removes a
         hidden view from the grid, hands its space to the neighbours, and
         remembers its size for when it comes back. Driving the width to 0
         instead means fighting the grid's minimum-size clamps, which is what
         used to leave the sidebar stuck narrow and half-drawn. Visibility is
         also a boolean, so there is no threshold to be on the wrong side of. */
      const hidden = !group.api.isVisible;
      const fronted = group.activePanel?.id === id;

      if (hidden || !fronted) {
        if (hidden) group.api.setVisible(true);
        panel.api.setActive();
        setActiveLeftPanelId(id);
        setLeftCollapsed(false);
        return;
      }

      // Clicking the source you're already in collapses the dock, the way it
      // does in JupyterLab — the fastest way to hand the space to the editor.
      group.api.setVisible(false);
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
    applyLayout,
    layoutVariant,
    activeLeftPanelId,
    leftCollapsed,
    toggleLeftPanel,
  };
}
