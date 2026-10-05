/**
 * Shell-quote a value only when it needs it, so command previews stay readable.
 *
 * Shared by the recipes feature, the Prepare card and the Files and Derived
 * panels.
 */
export function quote(value: string): string {
  return /^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : `"${value.replace(/"/g, '\\"')}"`;
}
