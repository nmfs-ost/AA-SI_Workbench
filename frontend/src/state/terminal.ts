import { useSyncExternalStore } from 'react';

/**
 * Commands other panels want run in the interactive terminal.
 *
 * This exists because of a hard constraint on the AA-SI toolset: `aa-get` and
 * `aa-fetch` are *interactive* console UIs. They prompt, they expect a human,
 * and they cannot be driven headlessly from a job runner the way `aa-setup`
 * can. So the Workbench doesn't try. A panel composes the exact command, hands
 * it here, and the terminal panel types it into a real PTY where the user can
 * answer whatever it asks.
 *
 * A monotonic id rather than a queue: each request supersedes the last. Two
 * commands racing into one shell would interleave their prompts, which is worse
 * than the second one simply winning.
 */
export interface TerminalRequest {
  /** Bumped on every send so consumers can tell a re-send from a re-render. */
  id: number;
  command: string;
  /** Shown in the terminal before the command, explaining where it came from. */
  origin: string;
  /** Send the trailing newline, i.e. actually run it. */
  execute: boolean;
}

let request: TerminalRequest | null = null;
let counter = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * Ask the terminal to run a command. The caller is responsible for opening the
 * terminal panel — this store deliberately knows nothing about layout.
 */
export function sendToTerminal(
  command: string,
  options: { origin?: string; execute?: boolean } = {},
): void {
  counter += 1;
  request = {
    id: counter,
    command,
    origin: options.origin ?? '',
    execute: options.execute ?? true,
  };
  emit();
}

/** Called by the terminal once a request has been written to the PTY. */
export function clearTerminalRequest(id: number): void {
  if (request?.id === id) {
    request = null;
    emit();
  }
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): TerminalRequest | null {
  return request;
}

export function useTerminalRequest(): TerminalRequest | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** The current request, for imperative callers and tests. */
export function getTerminalRequest(): TerminalRequest | null {
  return request;
}
