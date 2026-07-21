import type { SerializedDockview } from 'dockview';

/** localStorage key holding the user's last dock arrangement. */
export const LAYOUT_STORAGE_KEY = 'aa-si.layout';

/**
 * Bump when the default layout changes in a way returning users should receive
 * (a panel added, removed, or moved). A saved layout whose version doesn't match
 * is discarded and the default layout is rebuilt.
 */
export const LAYOUT_VERSION = 11;

/** What gets written to localStorage. */
export interface PersistedLayout {
  version: number;
  layout: SerializedDockview;
}
