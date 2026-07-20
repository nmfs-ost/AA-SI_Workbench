/**
 * Client for /api/terminal.
 *
 * The session itself is a WebSocket carrying raw PTY bytes; this module only
 * covers the JSON side (can a terminal run here, and which virtualenvs exist)
 * plus building the socket URL.
 */

const API_BASE = (import.meta.env.VITE_AASI_API_BASE ?? '').replace(/\/$/, '');

export interface VenvInfo {
  name: string;
  path: string;
  pythonVersion: string;
  isCurrent: boolean;
  /** True when aa-* console tools are installed in this environment. */
  hasAaTools: boolean;
}

export interface TerminalInfo {
  available: boolean;
  disabledReason: string;
  shell: string;
  cwd: string;
  venvs: VenvInfo[];
  currentVenv: string;
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
      // Non-JSON error body.
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export interface SessionOptions {
  venv?: string;
  cwd?: string;
  rows: number;
  cols: number;
}

/**
 * Absolute ws:// URL for a session. The API is same-origin in every shipped
 * configuration, so the scheme is derived from the page rather than configured.
 */
export function terminalSocketUrl(options: SessionOptions): string {
  const base = API_BASE
    ? new URL(API_BASE, window.location.href)
    : new URL(window.location.href);
  const scheme = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const params = new URLSearchParams({
    rows: String(options.rows),
    cols: String(options.cols),
  });
  if (options.venv) params.set('venv', options.venv);
  if (options.cwd) params.set('cwd', options.cwd);
  return `${scheme}//${base.host}${base.pathname.replace(/\/$/, '')}/api/terminal/ws?${params}`;
}

export const terminalApi = {
  getInfo: () => request<TerminalInfo>('/api/terminal'),
  getVenvs: () => request<VenvInfo[]>('/api/terminal/venvs'),
};
