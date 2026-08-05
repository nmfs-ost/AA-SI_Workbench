/**
 * Client for /api/store — `aa-store info` and `aa-store verify`.
 *
 * The types below are transcribed from what `aa_store.py` actually prints, not
 * from the architecture note. Two places they differ, both worth knowing:
 *
 *  • The note lists `chunkCount`, `bytes`, `dtype`, `scale`, `offset`, `shards`
 *    as fields "beyond the handle fields". The tool emits them flat at the top
 *    level *and* keeps `schema: "aa/1"`, so an info line is a handle with extra
 *    keys. That is why `StoreSummary` extends the handle shape rather than
 *    wrapping it.
 *  • Where a store is sharded, `chunkCount.written` is null and an `objects`
 *    block appears instead — proving an inner chunk exists means decoding the
 *    shard index, which is a read of the data rather than of metadata. Every
 *    count here is therefore `number | null`, and null means *unknown*, never
 *    zero. Rendering an unknown as 0% would be a lie about a store that is
 *    probably fine.
 *
 * Read-only. Nothing in this module can modify a store, which is what makes it
 * safe to call the moment a row is selected rather than behind a button.
 */

const API_BASE = (import.meta.env.VITE_AASI_API_BASE ?? '').replace(/\/$/, '');

/** Per-array detail, present only under `--arrays`. */
export interface StoreArray {
  path: string;
  shape: number[];
  chunks: number[];
  shards: number[] | null;
  dtype: string;
  fillValue: unknown;
  codec: string;
  zarrFormat: number;
  chunkCount: { expected: number; written: number | null };
  bytes: { stored: number | null; logical: number };
  /** Sharded arrays only: the shard census, since chunks can't be counted. */
  objects?: { expected: number; written: number | null };
  note?: string;
}

/** The write marker `aa-combine` stamps on success and from its SIGTERM handler. */
export interface WriteMarker {
  complete?: boolean;
  tool?: string;
  version?: string;
  at?: string;
  inputs?: number;
}

export interface StoreProvenance {
  tool?: string;
  version?: string;
  /** Plural, per decision 1. A combined store has many. */
  parents?: string[];
  at?: string;
}

export interface StoreVerdict {
  ok: boolean;
  exit: number;
  /** Findings that set the exit code. */
  problems: string[];
  /** Things worth saying that are not findings. */
  notes: string[];
  checkedAt: string;
}

/**
 * `aa-store info --json` output: an `aa/1` handle carrying extra keys.
 * Every field past `schema`/`uri` is optional because the tool omits what it
 * cannot determine rather than emitting a placeholder.
 */
export interface StoreSummary {
  schema: string;
  kind: string;
  uri: string;
  zarrFormat: number | null;
  consolidated: boolean;
  group: string | null;
  dims?: Record<string, number>;
  chunks?: number[];
  shards?: number[] | null;
  dtype?: string;
  codec?: string;
  primaryArray?: string;
  /** Present when the producer wrote packed integers. Ignoring these reads
      numbers wrong by two orders of magnitude and plausible-looking. */
  scale?: number;
  offset?: number;
  chunkCount?: { expected: number; written: number | null };
  bytes?: { stored: number; logical: number };
  objects?: number;
  census?: { partial: boolean; limit: number };
  arrayCount?: number;
  arrays?: StoreArray[];
  write?: WriteMarker;
  provenance?: StoreProvenance;
  report?: string;
  layout?: string;
  variantOf?: string;
  time?: [string, string] | string[];
  /** Present only from `verify`. */
  verify?: StoreVerdict;
}

export interface StoreResult {
  uri: string;
  /** 0 ok · 1 unreadable · 2 usage · 3 unfinished (resumable) · 4 verified wrong */
  exitCode: number;
  ok: boolean;
  log: string[];
  summary: StoreSummary | null;
  error: string;
}

async function request<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, { headers: { Accept: 'application/json' } });
  } catch (e) {
    throw new Error(
      `Cannot reach the Workbench API — is the backend running? (${(e as Error).message})`,
    );
  }
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { detail?: string };
      if (body?.detail) detail = body.detail;
    } catch {
      /* non-JSON error body — the status line is all we have */
    }
    throw new Error(detail);
  }
  return (await res.json()) as T;
}

export interface StoreQuery {
  census?: boolean;
  arrays?: boolean;
  strict?: boolean;
}

function query(uri: string, options: StoreQuery): string {
  const params = new URLSearchParams({ uri });
  if (options.census === false) params.set('census', 'false');
  if (options.arrays) params.set('arrays', 'true');
  if (options.strict) params.set('strict', 'true');
  return params.toString();
}

export const storeApi = {
  info: (uri: string, options: StoreQuery = {}) =>
    request<StoreResult>(`/api/store/info?${query(uri, options)}`),
  verify: (uri: string, options: StoreQuery = {}) =>
    request<StoreResult>(`/api/store/verify?${query(uri, options)}`),
};

/* ------------------------------------------------------------------ */
/* The two ratios                                                      */
/* ------------------------------------------------------------------ */
/**
 * Derived here rather than on the server, so what crosses the wire stays a
 * handle the next tool could read. Both return null for *unknown* — a sharded
 * store or `--no-census` — which the panel must render as "not counted" rather
 * than as zero.
 */

/** chunkCount.written / expected. Below 1 is sparsity, or an unfinished write. */
export function sparsity(summary: StoreSummary | null): number | null {
  const counts = summary?.chunkCount;
  if (!counts || counts.written === null || !counts.expected) return null;
  return counts.written / counts.expected;
}

/** bytes.stored / logical. The compression the codec and layout are buying. */
export function compression(summary: StoreSummary | null): number | null {
  const bytes = summary?.bytes;
  if (!bytes || !bytes.logical) return null;
  return bytes.stored / bytes.logical;
}

/** Bytes as a short human string. Mirrors the Derived panel's formatting. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

/** A count with thousands separators, or an em dash when it is unknown. */
export function formatCount(value: number | null | undefined): string {
  return value === null || value === undefined ? '—' : value.toLocaleString();
}
