import { useSyncExternalStore } from 'react';

import type { LayerKind } from '../types/layers';

/**
 * The thing the right dock is currently describing.
 *
 * Every panel in the right dock answers a question about one subject —
 * Metadata: what is it, Configuration: how shall it run, Calibration: with what
 * physics, Processing Queue: what happened. Until now three of the four read
 * `activeAsset`, which could only ever hold an NCEI raw file, and the fourth
 * read nothing. So selecting a combined store in the Derived panel changed
 * nothing anywhere: the left dock could find the artifact of the entire
 * acquire → convert → assemble sector and the right dock had no way to be
 * about it.
 *
 * This widens the subject rather than adding a parallel store beside it,
 * because two stores would mean every panel deciding which one wins and four
 * places to get that wrong.
 *
 * Carrying `layer` is the part that earns its keep. It is the same `LayerKind`
 * the tool catalogue and a handle use, so a panel can compare what is selected
 * against what a stage consumes and say "this pipeline reads raw, you have
 * selected an l1 store" instead of building a command that fails a minute later
 * inside echopype.
 *
 * `activeAsset.ts` remains the NCEI-shaped view of this, so nothing that
 * already reads it had to change.
 */

/** NCEI catalogue metadata. Unchanged shape — this is what NCEI search produces. */
export interface AssetMetadata {
  fileName: string;
  vessel: string;
  survey: string;
  sonar: string;
  sizeBytes: number;
  acquiredAt: string; // ISO 8601
  channels: string[];
  /** NCEI S3 object key, e.g. data/raw/{vessel}/{survey}/{sonar}/{file}. */
  s3Path: string;
  source: 'NCEI';
}

/**
 * Which panel the selection came from. Rendered as a chip in the inspector, so
 * a reader can tell a store they clicked in the bucket from the same store
 * arrived at by clicking the path a tool printed.
 *
 * 'Terminal' is the fourth: the terminal's links select a subject exactly as
 * the browsers do, and reporting one of the others would be a small lie in the
 * one place whose whole job is saying where something came from.
 */
export type SubjectOrigin = 'NCEI' | 'Derived' | 'Files' | 'Terminal';

export interface ActiveSubject {
  /**
   * Absolute and schemed. A subject must never carry a bare path: it would
   * resolve against whatever directory the reader happens to be in, which is a
   * bug that only surfaces once it crosses a machine — the same reason the
   * tools normalise handles to URIs.
   */
  uri: string;
  /** What to show: a file name, or a store name. */
  label: string;
  /** Where in the processing stack this sits. See types/layers.ts. */
  layer: LayerKind;
  origin: SubjectOrigin;
  /**
   * True when this is a Zarr store, and therefore something `aa-store` can
   * describe. Kept as a flag rather than inferred from `layer` because an L1
   * store and an Sv store are both inspectable and neither is the other.
   */
  inspectable: boolean;
  /** Present only for an NCEI selection. */
  asset?: AssetMetadata;
}

let current: ActiveSubject | null = null;
const listeners = new Set<() => void>();

function emit(next: ActiveSubject | null): void {
  current = next;
  listeners.forEach((listener) => listener());
}

export function setActiveSubject(subject: ActiveSubject | null): void {
  emit(subject);
}

/** Select an NCEI catalogue file. Called by the NCEI panel. */
export function setActiveAsset(asset: AssetMetadata | null): void {
  if (!asset) {
    emit(null);
    return;
  }
  emit({
    uri: `s3://noaa-wcsd-pds/${asset.s3Path}`,
    label: asset.fileName,
    layer: 'raw',
    origin: 'NCEI',
    inspectable: false,
    asset,
  });
}

/**
 * Select a derived or local artifact. Called by the Derived and Files panels.
 *
 * The layer is inferred from the suffix, which is the only thing available at
 * selection time — the store's own `aa_kind` attribute is authoritative but
 * reading it costs a round trip, and the Metadata panel corrects this from
 * `aa-store info` the moment that returns. Guessing here and correcting there
 * is better than blocking selection on a describe.
 */
export function setActiveArtifact(input: {
  uri: string;
  label: string;
  origin: SubjectOrigin;
  kind?: string;
}): void {
  const lowered = input.label.toLowerCase();
  const zarr = input.kind === 'zarr' || lowered.endsWith('.zarr');
  const netcdf = lowered.endsWith('.nc') || lowered.endsWith('.netcdf4');
  emit({
    uri: input.uri,
    label: input.label,
    layer: zarr ? 'l1' : netcdf ? 'netcdf' : 'raw',
    origin: input.origin,
    inspectable: zarr,
    asset: undefined,
  });
}

/**
 * Correct the layer once a describe has come back.
 *
 * `aa-store info` reports the store's own `kind` from its root attributes, and
 * a store annotated `sv` or `mask` was mislabelled `l1` by the suffix guess
 * above. Narrow rather than replace: the identity is the uri and it has not
 * changed, so a full re-set would be a second selection event for the same
 * selection.
 */
export function refineActiveLayer(uri: string, layer: LayerKind): void {
  if (!current || current.uri !== uri || current.layer === layer) return;
  emit({ ...current, layer });
}

function getSnapshot(): ActiveSubject | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Subscribe a component to the active subject. */
export function useActiveSubject(): ActiveSubject | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
