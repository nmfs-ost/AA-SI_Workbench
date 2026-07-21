import { useSyncExternalStore } from 'react';

import { filesApi, type FsDocument, type FsKind } from '../services/filesApi';
import { basename } from '../components/panels/editor/paths';

/**
 * Files currently open in the workspace.
 *
 * A module store rather than panel state for the same reason the terminal and
 * active-asset bridges are: the Files panel (left dock), the editor tabs
 * (centre), the File menu and the status bar all need the same facts, and none
 * of them is an ancestor of the others. Dockview mounts panels through portals,
 * so React context would not reach across anyway.
 *
 * The buffer lives here, not in the editor component, which is what makes an
 * unsaved file survive its tab being dragged to another dock group — Dockview
 * unmounts and remounts the component when a panel moves, and losing edits to a
 * drag would be indefensible.
 */

export type DocStatus = 'loading' | 'ready' | 'error';

export interface EditorDoc {
  path: string;
  name: string;
  kind: FsKind;
  status: DocStatus;
  /** Current buffer. */
  text: string;
  /** What's believed to be on disk; `text !== savedText` is the dirty test. */
  savedText: string;
  /** Why the file couldn't be loaded at all. */
  error: string;
  /** Why the contents aren't editable, when they exist but can't be shown. */
  detail: string;
  binary: boolean;
  truncated: boolean;
  readOnly: boolean;
  saving: boolean;
  saveError: string;
  sizeBytes: number;
  modifiedAt: string;
}

/** A request for the shell to open (or focus) an editor tab. */
export interface OpenRequest {
  id: number;
  path: string;
  name: string;
}

interface EditorsState {
  docs: Record<string, EditorDoc>;
  request: OpenRequest | null;
  /** The editor tab the user is in, so Ctrl+S knows what "this file" means. */
  focusedPath: string;
}

let state: EditorsState = { docs: {}, request: null, focusedPath: '' };
let counter = 0;
const listeners = new Set<() => void>();

function emit(next: EditorsState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function patch(path: string, changes: Partial<EditorDoc>): void {
  const existing = state.docs[path];
  if (!existing) return;
  emit({ ...state, docs: { ...state.docs, [path]: { ...existing, ...changes } } });
}

function fromResponse(document: FsDocument): Partial<EditorDoc> {
  return {
    status: 'ready',
    kind: document.kind,
    text: document.text,
    savedText: document.text,
    detail: document.detail,
    binary: document.binary,
    truncated: document.truncated,
    readOnly: document.readOnly,
    sizeBytes: document.sizeBytes,
    modifiedAt: document.modifiedAt,
    error: '',
    saveError: '',
  };
}

async function load(path: string): Promise<void> {
  try {
    const document = await filesApi.read(path);
    patch(path, fromResponse(document));
  } catch (error) {
    patch(path, {
      status: 'error',
      error: error instanceof Error ? error.message : 'Could not open that file.',
    });
  }
}

/**
 * Open a file, or focus it if it's already open.
 *
 * An already-open file is never re-fetched: doing so would discard unsaved
 * edits every time someone clicked the same row twice, which is the kind of
 * data loss that teaches people not to trust an editor.
 */
export function openFile(path: string, name = basename(path)): void {
  counter += 1;
  const request: OpenRequest = { id: counter, path, name };

  const existing = state.docs[path];
  if (existing) {
    emit({ ...state, request });
    return;
  }

  emit({
    ...state,
    request,
    docs: {
      ...state.docs,
      [path]: {
        path,
        name,
        kind: 'file',
        status: 'loading',
        text: '',
        savedText: '',
        error: '',
        detail: '',
        binary: false,
        truncated: false,
        readOnly: false,
        saving: false,
        saveError: '',
        sizeBytes: 0,
        modifiedAt: '',
      },
    },
  });
  void load(path);
}

/** Re-read from disk, discarding the buffer. The caller confirms first. */
export function revertDoc(path: string): void {
  if (!state.docs[path]) return;
  patch(path, { status: 'loading', saveError: '' });
  void load(path);
}

export function setDocText(path: string, text: string): void {
  const existing = state.docs[path];
  if (!existing || existing.text === text) return;
  patch(path, { text, saveError: '' });
}

export async function saveDoc(path: string): Promise<boolean> {
  const doc = state.docs[path];
  if (!doc || doc.saving || doc.readOnly || doc.truncated) return false;

  patch(path, { saving: true, saveError: '' });
  try {
    const entry = await filesApi.write(path, doc.text);
    // Compare against the buffer as it was when the request went out: an edit
    // made while the write was in flight must stay dirty, not be marked saved.
    patch(path, {
      saving: false,
      savedText: doc.text,
      sizeBytes: entry.sizeBytes,
      modifiedAt: entry.modifiedAt,
    });
    return true;
  } catch (error) {
    patch(path, {
      saving: false,
      saveError: error instanceof Error ? error.message : 'Could not save.',
    });
    return false;
  }
}

export function closeDoc(path: string): void {
  if (!state.docs[path]) return;
  const docs = { ...state.docs };
  delete docs[path];
  emit({ ...state, docs });
}

/** Record which editor tab is fronted. Called by the panel as it activates. */
export function setFocusedEditor(path: string): void {
  if (state.focusedPath === path) return;
  emit({ ...state, focusedPath: path });
}

/**
 * Save whichever file the user is looking at — what File ▸ Save and a global
 * Ctrl+S mean. Returns false when there's nothing to save, so a caller can
 * decide whether to swallow the keystroke.
 */
export async function saveActiveDoc(): Promise<boolean> {
  const path = state.focusedPath;
  if (!path || !state.docs[path]) return false;
  return saveDoc(path);
}

/** Clear a request once the shell has acted on it. */
export function clearOpenRequest(id: number): void {
  if (state.request?.id === id) emit({ ...state, request: null });
}

export function isDirty(doc: EditorDoc | undefined): boolean {
  return doc !== undefined && doc.status === 'ready' && doc.text !== doc.savedText;
}

/* ------------------------------------------------------------------ */
/* Subscriptions                                                       */
/* ------------------------------------------------------------------ */

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getEditorsState(): EditorsState {
  return state;
}

export function subscribeEditors(listener: () => void): () => void {
  return subscribe(listener);
}

export function useEditorDoc(path: string): EditorDoc | undefined {
  return useSyncExternalStore(
    subscribe,
    () => state.docs[path],
    () => state.docs[path],
  );
}

export function useOpenRequest(): OpenRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => state.request,
    () => state.request,
  );
}

/** How many open files have unsaved edits. Drives the status bar. */
export function useUnsavedCount(): number {
  return useSyncExternalStore(
    subscribe,
    () => Object.values(state.docs).filter(isDirty).length,
    () => 0,
  );
}
