/**
 * Client for /api/tools — what the installed tools say about themselves.
 *
 * Mirrors backend/src/aa_si_workbench/api/tools.py (camelCase on the wire).
 *
 * The point of this endpoint is to make `toolCatalog.ts` a fallback rather than
 * the source of truth. A tool that answers `--describe` has had its flags,
 * defaults and choices read off its own argparse parser, so they cannot
 * disagree with what it accepts. A tool that does not answer is reported with
 * `supported: false` and a reason, which is what lets the UI badge a
 * hand-written entry honestly instead of rendering a guess as fact.
 */

const API_BASE = (import.meta.env.VITE_AASI_API_BASE ?? '').replace(/\/$/, '');

export interface ToolDescription {
  name: string;
  version: string;
  /** False when the tool has no --describe. Fall back to the catalogue. */
  supported: boolean;
  /** Why it is unsupported, or why the payload was rejected. */
  detail: string;
  /** The tool's verbatim --describe payload. */
  describe: Record<string, unknown> | null;
  /** Set when the payload's schema is not one this build recognises. */
  schemaWarning: string;
}

export interface ToolCatalogResponse {
  tools: ToolDescription[];
  described: number;
  total: number;
  generatedAt: string;
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
    const body = await res.text().catch(() => '');
    let detail = body;
    try {
      const parsed = JSON.parse(body) as { detail?: string };
      if (parsed.detail) detail = parsed.detail;
    } catch {
      /* not JSON — keep the raw text */
    }
    throw new Error(detail || `API ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export const toolsApi = {
  /** `refresh` re-probes; otherwise the server answers from its cache. */
  describeAll: (refresh = false) =>
    request<ToolCatalogResponse>(`/api/tools/describe${refresh ? '?refresh=true' : ''}`),
};
