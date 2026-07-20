import { useRef } from 'react';

import type { DialogId } from '../../types';
import { closeDialog, useDialogState } from '../../state/dialogs';
import { dialogRegistry } from './registry';

/**
 * Renders whichever shell dialog is open. Mounted once in AppShell so the menu
 * bar, the toolbar and any future keyboard shortcut all open the same instance.
 *
 * The last opened id is remembered so the dialog can play its closing
 * transition instead of vanishing the moment the store clears.
 */
export function DialogHost() {
  const { id, payload } = useDialogState();
  const lastId = useRef<DialogId | null>(null);
  if (id !== null) lastId.current = id;

  const definition = lastId.current ? dialogRegistry[lastId.current] : undefined;
  if (!definition) return null;

  const Component = definition.component;
  return <Component open={id !== null} onClose={closeDialog} payload={payload} />;
}
