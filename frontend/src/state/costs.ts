import { useSyncExternalStore } from 'react';

import { costsApi, type CostSummary, type Prices } from '../services/costsApi';
import { onGcpChange } from './gcp';

/**
 * Storage costs: the prices (read once per bucket, for the Products column)
 * and the folder the Storage costs panel is showing, with its totals.
 */

export interface CostsState {
  prices: Prices | null;
  pricesError: string;
  /** The folder summarised, relative to the bucket ('' for all of it). */
  scope: string;
  summary: CostSummary | null;
  loading: boolean;
  error: string;
  saving: boolean;
}

let state: CostsState = {
  prices: null,
  pricesError: '',
  scope: '',
  summary: null,
  loading: false,
  error: '',
  saving: false,
};
const listeners = new Set<() => void>();

function set(patch: Partial<CostsState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useCosts(): CostsState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => state,
  );
}

export function getCosts(): CostsState {
  return state;
}

let started = false;

/** Read the prices once (and again when another bucket is chosen). */
export function initCosts(): void {
  if (started) return;
  started = true;
  void loadPrices();
  onGcpChange(() => {
    set({ prices: null, summary: null, scope: '' });
    void loadPrices();
  });
}

export async function loadPrices(): Promise<void> {
  try {
    set({ prices: await costsApi.prices(), pricesError: '' });
  } catch (e) {
    set({ pricesError: e instanceof Error ? e.message : String(e) });
  }
}

let asked = 0;

/** Summarise a folder (relative to the bucket; '' for the whole bucket). */
export async function loadSummary(scope = state.scope, refresh = false): Promise<void> {
  const mine = ++asked;
  set({ scope, loading: true, error: '', ...(scope !== state.scope ? { summary: null } : {}) });
  try {
    const summary = await costsApi.summary(scope, refresh);
    if (mine !== asked) return;
    set({ summary, prices: summary.prices, loading: false });
  } catch (e) {
    if (mine !== asked) return;
    set({ loading: false, error: e instanceof Error ? e.message : String(e) });
  }
}

/** From Products: the storage cost of a folder. */
export function showCosts(scope: string): void {
  void loadSummary(scope.replace(/^\/+/, ''));
}

/** The team's own price ($ per GiB-month), or null for Google's list price. */
export async function setOwnPrice(perGiBMonth: number | null, label: string): Promise<void> {
  set({ saving: true, error: '' });
  try {
    const prices = await costsApi.setPrice(perGiBMonth, label);
    set({ prices, saving: false });
    if (state.summary) void loadSummary(state.scope);
  } catch (e) {
    set({ saving: false, error: e instanceof Error ? e.message : String(e) });
  }
}

export function _resetForTests(): void {
  state = { prices: null, pricesError: '', scope: '', summary: null, loading: false, error: '', saving: false };
  started = false;
}
