import { useSyncExternalStore } from 'react';

/**
 * Which system the shared Configuration panel is showing.
 *
 * Pipelines and Recipes are two independent systems with two independent
 * stores, and neither imports the other — that separation is deliberate and
 * worth keeping. But there is one Configuration tab in the right dock, and
 * *something* has to decide whose item it renders when both systems have an
 * active card.
 *
 * That something is DockLayout, the chrome that already subscribes to both
 * stores to front the Configuration panel: whichever store's active id changed
 * most recently writes this value. Keeping the arbitration in chrome means the
 * two feature stores stay ignorant of each other, and every path that
 * activates a pipeline (card click, edit button, creating a new one) flows
 * through the same subscription — no per-call-site bookkeeping to forget.
 */

export type ConfigurationFocus = 'pipelines' | 'recipes';

let focus: ConfigurationFocus = 'pipelines';
const listeners = new Set<() => void>();

export function getConfigurationFocus(): ConfigurationFocus {
  return focus;
}

export function setConfigurationFocus(next: ConfigurationFocus): void {
  if (focus === next) return;
  focus = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useConfigurationFocus(): ConfigurationFocus {
  return useSyncExternalStore(subscribe, getConfigurationFocus, getConfigurationFocus);
}
