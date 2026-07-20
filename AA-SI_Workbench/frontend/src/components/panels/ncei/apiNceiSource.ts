/**
 * Real NCEI data source — implements `NceiCatalogSource` by calling the backend
 * API (backend/src/aa_si_workbench/api/ncei.py). The API returns JSON that
 * matches the frontend types exactly, so there's no remapping here.
 *
 * Base URL comes from `VITE_AASI_API_BASE`; when unset it's empty, so requests
 * go to same-origin `/api/...` and are forwarded by the Vite dev proxy (see
 * vite.config.ts). This source is only used when `VITE_AASI_USE_API === 'true'`
 * (wired in nceiService.ts); otherwise the mock source is used.
 */

import type { RawFile, SonarModel, Survey, Vessel } from './nceiTypes';
import type { NceiCatalogSource } from './nceiService';

const API_BASE = import.meta.env.VITE_AASI_API_BASE ?? '';

async function getJSON<T>(path: string): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { Accept: 'application/json' },
    });
  } catch (e) {
    throw new Error(`Cannot reach the Workbench API — is the backend running? (${(e as Error).message})`);
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`API ${res.status} ${res.statusText}${detail ? `: ${detail}` : ''}`);
  }
  return (await res.json()) as T;
}

function query(params: Record<string, string>): string {
  return new URLSearchParams(params).toString();
}

export const apiNceiSource: NceiCatalogSource = {
  listVessels: () => getJSON<Vessel[]>('/api/ncei/vessels'),
  listSurveys: (vesselId) =>
    getJSON<Survey[]>(`/api/ncei/surveys?${query({ vessel: vesselId })}`),
  listSonars: (vesselId, surveyId) =>
    getJSON<SonarModel[]>(
      `/api/ncei/sonars?${query({ vessel: vesselId, survey: surveyId })}`,
    ),
  listRawFiles: (vesselId, surveyId, sonarId) =>
    getJSON<RawFile[]>(
      `/api/ncei/files?${query({ vessel: vesselId, survey: surveyId, sonar: sonarId })}`,
    ),
  listChannels: (sonarId) =>
    getJSON<string[]>(`/api/ncei/channels?${query({ sonar: sonarId })}`),
};
