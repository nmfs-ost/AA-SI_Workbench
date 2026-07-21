import { useSyncExternalStore } from 'react';

/**
 * Where the Files panel is currently looking.
 *
 * Exists to answer one question well: when someone picks **File ▸ New Python
 * File** from the menu bar, where should the file go? "The folder I'm looking
 * at" is the only answer that doesn't require re-navigating a tree the user
 * has already navigated. The Files panel publishes its selection here; the New
 * dialog reads it as the default destination.
 *
 * It carries a refresh token for the same reason: after a file is created the
 * tree has to show it, and a store the creator can bump is simpler than
 * threading a callback from a shell dialog into a dock panel.
 */

interface FileBrowserState {
  /** Absolute path of the folder in view (the selected folder, else the root). */
  currentDirectory: string;
  /** Bumped to ask the Files panel to re-read the folder it's showing. */
  refreshToken: number;
  /** Path the tree should reveal and select, e.g. a just-created file. */
  revealPath: string;
}

let state: FileBrowserState = {
  currentDirectory: '',
  refreshToken: 0,
  revealPath: '',
};
const listeners = new Set<() => void>();

function emit(next: FileBrowserState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

export function setCurrentDirectory(path: string): void {
  if (state.currentDirectory === path) return;
  emit({ ...state, currentDirectory: path });
}

/** Ask the Files panel to re-read, optionally revealing a path once it has. */
export function refreshFileBrowser(revealPath = ''): void {
  emit({ ...state, refreshToken: state.refreshToken + 1, revealPath });
}

export function clearReveal(): void {
  if (!state.revealPath) return;
  emit({ ...state, revealPath: '' });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): FileBrowserState {
  return state;
}

export function getFileBrowserState(): FileBrowserState {
  return state;
}

export function useFileBrowser(): FileBrowserState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
