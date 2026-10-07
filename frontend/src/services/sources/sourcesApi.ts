/**
 * Data sources: where Prepare EchoData's raw files come from (NCEI, OMAO, and
 * archives added later). The backend's /api/sources (sources.py) lists them
 * and answers each one's vessel → survey → echosounder → raw files drill-down,
 * so the card asks every source the same four questions.
 *
 * Without the API (`VITE_AASI_USE_API` unset), NCEI answers from the sample
 * catalogue and OMAO is shown as not connected, as on a fresh install.
 */

import type { RawFile, SonarModel, Survey, Vessel } from '../ncei/nceiTypes';
import { mockNceiSource } from '../ncei/nceiService';
import type { NceiCatalogSource } from '../ncei/nceiService';
import { ApiError } from '../pipelinesApi';

const API_BASE = import.meta.env.VITE_AASI_API_BASE ?? '';
const USE_API = import.meta.env.VITE_AASI_USE_API === 'true';

export interface DataSource {
  id: string;
  name: string;
  /** ncei | archive (or a kind the backend registers). */
  kind: string;
  description: string;
  /** An archive's location: gs://bucket/folder or a folder on the workstation. */
  root: string;
  /** Folders below the root, e.g. "{vessel}/{survey}/{sonar}". */
  layout: string;
  /** The echosounder of an archive without a folder per echosounder. */
  sonar: string;
  builtin: boolean;
  ready: boolean;
  /** Why it is not ready, or how it is listed. */
  detail: string;
  /** How its files are fetched: aa-fetch | aa-download | cp ('' : not yet). */
  fetch: string;
  /** Where one echosounder's files are, with {vessel} {survey} {sonar}. */
  where: string;
}

/** What the Sources dialog sends to add a source or set where one is. */
export interface SourceConfig {
  id: string;
  name?: string;
  kind?: string;
  description?: string;
  root: string;
  layout?: string;
  sonar?: string;
}

export const DEFAULT_LAYOUT = '{vessel}/{survey}/{sonar}';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  } catch {
    throw new Error('Could not reach the Workbench server.');
  }
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = (await response.json()) as { detail?: unknown };
      if (typeof body?.detail === 'string') detail = body.detail;
    } catch {
      /* the status line is all there is */
    }
    throw new ApiError(detail, response.status);
  }
  return (await response.json()) as T;
}

const SAMPLE: DataSource[] = [
  {
    id: 'ncei',
    name: 'NCEI',
    kind: 'ncei',
    description: "NOAA NCEI's public water-column archive (noaa-wcsd-pds).",
    root: '',
    layout: DEFAULT_LAYOUT,
    sonar: '',
    builtin: true,
    ready: true,
    detail: 'Sample catalogue (no server).',
    fetch: 'aa-fetch',
    where: 's3://noaa-wcsd-pds/data/raw/{vessel}/{survey}/{sonar}/',
  },
  {
    id: 'omao',
    name: 'OMAO',
    kind: 'archive',
    description: "NOAA Office of Marine and Aviation Operations: the fleet's own archive of raw files.",
    root: '',
    layout: DEFAULT_LAYOUT,
    sonar: '',
    builtin: true,
    ready: false,
    detail: 'OMAO is not connected yet: set where its raw files are kept (a gs:// folder, or a folder on this machine).',
    fetch: '',
    where: '',
  },
];

const path = (id: string) => `/api/sources/${encodeURIComponent(id)}`;

export const sourcesApi = {
  list: (): Promise<DataSource[]> => (USE_API ? call<DataSource[]>('/api/sources') : Promise.resolve(SAMPLE)),
  save: (config: SourceConfig): Promise<DataSource> =>
    USE_API
      ? call<DataSource>(path(config.id), { method: 'PUT', body: JSON.stringify(config) })
      : Promise.reject(new Error('Sources are configured on the Workbench server.')),
  remove: (id: string): Promise<{ ok: boolean }> =>
    USE_API
      ? call<{ ok: boolean }>(path(id), { method: 'DELETE' })
      : Promise.reject(new Error('Sources are configured on the Workbench server.')),
};

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

/** The drill-down of one source: the same four questions for every source. */
export function catalogFor(sourceId: string): NceiCatalogSource {
  if (!USE_API) {
    if (sourceId === 'ncei') return mockNceiSource;
    const none = () => Promise.reject(new Error('Not connected (sample data only).'));
    return { listVessels: none, listSurveys: none, listSonars: none, listRawFiles: none };
  }
  const base = path(sourceId);
  return {
    listVessels: () => call<Vessel[]>(`${base}/vessels`),
    listSurveys: (vesselId) => call<Survey[]>(`${base}/surveys?${query({ vessel: vesselId })}`),
    listSonars: (vesselId, surveyId) =>
      call<SonarModel[]>(`${base}/sonars?${query({ vessel: vesselId, survey: surveyId })}`),
    listRawFiles: (vesselId, surveyId, sonarId) =>
      call<RawFile[]>(`${base}/files?${query({ vessel: vesselId, survey: surveyId, sonar: sonarId })}`),
  };
}

/** Where one echosounder's files are, for the card's hint. */
export function whereFiles(source: DataSource | undefined, vessel: string, survey: string, sonar: string): string {
  if (!source?.where) return '';
  return source.where.replace('{vessel}', vessel).replace('{survey}', survey).replace('{sonar}', sonar);
}
