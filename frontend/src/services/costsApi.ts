/**
 * Storage cost estimates (backend api/costs.py): the price per GiB-month for
 * the bucket's location and each storage class, and a folder's totals.
 */

import { ApiError } from './pipelinesApi';

const API_BASE = (import.meta.env.VITE_AASI_API_BASE ?? '').replace(/\/$/, '');

export type StorageClass = 'STANDARD' | 'NEARLINE' | 'COLDLINE' | 'ARCHIVE';

export interface Prices {
  bucket: string;
  location: string;
  locationType: string;
  defaultClass: string;
  /** The bucket's location could not be read: the prices are for an assumed one. */
  assumed: boolean;
  table: string;
  tableLabel: string;
  /** $ per GiB-month by class: what every figure uses. */
  perGiBMonth: Record<string, number>;
  /** Google's list price, for comparison when the team's own is set. */
  listPerGiBMonth: Record<string, number>;
  custom: number | null;
  customLabel: string;
  minimumDays: Record<string, number>;
  source: string;
  asOf: string;
  note: string;
}

export interface Share {
  name: string;
  path: string;
  objects: number;
  bytes: number;
  monthly: number;
}

export interface CostSummary {
  bucket: string;
  prefix: string;
  objects: number;
  bytes: number;
  monthly: number;
  yearly: number;
  byClass: Share[];
  byFolder: Share[];
  largest: Share[];
  prices: Prices;
  truncated: boolean;
  computedAt: string;
  seconds: number;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
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

export const costsApi = {
  prices: () => call<Prices>('/api/costs/prices'),
  summary: (prefix: string, refresh = false) =>
    call<CostSummary>(`/api/costs/summary?prefix=${encodeURIComponent(prefix)}&refresh=${refresh}`),
  setPrice: (perGiBMonth: number | null, label = '') =>
    call<Prices>('/api/costs/price', { method: 'PUT', body: JSON.stringify({ perGiBMonth, label }) }),
};

/* ------------------------------------------------------------------ */
/* Arithmetic and words                                                */
/* ------------------------------------------------------------------ */

const GIB = 1024 ** 3;

/** $ a month to keep `bytes` in this class, at these prices. */
export function monthlyCost(bytes: number, storageClass: string, prices: Prices): number {
  const rate = prices.perGiBMonth[(storageClass || 'STANDARD').toUpperCase()] ?? prices.perGiBMonth.STANDARD ?? 0;
  return (bytes / GIB) * rate;
}

/**
 * Dollars and cents: "$1,234", "$12.34", "$0.43"; under a cent "<$0.01"
 * (the exact figure is in the tooltip), nothing at all "$0.00".
 */
export function formatMoney(value: number, { exact = false } = {}): string {
  if (!Number.isFinite(value)) return '—';
  if (value === 0) return '$0.00';
  if (exact) {
    const digits = value >= 1 ? 2 : Math.min(6, 2 - Math.floor(Math.log10(value)));
    return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: Math.max(2, digits) })}`;
  }
  if (value < 0.01) return '<$0.01';
  if (value >= 1000) return `$${Math.round(value).toLocaleString('en-US')}`;
  return `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "$0.020 per GiB-month" */
export function formatRate(rate: number): string {
  return `$${rate.toFixed(rate >= 0.01 ? 3 : 4)} per GiB-month`;
}

export const CLASS_LABEL: Record<string, string> = {
  STANDARD: 'Standard',
  NEARLINE: 'Nearline',
  COLDLINE: 'Coldline',
  ARCHIVE: 'Archive',
};
