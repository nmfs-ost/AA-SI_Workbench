/**
 * Client for /api/tools — what the installed tools say about themselves.
 *
 * Mirrors backend/src/aa_si_workbench/api/tools.py (camelCase on the wire).
 *
 * Discovery is layered and automatic. Almost no tool answers `--describe`, so
 * relying on it meant reporting "unknown" for nearly everything and asking the
 * user to run `--help` by hand. Instead the backend reads each tool's own
 * source with `ast` — no import, no execution — and lays the hand-written
 * `--help` prose over the top. Between them, every installed tool resolves.
 *
 * `discovery` says which layer answered, and `param.origin` says it per flag.
 */

const API_BASE = (import.meta.env.VITE_AASI_API_BASE ?? '').replace(/\/$/, '');

/** Which layer produced a fact. */
export type DiscoveryLayer = 'describe' | 'source' | 'help' | 'none';

export interface ParamInfo {
  id: string;
  flags: string[];
  positional: boolean;
  type: 'boolean' | 'number' | 'string' | 'enum';
  default: string | number | boolean | null;
  choices: string[];
  required: boolean;
  nargs: string;
  help: string;
  section: string;
  origin: 'describe' | 'source' | 'help';
}

export interface ToolDescription {
  name: string;
  version: string;
  distribution: string;
  path: string;
  /** The best layer that answered for this tool. */
  discovery: DiscoveryLayer;
  sourceFile: string;
  params: ParamInfo[];
  summary: string;
  describe: Record<string, unknown> | null;
  detail: string;
}

export interface ToolCatalogResponse {
  tools: ToolDescription[];
  total: number;
  /** How many yielded at least one parameter from any layer. */
  discovered: number;
  byLayer: Record<string, number>;
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
