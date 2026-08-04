/**
 * The layer vocabulary — what a tool consumes and what it produces.
 *
 * This replaces the ad-hoc `'raw' | 'nc' | 'sv' | 'image'` union that used to
 * live in `toolCatalog.ts` and be read by nothing. Two things were wrong with
 * it beyond being dead:
 *
 *   1. It had no MVBS, no mask, no regions, no lines, no NASC — the products
 *      the processing stack actually accumulates.
 *   2. It spelled L1 as `'nc'`, which folds the *converted layer* together
 *      with the *NetCDF file format*. Those are different things and treating
 *      them as one is what makes NetCDF look like a storage decision. It is an
 *      export decision: `aa-export` produces `netcdf`, and nothing consumes it,
 *      because anything downstream reads the store instead.
 *
 * Chunked stores are Zarr. Sparse, irregular products (regions, lines, NASC)
 * are tabular and live in Parquet — the distinction matters here because it
 * decides whether a handle can carry `dims`/`chunks` at all.
 *
 * ── Reading this, not just declaring it ─────────────────────────────────────
 * Three call sites, and adding a fourth should not need a change here:
 *   • NewPipelineDialog — flags a stage whose input nothing upstream produces.
 *   • PipelineRunControls / PipelineCard — states what a pipeline needs.
 *   • Metadata / Derived — badge and icon per kind.
 * ────────────────────────────────────────────────────────────────────────────
 */

/**
 * One layer of the processing stack, or a non-layer artifact a tool can emit.
 *
 * `any` and `none` are not layers; they are the escape hatches for the freeform
 * shell stage and for tools that terminate a chain.
 */
export type LayerKind =
  // The stack, in the order it is produced.
  | 'raw' // EK60/EK80 native. Archival truth; never converted away.
  | 'l1' // Converted EchoData. A regenerable cache, kept because conversion is slow.
  | 'sv' // Calibrated volume backscattering strength. The dense entry point.
  | 'mvbs' // Binned Sv. Small, analysis-ready, the source for pyramids.
  | 'mask' // Same grid and chunks as Sv. Compresses hard; empty chunks cost nothing.
  // Sparse, irregular, frequently re-derived — tabular rather than gridded.
  | 'regions'
  | 'lines'
  | 'nasc'
  // Artifacts that are not a layer of the stack.
  | 'catalog' // Survey-level manifest. A build artifact, not a live query.
  | 'plan' // A dry-run estimate: chunk counts, bytes, time.
  | 'report' // QC output — seams, dropped pings, clock jumps.
  | 'netcdf' // An export, not a storage layer. Consumed by nothing here.
  | 'image'
  // Escape hatches.
  | 'none'
  | 'any';

/** How a kind is physically stored. Decides whether it has dims and chunks. */
export type Storage = 'native' | 'zarr' | 'parquet' | 'json' | 'file' | 'none';

export interface LayerInfo {
  id: LayerKind;
  /** Short label for a chip or badge. */
  label: string;
  /** One line, in terms of what it is for rather than what it contains. */
  description: string;
  storage: Storage;
  /** True for the dense gridded layers — the ones with dims and a chunk shape. */
  gridded: boolean;
}

