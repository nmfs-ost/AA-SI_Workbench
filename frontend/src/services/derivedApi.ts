/**
 * Client for /api/derived — the GCS bucket holding pipeline output.
 *
 * Mirrors backend/src/aa_si_workbench/api/derived.py verbatim (camelCase on the
 * wire). Read-only: listing only, no upload or delete.
 */

const API_BASE = (import.meta.env.VITE_AASI_API_BASE ?? '').replace(/\/$/, '');

export type DerivedKind =
  | 'folder'
  | 'netcdf'
  | 'zarr'
  | 'raw'
  | 'table'
  | 'region'
  | 'image'
  | 'text'
  | 'object';

export interface DerivedEntry {
  name: string;
  /** Path within the bucket, with any configured root prefix stripped. */
  path: string;
  /** gs://bucket/object — what a pipeline actually consumes. */
  uri: string;
  isDir: boolean;
  kind: DerivedKind;
  sizeBytes: number;
  updatedAt: string;
  contentType: string;
}

export interface DerivedListing {
  bucket: string;
  prefix: string;
  parent: string;
  entries: DerivedEntry[];
  truncated: boolean;
}

export interface DerivedStatus {
  bucket: string;
  project: string;
  prefix: string;
  configured: boolean;
  available: boolean;
  /** Why the bucket isn't reachable, phrased as something to act on. */
  detail: string;
  consoleUrl: string;
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

export const derivedApi = {
  getStatus: () => request<DerivedStatus>('/api/derived'),
  list: (prefix: string) =>
    request<DerivedListing>(`/api/derived/list?prefix=${encodeURIComponent(prefix)}`),
};
