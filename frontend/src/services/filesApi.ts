/**
 * Client for /api/fs — the workstation's own filesystem.
 *
 * Mirrors backend/src/aa_si_workbench/api/files.py verbatim (camelCase on the
 * wire). Listing is read-only and confined server-side to AASI_FS_ROOT.
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
  | 'file';

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

async function request<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Accept: 'application/json' },
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
};
