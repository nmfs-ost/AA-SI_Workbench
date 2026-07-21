import type { MenuDefinition, MenuItemDefinition } from '../../types';
import { repo } from '../../config/repo';
import { panelDefinitions } from '../panels/registry';

/**
 * Data-driven menu bar definition. Window-management actions (Reset Layout,
 * Close All Panels, open/focus a panel, About) are wired to real behaviour;
 * everything else is an inert placeholder with a shortcut hint, ready to be
 * connected as features land. No scientific behaviour is implemented here.
 *
 * The Window menu is generated from the panel registry, so any newly registered
 * tool automatically becomes openable from the menu bar. Dialog-opening items
 * name a dialog from the dialog registry rather than importing a component, so
 * this file stays pure data.
 */

/* Dynamic panels (the file editor) are excluded: they're opened by opening a
   file, and a "Window ▸ Editor" item would open an empty one. */
const windowPanelItems: MenuItemDefinition[] = panelDefinitions
  .filter((definition) => !definition.dynamic)
  .map((definition) => ({
    id: `open-${definition.id}`,
    label: definition.title,
    action: 'open-panel',
    panelId: definition.id,
  }));

export const menus: MenuDefinition[] = [
  {
    id: 'file',
    label: 'File',
    items: [
      {
        id: 'file-new-text',
        label: 'New Text File…',
        action: 'open-dialog',
        dialogId: 'new-file',
        dialogPayload: 'text',
      },
      {
        id: 'file-new-python',
        label: 'New Python File…',
        action: 'open-dialog',
        dialogId: 'new-file',
        dialogPayload: 'python',
      },
      {
        id: 'file-new-notebook',
        label: 'New Notebook…',
        action: 'open-dialog',
        dialogId: 'new-file',
        dialogPayload: 'notebook',
      },
      {
        id: 'file-new-folder',
        label: 'New Folder…',
        action: 'open-dialog',
        dialogId: 'new-file',
        dialogPayload: 'folder',
      },
      { id: 'file-div-1', divider: true },
      { id: 'file-open', label: 'Open…', shortcut: 'Ctrl+O', action: 'open-panel', panelId: 'files' },
      { id: 'file-save', label: 'Save', shortcut: 'Ctrl+S', action: 'save-active-file' },
      { id: 'file-div-2', divider: true },
      { id: 'file-close', label: 'Close Window', action: 'noop' },
    ],
  },
  {
    id: 'edit',
    label: 'Edit',
    items: [
      { id: 'edit-undo', label: 'Undo', shortcut: 'Ctrl+Z', action: 'noop' },
      { id: 'edit-redo', label: 'Redo', shortcut: 'Ctrl+Shift+Z', action: 'noop' },
      { id: 'edit-div-1', divider: true },
      { id: 'edit-cut', label: 'Cut', shortcut: 'Ctrl+X', action: 'noop' },
      { id: 'edit-copy', label: 'Copy', shortcut: 'Ctrl+C', action: 'noop' },
      { id: 'edit-paste', label: 'Paste', shortcut: 'Ctrl+V', action: 'noop' },
      { id: 'edit-div-2', divider: true },
      { id: 'edit-find', label: 'Find…', shortcut: 'Ctrl+F', action: 'noop' },
    ],
  },
  {
    id: 'view',
    label: 'View',
    items: [
      {
        id: 'view-layout-horizontal',
        label: 'Horizontal Layout',
        action: 'apply-layout',
        layoutVariant: 'horizontal',
      },
      {
        id: 'view-layout-vertical',
        label: 'Vertical Layout',
        action: 'apply-layout',
        layoutVariant: 'vertical',
      },
      { id: 'view-div-1', divider: true },
      { id: 'view-reset', label: 'Reset Layout', action: 'reset-layout' },
      { id: 'view-close-all', label: 'Close All Panels', action: 'close-all-panels' },
      { id: 'view-div-2', divider: true },
      { id: 'view-appearance', label: 'Appearance', disabled: true },
    ],
  },
  {
    id: 'run',
    label: 'Run',
    items: [
      { id: 'run-run', label: 'Run', shortcut: 'Ctrl+R', action: 'noop' },
      { id: 'run-stop', label: 'Stop', shortcut: 'Ctrl+.', action: 'noop' },
      { id: 'run-div-1', divider: true },
      { id: 'run-config', label: 'Run Configuration…', disabled: true },
    ],
  },
  {
    id: 'tools',
    label: 'Tools',
    items: [
      {
        id: 'tools-update-environment',
        label: 'Update Python Environment (aa-setup)…',
        action: 'open-dialog',
        dialogId: 'environment',
      },
      { id: 'tools-div-1', divider: true },
      { id: 'tools-settings', label: 'Settings…', shortcut: 'Ctrl+,', action: 'noop' },
      { id: 'tools-extensions', label: 'Extensions', disabled: true },
    ],
  },
  {
    id: 'window',
    label: 'Window',
    items: [
      ...windowPanelItems,
      { id: 'window-div-1', divider: true },
      { id: 'window-reset', label: 'Reset Layout', action: 'reset-layout' },
    ],
  },
  {
    id: 'help',
    label: 'Help',
    items: [
      { id: 'help-docs', label: 'Documentation', action: 'open-external', href: repo.docsUrl },
      { id: 'help-div-1', divider: true },
      {
        id: 'help-report-bug',
        label: 'Report a Problem…',
        action: 'open-dialog',
        dialogId: 'feedback',
        dialogPayload: 'bug',
      },
      {
        id: 'help-suggest',
        label: 'Suggest an Improvement…',
        action: 'open-dialog',
        dialogId: 'feedback',
        dialogPayload: 'feature',
      },
      {
        id: 'help-issues',
        label: 'View Issues on GitHub',
        action: 'open-external',
        href: repo.issuesUrl,
      },
      {
        id: 'help-discussions',
        label: 'Discussions',
        action: 'open-external',
        href: repo.discussionsUrl,
      },
      { id: 'help-div-2', divider: true },
      { id: 'help-about', label: 'About AA-SI', action: 'open-dialog', dialogId: 'about' },
    ],
  },
];
