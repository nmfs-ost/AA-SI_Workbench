/**
 * Shell-quote a value only when it needs it, so command previews stay readable.
 *
 * Lived in `ncei/combineOptions.ts` until the recipes feature needed the same
 * rule; a cross-feature import from inside `ncei/` would have implied the
 * recipes feature depends on NCEI, which it does not. `combineOptions`
 * re-exports this, so its callers didn't move.
 */
export function quote(value: string): string {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}
