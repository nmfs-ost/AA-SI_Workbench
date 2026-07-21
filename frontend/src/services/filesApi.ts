/**
 * Client for /api/fs — the workstation's own filesystem.
 *
 * Mirrors backend/src/aa_si_workbench/api/files.py verbatim (camelCase on the
 * wire). Every path is confined server-side to AASI_FS_ROOT; nothing here
 * re-checks that, because a client-side boundary check would be decoration.
 *
 * Reading and listing are unconditional. Writing exists but is narrow on
 * purpose — save an open file, create a new one. There is no delete or move,
 * here or on the server.
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
  /** Number of children, or -1 when not counted (unreadable, or not a folder). */
  childCount: number;
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
};
