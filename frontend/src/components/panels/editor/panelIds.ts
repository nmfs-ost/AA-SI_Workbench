/**
 * Editor tabs are dynamic panels: one Dockview panel per open file, all sharing
 * the single registered `editor` component. The panel id carries the path so a
 * file can be focused if it's already open, and so the layout controller can
 * tell an editor tab from a built-in panel when one is closed.
 */

export const EDITOR_PANEL_PREFIX = 'editor:';

export function editorPanelId(path: string): string {
  return `${EDITOR_PANEL_PREFIX}${path}`;
}

/** The path an editor panel is showing, or null for any other panel. */
export function editorPathFromPanelId(panelId: string): string | null {
  return panelId.startsWith(EDITOR_PANEL_PREFIX)
    ? panelId.slice(EDITOR_PANEL_PREFIX.length)
    : null;
}
