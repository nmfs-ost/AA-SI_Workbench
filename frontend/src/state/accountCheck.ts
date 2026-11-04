import { useSyncExternalStore } from 'react';

import { identityApi, type AccountCheck, type CheckState } from '../services/identityApi';
import { loadIdentity } from './identity';

/**
 * The account check: who the Workbench names your folder after, who the aa-*
 * tools upload as, and what the chosen bucket allows (backend identity.py).
 *
 * Asked once when the shell starts, so a problem shows in the status bar
 * before anything is run, and again on "Check again" (after the user has run
 * a fix in the terminal), which also re-reads the identity the rest of the
 * Workbench uses. Like the identity, it predicts and explains; GCP decides.
 */

export interface AccountCheckState {
  check: AccountCheck | null;
  loading: boolean;
  /** Why the check couldn't be asked; not a check result. */
  error: string;
}

let state: AccountCheckState = { check: null, loading: false, error: '' };
const listeners = new Set<() => void>();
let pending: Promise<void> | null = null;

function emit(next: AccountCheckState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): AccountCheckState {
  return state;
}

/** Ask once; `again` re-detects the account (after a fix) and re-asks Google. */
export function loadAccountCheck(again = false): Promise<void> {
  if (pending) return pending;
  if (state.check && !again) return Promise.resolve();
  emit({ ...state, loading: true });
  pending = identityApi
    .check(again)
    .then(async (check) => {
      emit({ check, loading: false, error: '' });
      if (again) await loadIdentity(true);
    })
    .catch((error: unknown) => {
      emit({
        check: state.check,
        loading: false,
        error: error instanceof Error ? error.message : 'Could not run the account check.',
      });
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function useAccountCheck(): AccountCheckState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

/** For tests. */
export function resetAccountCheck(): void {
  pending = null;
  emit({ check: null, loading: false, error: '' });
}

export interface AccountSummary {
  /** How the status bar colours the account. */
  tone: CheckState;
  /** What it says. */
  text: string;
  /** Its tooltip: the first problem, or that everything checked out. */
  tooltip: string;
}

/**
 * What the status bar says about the account. Before the check has answered,
 * the identity alone (no account is a warning); after, the check's worst
 * state, with its first problem as the tooltip.
 */
export function accountSummary(
  principal: string,
  identityDetail: string,
  check: AccountCheck | null,
): AccountSummary {
  const text = principal || 'No account';
  if (!check) {
    return {
      tone: principal ? 'ok' : 'warn',
      text,
      tooltip: identityDetail || (principal ? `Signed in as ${principal}` : ''),
    };
  }
  const problem = check.checks.find((item) => item.state === 'fail')
    ?? check.checks.find((item) => item.state === 'warn')
    ?? check.checks.find((item) => item.state === 'unknown');
  const tooltip = problem
    ? `${problem.label}: ${problem.detail} Click for the account check.`
    : `Account check passed: ${check.principal}, uploads as ${check.uploader || 'you'}, `
      + `${check.folder ? `products in ${check.folder}` : 'bucket readable and writable'}. Click for details.`;
  return { tone: check.state, text, tooltip };
}
