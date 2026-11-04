/**
 * Prepare requests from other apps (backend api/remote.py, whose docstring is
 * the one to read): which accounts may start a run on this workstation, and
 * the requests that came in.
 */

const API_BASE = import.meta.env.VITE_AASI_API_BASE ?? '';

export interface RemoteCard {
  source: string;
  vessel: string;
  survey: string;
  sonar: string;
  start: string;
  end: string;
  streamed: boolean;
  format: 'nc' | 'zarr';
  sv: boolean;
  echogram: boolean;
  base: string;
  note: string;
}

export interface RemoteSettings {
  enabled: boolean;
  accounts: string[];
  acceptGcloudTokens: boolean;
}

export type RemoteStatus = 'started' | 'held' | 'starting' | 'refused' | 'discarded';

export interface RemoteRequest {
  id: string;
  receivedAt: string;
  caller: string;
  status: RemoteStatus;
  detail: string;
  card: RemoteCard;
  runId: string;
  base: string;
  destination: string;
  decidedAt: string;
}

export interface RemoteState {
  settings: RemoteSettings;
  url: string;
  audience: string;
  requests: RemoteRequest[];
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}/api/remote${path}`, {
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      /* not JSON */
    }
    throw new Error(detail);
  }
  return (await response.json()) as T;
}

export const remoteApi = {
  state: () => call<RemoteState>('/state'),
  save: (settings: RemoteSettings) =>
    call<RemoteState>('/settings', { method: 'POST', body: JSON.stringify(settings) }),
  run: (id: string) => call<RemoteRequest>(`/requests/${encodeURIComponent(id)}/run`, { method: 'POST' }),
  allow: (id: string) => call<RemoteRequest>(`/requests/${encodeURIComponent(id)}/allow`, { method: 'POST' }),
  discard: (id: string) =>
    call<RemoteRequest>(`/requests/${encodeURIComponent(id)}/discard`, { method: 'POST' }),
};

/** Addresses as the list keeps them: trimmed, lower case, no repeats, no blanks. */
export function cleanAccounts(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/[\s,;]+/)) {
    const email = line.trim().toLowerCase();
    if (email && !out.includes(email)) out.push(email);
  }
  return out;
}

/** What a request asks for, in a line. */
export function describeCard(card: RemoteCard): string {
  const what = card.sv ? 'EchoData and Sv' : 'EchoData';
  const how = card.streamed ? 'Zarr, file by file into the bucket' : card.format === 'zarr' ? 'Zarr' : 'NetCDF';
  const from = card.source && card.source !== 'ncei' ? ` from ${card.source}` : '';
  const named = card.base ? `, named ${card.base}` : '';
  return `${card.vessel} ${card.survey} ${card.sonar}${from}, ${card.start} to ${card.end} UTC: ${what} (${how})${named}`;
}
