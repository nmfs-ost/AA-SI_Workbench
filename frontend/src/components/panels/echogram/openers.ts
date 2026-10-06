/**
 * Which products open where. One place, so Products, a run's outputs and the
 * Dataflow panel all offer the same thing for the same product.
 */

/** Kinds aa-tiles can draw (and the tile pack itself). */
const ECHOGRAM_KINDS = new Set(['sv', 'mvbs', 'mask', 'noise', 'ts', 'tiles']);

export function opensAsEchogram(kind: string, name = ''): boolean {
  return ECHOGRAM_KINDS.has(kind) || name.toLowerCase().endsWith('.tiles');
}

/** An integration export, or any CSV the Results table can show. */
export function opensAsResults(kind: string, name = ''): boolean {
  return kind === 'integration' || name.toLowerCase().endsWith('.csv');
}

/** Lines and regions open on the echogram they were drawn on. */
export function isAnnotation(kind: string, name = ''): boolean {
  const lowered = name.toLowerCase();
  return kind === 'lines' || kind === 'regions' || lowered.endsWith('.evl') || lowered.endsWith('.evr');
}
