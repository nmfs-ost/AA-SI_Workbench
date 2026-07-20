import { useSyncExternalStore } from 'react';

import type { DialogId } from '../types';

/**
 * Which shell dialog is open.
 *
 * The menu bar, the toolbar and (later) keyboard shortcuts all need to open the
 * same dialogs, and none of them owns the others — so the open state lives in a
 * module store and `DialogHost` (mounted once in AppShell) renders the result.
 * Adding a dialog is a registry entry, not a change to the menu bar.
 */

export interface DialogState {
  id: DialogId | null;
  /** Optional argument for the dialog, e.g. which issue form to preselect. */
  payload: string;
}

let state: DialogState = { id: null, payload: '' };
const listeners = new Set<() => void>();

function emit(next: DialogState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function openDialog(id: DialogId, payload = ''): void {
  emit({ id, payload });
}

export function closeDialog(): void {
  if (state.id === null) return;
  emit({ id: null, payload: state.payload });
}

function getSnapshot(): DialogState {
  return state;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useDialogState(): DialogState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
