import type { SerializedDockview } from 'dockview';

/** localStorage key holding the user's last dock arrangement. */
export const LAYOUT_STORAGE_KEY = 'aa-si.layout';

/**
 * Bump when the default layout changes in a way returning users should receive
 * (a panel added, removed, or moved). A saved layout whose version doesn't match
 * is discarded and the default layout is rebuilt.
 */
export const LAYOUT_VERSION = 14;

/**
 * Which monitor the arrangement is shaped for.
 *
 * `horizontal` spends the screen's width: sources on the left, inspector on the
 * right, workspace between them. On a portrait monitor that costs ~700px of the
 * ~1080 available before the workspace gets any, so `vertical` spends height
 * instead — every region becomes a full-width band and nothing is ever split
 * side by side.
 */
export type LayoutVariant = 'horizontal' | 'vertical';

/** What gets written to localStorage. */
export interface PersistedLayout {
  version: number;
  layout: SerializedDockview;
  /**
   * Which builder produced this arrangement, so Reset Layout rebuilds the one
   * the user chose rather than snapping back to horizontal. Absent in records
   * written before the vertical layout existed — treat as 'horizontal'.
   */
  variant?: LayoutVariant;
}
