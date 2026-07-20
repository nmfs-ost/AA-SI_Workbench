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
}

/**
 * Owns the Dockview instance lifecycle: restores a persisted layout (or builds
 * the default), autosaves on change, and exposes the window-management actions
 * the menu bar and toolbar dispatch. All layout mutation flows through here.
 */
export function useLayoutController(): LayoutController {
  const apiRef = useRef<DockviewApi | null>(null);
  const disposableRef = useRef<Disposable | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ready, setReady] = useState(false);

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

      disposableRef.current = api.onDidLayoutChange(scheduleSave);
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
      disposableRef.current?.dispose();
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  return { onReady, ready, resetLayout, openPanel, closeAllPanels };
}
