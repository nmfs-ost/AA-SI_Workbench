import type { DialogId } from './dialogs';
import type { PanelId } from './panels';

/**
 * Shell-level action identifiers. These are window-management actions only —
 * no scientific behaviour. `open-panel:<id>` is generated per registered panel
 * so the Window menu can focus/open any tool.
 */
export type ShellActionId =
  | 'noop'
  | 'reset-layout'
  | 'close-all-panels'
  | 'open-panel'
  | 'open-dialog'
  | 'open-external';

/** A menu row. A row is either a command, a divider, or a submenu. */
export interface MenuItemDefinition {
  id: string;
  label?: string;
  /** Human-readable shortcut hint, e.g. "Ctrl+S". Display-only in the shell. */
  shortcut?: string;
  /** The shell action to dispatch when chosen. */
  action?: ShellActionId;
  /** For 'open-panel', which panel to focus/open. */
  panelId?: PanelId;
  /** For 'open-dialog', which shell dialog to show. */
  dialogId?: DialogId;
  /** Optional argument handed to the dialog (e.g. which issue form to open). */
  dialogPayload?: string;
  /** For 'open-external', the URL to open in a new tab. */
  href?: string;
  disabled?: boolean;
  /** Render a separator line instead of a command. */
  divider?: boolean;
}

/** A top-level menu in the menu bar (File, Edit, …). */
export interface MenuDefinition {
  id: string;
  label: string;
  items: MenuItemDefinition[];
}
