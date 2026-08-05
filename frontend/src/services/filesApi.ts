/**
 * Client for /api/fs — the workstation's own filesystem.
 *
 * Mirrors backend/src/aa_si_workbench/api/files.py verbatim (camelCase on the
 * wire). Every path is confined server-side to AASI_FS_ROOT; nothing here
 * re-checks that, because a client-side boundary check would be decoration.
 *
 * Reading and listing are unconditional. Writing and organising — create,
 * save, rename, move, trash — are all gated server-side by AASI_FS_READONLY.
 *
 * There is still no delete. `trash` *moves*, following the XDG Trash spec, and
 * hands back the token `restore` needs, so the panel can offer "Moved to Trash
 * · Undo" rather than an irreversible action with a confirmation dialog in
 * front of it. A confirmation is a worse guarantee than an undo: it asks the
 * user to be certain in advance, which is the one thing they cannot be.
 */

const API_BASE = (import.meta.env.VITE_AASI_API_BASE ?? '').replace(/\/$/, '');

/** Coarse asset kind the backend tags each entry with. */
export type FsKind =
  | 'folder'
  | 'raw'
  | 'netcdf'
  | 'zarr'
  | 'table'
  | 'region'
  | 'image'
  | 'text'
  | 'python'
  | 'notebook'
  | 'markdown'
  | 'file';

/** The kinds the New menu can bring into existence. */
export type NewEntryKind = 'text' | 'python' | 'notebook' | 'markdown' | 'folder';

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  kind: FsKind;
  sizeBytes: number;
  modifiedAt: string;
  /**
   * Account owning the file — **not** who last wrote it.
   *
   * POSIX records `st_uid` and nothing else, so "modified by" is not a
   * question the filesystem can answer. On a shared workstation the owner and
   * the last writer differ, which is exactly the case a column headed
   * "modified by" would get wrong. Empty where there is no passwd database.
   */
  owner: string;
  /** Number of children, or -1 when not counted (unreadable, or not a folder). */
  childCount: number;
}

/** What `trash` hands back — everything `restore` needs to undo it. */
export interface FsTrashResult {
  /** Where it used to be. */
  path: string;
  name: string;
  /** Where it is now, so the message is checkable rather than trusted. */
  trashedTo: string;
  /** Opaque handle for `restore`. Not necessarily the file's name. */
  token: string;
}

export interface FsListing {
  path: string;
  /** Empty at the browsable root — there is nowhere further up to go. */
  parent: string;
  root: string;
  entries: FsEntry[];
  truncated: boolean;
}

export interface FsRoot {
  label: string;
  path: string;
  description: string;
}

/** One file's contents, or the reason they aren't shown. */
export interface FsDocument {
  path: string;
  name: string;
  kind: FsKind;
  sizeBytes: number;
  modifiedAt: string;
  text: string;
  /** The bytes aren't decodable text — show a preview or an explanation. */
  binary: boolean;
  /** Only the first slice was returned; saving would truncate the file. */
  truncated: boolean;
  /** Present when there's something to explain. Already phrased for a human. */
  detail: string;
  readOnly: boolean;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      // Non-JSON error body — the status line is all we have.
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export const filesApi = {
  roots: () => request<FsRoot[]>('/api/fs/roots'),

  list: (path: string, showHidden = false) =>
    request<FsListing>(
      `/api/fs/list?path=${encodeURIComponent(path)}&showHidden=${showHidden}`,
    ),

  read: (path: string) =>
    request<FsDocument>(`/api/fs/read?path=${encodeURIComponent(path)}`),

  /** URL for the raw bytes — handed straight to an <img src>, not fetched here. */
  rawUrl: (path: string) => `${API_BASE}/api/fs/raw?path=${encodeURIComponent(path)}`,

  write: (path: string, text: string) =>
    request<FsEntry>('/api/fs/write', {
      method: 'POST',
      body: JSON.stringify({ path, text }),
    }),

  create: (parent: string, name: string, kind: NewEntryKind) =>
    request<FsEntry>('/api/fs/create', {
      method: 'POST',
      body: JSON.stringify({ parent, name, kind }),
    }),

  /**
   * Describe one path without listing or reading it.
   *
   * The terminal's link provider is the caller this exists for: it sees a path
   * a tool printed and must choose between opening an editor and revealing a
   * folder. Guessing from the suffix is wrong for every extensionless
   * directory these tools produce.
   */
  stat: (path: string) =>
    request<FsEntry>(`/api/fs/stat?path=${encodeURIComponent(path)}`),

  /** Rename in place. `name` is a leaf — a separator in it is rejected. */
  rename: (path: string, name: string) =>
    request<FsEntry>('/api/fs/rename', {
      method: 'POST',
      body: JSON.stringify({ path, name }),
    }),

  move: (path: string, destination: string) =>
    request<FsEntry>('/api/fs/move', {
      method: 'POST',
      body: JSON.stringify({ path, destination }),
    }),

  trash: (path: string) =>
    request<FsTrashResult>('/api/fs/trash', {
      method: 'POST',
      body: JSON.stringify({ path }),
    }),

  restore: (token: string) =>
    request<FsEntry>('/api/fs/restore', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),
};