export const LAYERS: Readonly<Record<LayerKind, LayerInfo>> = {
  raw: {
    id: 'raw',
    label: 'Raw',
    description: 'Native EK60/EK80 acquisition files. Archival truth.',
    storage: 'native',
    gridded: false,
  },
  l1: {
    id: 'l1',
    label: 'L1',
    description: 'Converted EchoData. Regenerable, but slow enough to keep.',
    storage: 'zarr',
    gridded: true,
  },
  sv: {
    id: 'sv',
    label: 'Sv',
    description: 'Calibrated volume backscatter. The dense entry point.',
    storage: 'zarr',
    gridded: true,
  },
  mvbs: {
    id: 'mvbs',
    label: 'MVBS',
    description: 'Binned Sv — small, analysis-ready, the source for pyramids.',
    storage: 'zarr',
    gridded: true,
  },
  mask: {
    id: 'mask',
    label: 'Mask',
    description: 'Boolean layer on the Sv grid. Empty chunks cost nothing.',
    storage: 'zarr',
    gridded: true,
  },
  regions: {
    id: 'regions',
    label: 'Regions',
    description: 'Sparse region geometry. Re-derived often, so kept apart from the grid.',
    storage: 'parquet',
    gridded: false,
  },
  lines: {
    id: 'lines',
    label: 'Lines',
    description: 'Bottom and surface lines. One value per ping.',
    storage: 'parquet',
    gridded: false,
  },
  nasc: {
    id: 'nasc',
    label: 'NASC',
    description: 'Integrated backscatter per cell. Tabular.',
    storage: 'parquet',
    gridded: false,
  },
  catalog: {
    id: 'catalog',
    label: 'Catalog',
    description: 'Survey-level manifest. A build artifact, not a live query.',
    storage: 'json',
    gridded: false,
  },
  plan: {
    id: 'plan',
    label: 'Plan',
    description: 'A dry-run estimate: chunk counts, bytes, time.',
    storage: 'json',
    gridded: false,
  },
  report: {
    id: 'report',
    label: 'Report',
    description: 'QC output — seams, dropped pings, clock jumps.',
    storage: 'json',
    gridded: false,
  },
  netcdf: {
    id: 'netcdf',
    label: 'NetCDF',
    description: 'An export for handoff or archive. Nothing here reads it back.',
    storage: 'file',
    gridded: false,
  },
  image: {
    id: 'image',
    label: 'Image',
    description: 'A rendered figure.',
    storage: 'file',
    gridded: false,
  },
  none: {
    id: 'none',
    label: '—',
    description: 'Takes no layer input, or produces no layer output.',
    storage: 'none',
    gridded: false,
  },
  any: {
    id: 'any',
    label: 'Any',
    description: 'Unconstrained — a freeform stage the user writes themselves.',
    storage: 'none',
    gridded: false,
  },
};

/** The layers of the processing stack, in production order. */
export const STACK: readonly LayerKind[] = [
  'raw',
  'l1',
  'sv',
  'mvbs',
  'mask',
] as const;

export function layerLabel(kind: LayerKind): string {
  return LAYERS[kind]?.label ?? kind;
}

/** True when a kind carries dimensions and a chunk shape worth showing. */
export function isGridded(kind: LayerKind): boolean {
  return LAYERS[kind]?.gridded ?? false;
}

/**
 * Can a stage consuming `consumes` be fed by a stage producing `produces`?
 *
 * `any` matches in both directions, which is what keeps the freeform shell
 * stage composable anywhere without special-casing it at every call site.
 * `none` matches nothing: a stage that produces nothing cannot feed anything,
 * and a stage that consumes nothing takes its input from arguments instead.
 */
export function isCompatible(produces: LayerKind, consumes: LayerKind): boolean {
  if (produces === 'any' || consumes === 'any') return true;
  if (produces === 'none' || consumes === 'none') return false;
  return produces === consumes;
}

/**
 * Walk a composed chain and report the first stage whose input nothing
 * upstream produced.
 *
 * Deliberately reports rather than forbids. The catalogue is incomplete and
 * several entries are unverified proposals, so a composition this function
 * calls wrong may well be right — and a dialog that refuses to build it would
 * be wrong in a way the user cannot work around. The freeform stage exists for
 * exactly that, and a warning keeps it usable.
 */
export interface ChainIssue {
  index: number;
  tool: string;
  needs: LayerKind;
  got: LayerKind;
  message: string;
}

export function chainIssues(
  stages: readonly { tool: string; consumes: LayerKind; produces: LayerKind }[],
  /** What the pipeline is fed at the head, e.g. the selected file's kind. */
  initial: LayerKind = 'any',
): ChainIssue[] {
  const issues: ChainIssue[] = [];
  let upstream: LayerKind = initial;

  stages.forEach((stage, index) => {
    if (!isCompatible(upstream, stage.consumes)) {
      issues.push({
        index,
        tool: stage.tool,
        needs: stage.consumes,
        got: upstream,
        message:
          index === 0
            ? `${stage.tool} consumes ${layerLabel(stage.consumes)}, but the input is ${layerLabel(upstream)}.`
            : `${stage.tool} consumes ${layerLabel(stage.consumes)}, but the previous step produces ${layerLabel(upstream)}.`,
      });
    }
    // Carry the declared output forward even when the step was flagged, so one
    // mismatch produces one warning instead of cascading through the rest.
    if (stage.produces !== 'none') upstream = stage.produces;
  });

  return issues;
}
