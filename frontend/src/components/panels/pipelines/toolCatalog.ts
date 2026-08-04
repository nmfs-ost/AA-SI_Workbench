/**
 * Catalog of console tools available when building a pipeline.
 *
 * Each entry is a reusable stage template: the tool, what it does, and the
 * parameters it exposes. Because a new pipeline is assembled from these
 * templates, a user-created pipeline immediately gets a working Configuration
 * panel and a correct command preview — the same schema-driven path the
 * built-in pipelines use.
 *
 * Adding support for a new console tool means adding one entry here.
 *
 * ── `consumes` / `produces` are now read ────────────────────────────────────
 * They used to be declared here and consumed by nothing. They now carry
 * `LayerKind` (see `types/layers.ts`) and drive composition warnings in the New
 * Pipeline dialog. Two consequences worth knowing before editing an entry:
 *
 *   • `'nc'` is gone. The converted layer is `'l1'`; the NetCDF *file* is
 *     `'netcdf'` and is produced only by `aa-export`. Conflating them is what
 *     made NetCDF look like a storage decision rather than an export one.
 *   • A wrong `consumes` now produces a visible warning, so it is worth being
 *     right. When unsure, `'any'` is honest and warns about nothing.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── ACCURACY WARNING ────────────────────────────────────────────────────────
 * Entries carry `verified`. `verified: true` means the tool was already in this
 * catalogue before the Zarr work and its flags came from the project's own
 * notes. Everything else is a *proposal* — the tool may not exist, and where it
 * does the flag spellings are inferred from the naming convention. Check with:
 *
 *     ls $VIRTUAL_ENV/bin/aa-*
 *     aa-<tool> --help
 *
 * and correct the entry. The UI badges unverified tools rather than hiding
 * them, because a proposal that is visible gets corrected and one that is
 * absent does not.
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { ParamDef, StageDef } from './pipelineTypes';
import type { LayerKind } from '../../../types/layers';

export interface ToolTemplate {
  /** Free-form stage: the user writes the command line. */
  freeform?: boolean;
  tool: string;
  label: string;
  description: string;
  /** The layer this stage reads from the pipe. See types/layers.ts. */
  consumes: LayerKind;
  /** The layer this stage writes and passes down the pipe. */
  produces: LayerKind;
  /**
   * False (or absent) = this entry is a proposal, not confirmed against an
   * installed environment. Same convention `combineOptions.ts` uses per-flag,
   * lifted to the tool because for most of these the *tool itself* is the
   * unverified part.
   */
  verified?: boolean;
  params: readonly ParamDef[];
}

const SONAR_MODELS = ['EK60', 'EK80', 'ME70', 'EK500'] as const;
const CHANNELS = [
  'GPT 18 kHz',
  'GPT 38 kHz',
  'GPT 70 kHz',
  'GPT 120 kHz',
  'GPT 200 kHz',
  'WBT 38 kHz',
  'WBT 120 kHz',
] as const;
const COLORMAPS = ['viridis', 'magma', 'inferno', 'jet', 'ocean'] as const;
const CODECS = ['zstd:3', 'zstd:5', 'zstd:9', 'blosc-lz4', 'none'] as const;

/** The input parameter that the left-window file selection is injected into. */
const INPUT_PARAM: ParamDef = {
  id: 'input',
  label: 'Input file',
  type: 'file',
  role: 'input',
  default: '',
  help: 'Injected from the file selected in the NCEI panel.',
  primary: true,
};

/**
 * The sparse sidecar a two-input tool takes as an *argument* while the array
 * lineage arrives on stdin — `aa-mask regions.parquet`, `aa-regrid bottom.parquet`.
 * Declared through one helper so the two spellings cannot drift.
 */
function referenceParam(
  overrides: Partial<ParamDef> & { id: string; label: string },
): ParamDef {
  return {
    type: 'path',
    role: 'reference',
    default: '',
    primary: true,
    ...overrides,
  };
}

export const toolCatalog: readonly ToolTemplate[] = [
  /* ---------------------------------------------------------------- */
  /* Acquisition and conversion                                        */
  /* ---------------------------------------------------------------- */
  {
    tool: 'aa-fetch',
    label: 'Fetch',
    description: 'Download files from the NCEI archive.',
    consumes: 'raw',
    produces: 'raw',
    verified: true,
    params: [
      INPUT_PARAM,
      {
        id: 'outputRoot',
        label: 'Download directory',
        type: 'path',
        flag: '-o',
        default: './downloads',
        primary: true,
      },
      {
        id: 'runName',
        label: 'Run name',
        type: 'string',
        flag: '-n',
        default: '',
        placeholder: 'aa_fetch_<timestamp>',
      },
    ],
  },
  {
    tool: 'aa-raw',
    label: 'Convert',
    description: 'Convert a raw file to a converted (L1) EchoData store.',
    consumes: 'raw',
    produces: 'l1',
    verified: true,
    params: [
      {
        id: 'sonarModel',
        label: 'Sonar model',
        type: 'enum',
        flag: '--sonar-model',
        options: SONAR_MODELS,
        default: 'EK60',
        primary: true,
      },
      {
        id: 'overwrite',
        label: 'Overwrite existing',
        type: 'boolean',
        flag: '--overwrite',
        default: false,
      },
    ],
  },
  {
    tool: 'aa-combine',
    label: 'Combine',
    description:
      'Merge per-file L1 stores into one, in time order. Never combine across a calibration change, a channel-config change, or a transit gap.',
    consumes: 'l1',
    produces: 'l1',
    verified: true,
    params: [
      {
        id: 'output',
        label: 'Output store',
        type: 'string',
        flag: '-o',
        default: 'combined.zarr',
        primary: true,
      },
      {
        id: 'channels',
        label: 'Channels',
        type: 'multi',
        flag: '--channels',
        options: CHANNELS,
        default: [],
        help: 'Leave empty to keep all channels.',
      },
      {
        id: 'destination',
        label: 'Upload destination',
        type: 'path',
        flag: '--upload',
        default: 'gs://<derived-assets-bucket>/',
      },
      {
        id: 'report',
        label: 'Write QC report',
        type: 'boolean',
        flag: '--report',
        default: true,
        help: 'Seams are where dropped pings, duplicate pings, clock jumps and GPS resets surface.',
      },
    ],
  },
  {
    /*
     * Appending is combining with an existing store as one of the inputs. The
     * alignment logic is the same, and the two drift apart the moment they are
     * implemented separately — worth recording here because the catalogue is
     * where someone will look before writing the second one.
     */
    tool: 'aa-append',
    label: 'Append',
    description:
      'Extend an existing store with new inputs, sharing aa-combine’s alignment.',
    consumes: 'l1',
    produces: 'l1',
    verified: false,
    params: [
      referenceParam({
        id: 'store',
        label: 'Store to append to',
        role: 'target',
        help: 'The existing store. New inputs arrive on the pipe.',
      }),
      {
        id: 'plan',
        label: 'Plan only (no write)',
        type: 'boolean',
        flag: '--plan',
        default: false,
        help: 'Report chunk counts and estimated bytes without writing anything.',
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Calibration and gridded products                                  */
  /* ---------------------------------------------------------------- */
  {
    tool: 'aa-sv',
    label: 'Compute Sv',
    description:
      'Calibrated volume backscattering strength. Calibration is the reprocessing boundary, so this is its own stage.',
    consumes: 'l1',
    produces: 'sv',
    verified: false,
    params: [
      {
        id: 'waveform',
        label: 'Waveform mode',
        type: 'enum',
        flag: '--waveform-mode',
        options: ['CW', 'BB'],
        default: 'CW',
        primary: true,
      },
      {
        id: 'encode',
        label: 'Encode mode',
        type: 'enum',
        flag: '--encode-mode',
        options: ['power', 'complex'],
        default: 'power',
      },
      {
        id: 'depthBin',
        label: 'Depth bin (m)',
        type: 'number',
        flag: '--depth-bin',
        default: 5,
        min: 0.5,
        max: 100,
        step: 0.5,
      },
      {
        id: 'dtype',
        label: 'Stored precision',
        type: 'enum',
        flag: '--dtype',
        options: ['float32', 'int16'],
        default: 'int16',
        help: 'int16 with a 0.01 scale halves the store, for 0.01 dB precision over −120…+10 dB.',
      },
    ],
  },
  {
    tool: 'aa-mvbs',
    label: 'MVBS',
    description:
      'Bin Sv onto a coarser grid. Small, analysis-ready, and the source for pyramids.',
    consumes: 'sv',
    produces: 'mvbs',
    verified: false,
    params: [
      {
        id: 'pingBin',
        label: 'Ping bin',
        type: 'number',
        flag: '--ping-bin',
        default: 20,
        min: 1,
        max: 10000,
        step: 1,
        primary: true,
      },
      {
        id: 'rangeBin',
        label: 'Range bin (m)',
        type: 'number',
        flag: '--range-bin',
        default: 1,
        min: 0.1,
        max: 100,
        step: 0.1,
        primary: true,
      },
    ],
  },
  {
    tool: 'aa-mask',
    label: 'Mask',
    description: 'Rasterize sparse regions onto the Sv grid, chunk for chunk.',
    consumes: 'sv',
    produces: 'mask',
    verified: false,
    params: [
      referenceParam({
        id: 'regions',
        label: 'Regions (Parquet)',
        help: 'Sparse region geometry. The array lineage arrives on the pipe.',
      }),
      {
        id: 'output',
        label: 'Output store',
        type: 'string',
        flag: '-o',
        default: 'mask.zarr',
      },
    ],
  },
  {
    tool: 'aa-regrid',
    label: 'Regrid',
    description:
      'Rewrite an array in bottom-relative coordinates, so a bottom-referenced band stops cutting diagonally across chunks.',
    consumes: 'sv',
    produces: 'sv',
    verified: false,
    params: [
      referenceParam({
        id: 'lines',
        label: 'Bottom line (Parquet)',
        help: 'One depth per ping. The array lineage arrives on the pipe.',
      }),
      {
        id: 'heightMax',
        label: 'Height above bottom (m)',
        type: 'number',
        flag: '--height-max',
        default: 50,
        min: 1,
        max: 1000,
        step: 1,
        help: 'Only this band is written — which is the whole point of the second array.',
      },
    ],
  },
  {
    tool: 'aa-pyramid',
    label: 'Pyramid',
    description:
      'Build reduced-resolution levels for fast overview reads. Adds roughly a third again in size.',
    consumes: 'mvbs',
    produces: 'mvbs',
    verified: false,
    params: [
      {
        id: 'levels',
        label: 'Levels',
        type: 'number',
        flag: '--levels',
        default: 4,
        min: 1,
        max: 10,
        step: 1,
        primary: true,
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Sparse products — regions and lines                               */
  /* ---------------------------------------------------------------- */
  {
    tool: 'aa-evr',
    label: 'Read regions',
    description: 'Read an Echoview region file into sparse Parquet.',
    consumes: 'none',
    produces: 'regions',
    verified: true,
    params: [
      referenceParam({
        id: 'evr',
        label: 'Region file (.evr)',
        role: 'target',
        help: 'Read as an argument; this stage starts a chain rather than continuing one.',
      }),
    ],
  },
  {
    tool: 'aa-evl',
    label: 'Read lines',
    description: 'Read an Echoview line file into sparse Parquet.',
    consumes: 'none',
    produces: 'lines',
    verified: true,
    params: [
      referenceParam({
        id: 'evl',
        label: 'Line file (.evl)',
        role: 'target',
        help: 'Read as an argument; this stage starts a chain rather than continuing one.',
      }),
    ],
  },
  {
    /*
     * The inverted two-input case: regions arrive on the pipe and the *store*
     * is the argument. Kept adjacent to aa-mask, which is the same pair of
     * inputs the other way round.
     */
    tool: 'aa-extract',
    label: 'Extract',
    description:
      'Pull the array values under each region. Regions arrive on the pipe; the store is the argument.',
    consumes: 'regions',
    produces: 'nasc',
    verified: false,
    params: [
      referenceParam({
        id: 'store',
        label: 'Store to read',
        role: 'target',
        help: 'The array. Regions arrive on the pipe.',
      }),
    ],
  },
  {
    tool: 'aa-nasc',
    label: 'NASC',
    description: 'Integrate backscatter per cell into a table.',
    consumes: 'sv',
    produces: 'nasc',
    verified: false,
    params: [
      {
        id: 'cellHeight',
        label: 'Cell height (m)',
        type: 'number',
        flag: '--cell-height',
        default: 10,
        min: 0.5,
        max: 500,
        step: 0.5,
        primary: true,
      },
      {
        id: 'cellDistance',
        label: 'Cell distance (nmi)',
        type: 'number',
        flag: '--cell-distance',
        default: 0.5,
        min: 0.01,
        max: 100,
        step: 0.01,
        primary: true,
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Store inspection, planning, and layout                            */
  /* ---------------------------------------------------------------- */
  {
    /*
     * Read-only, which is what makes it safe to run speculatively — and that
     * is what makes it the tool unblocking the most UI at once. The Metadata
     * panel's store view has nothing true to say until this exists.
     */
    tool: 'aa-store',
    label: 'Store info',
    description:
      'Describe or verify a store: dims, chunk shape, chunks written, stored vs logical bytes.',
    consumes: 'any',
    produces: 'report',
    verified: false,
    params: [
      {
        id: 'subcommand',
        label: 'Action',
        type: 'enum',
        options: ['info', 'verify'],
        default: 'info',
        primary: true,
      },
      {
        id: 'json',
        label: 'Machine output',
        type: 'boolean',
        flag: '--json',
        default: true,
        help: 'The UI reads this; leave it on.',
      },
    ],
  },
  {
    tool: 'aa-chunk',
    label: 'Chunk',
    description:
      'Plan or apply a chunk shape. Plan first — the cost of a bad shape only appears after the write.',
    consumes: 'any',
    produces: 'plan',
    verified: false,
    params: [
      {
        id: 'subcommand',
        label: 'Action',
        type: 'enum',
        options: ['plan', 'apply'],
        default: 'plan',
        primary: true,
      },
      {
        id: 'pings',
        label: 'Pings per chunk',
        type: 'number',
        flag: '--pings',
        default: 500,
        min: 1,
        max: 100000,
        step: 1,
        primary: true,
        help: 'Target 1–20 MB compressed per chunk; 5–10 MB is the sweet spot on object storage.',
      },
      {
        id: 'codec',
        label: 'Codec',
        type: 'enum',
        flag: '--codec',
        options: CODECS,
        default: 'zstd:5',
      },
      {
        id: 'shard',
        label: 'Chunks per shard',
        type: 'number',
        flag: '--shard',
        default: 0,
        min: 0,
        max: 1000,
        step: 1,
        help: '0 = no sharding. Cuts object count 10–100x; PUTs cost roughly 12.5x GETs, so this matters most on write.',
      },
    ],
  },
  {
    /*
     * Profiles a *pilot* store against a region corpus to recommend a chunk
     * shape. Two things have to reach the user alongside the recommendation:
     * regions set chunk dimensions but are never a partition key, and the EVR
     * corpus is biased — it records only what the old tooling made easy, so ML
     * patch sampling and viewer panning do not appear in it at all.
     */
    tool: 'aa-profile',
    label: 'Profile',
    description:
      'Recommend a chunk shape from an observed workload. Profile a pilot store, not the target.',
    consumes: 'regions',
    produces: 'plan',
    verified: false,
    params: [
      referenceParam({
        id: 'pilot',
        label: 'Pilot store',
        role: 'target',
        help: 'A representative store, not the one you intend to write.',
      }),
    ],
  },
  {
    tool: 'aa-catalog',
    label: 'Catalog',
    description:
      'Build a survey-level manifest from many stores. A build artifact, not a live query.',
    consumes: 'any',
    produces: 'catalog',
    verified: false,
    params: [
      {
        id: 'output',
        label: 'Output',
        type: 'string',
        flag: '-o',
        default: 'catalog.json',
        primary: true,
      },
      {
        id: 'geojson',
        label: 'Emit GeoJSON per transect',
        type: 'boolean',
        flag: '--geojson',
        default: true,
        help: 'Drives the map overlays.',
      },
    ],
  },
  {
    tool: 'aa-virtual',
    label: 'Virtual',
    description:
      'Index existing NetCDF/HDF5 bytes in place, with no duplication. Only worthwhile when the source chunking already resembles the query pattern.',
    consumes: 'any',
    produces: 'l1',
    verified: false,
    params: [
      {
        id: 'output',
        label: 'Reference store',
        type: 'string',
        flag: '-o',
        default: 'virtual.zarr',
        primary: true,
      },
    ],
  },
  {
    tool: 'aa-export',
    label: 'Export',
    description:
      'Write a single NetCDF artifact for handoff, archive, or a tool that reads NetCDF. An export, not a storage layer.',
    consumes: 'any',
    produces: 'netcdf',
    verified: false,
    params: [
      {
        id: 'output',
        label: 'Output .nc',
        type: 'string',
        flag: '-o',
        default: 'export.nc',
        primary: true,
      },
    ],
  },

  /* ---------------------------------------------------------------- */
  /* Rendering and analysis                                            */
  /* ---------------------------------------------------------------- */
  {
    /*
     * NAME COLLISION — READ BEFORE ADDING THE OTHER aa-graph.
     *
     * This entry is the echogram renderer that already existed in this
     * catalogue. The Zarr architecture note also specifies an `aa-graph` that
     * reads a pipeline YAML and emits a DAG for `aa-run` to execute. Those are
     * two different tools with one name, and whichever ships second shadows
     * the first on PATH. Rename one before either is written; this catalogue is
     * where the clash is visible, so it is where the note belongs.
     */
    tool: 'aa-graph',
    label: 'Echogram',
    description: 'Render an echogram image.',
    consumes: 'sv',
    produces: 'image',
    verified: true,
    params: [
      {
        id: 'colormap',
        label: 'Colormap',
        type: 'enum',
        flag: '--cmap',
        options: COLORMAPS,
        default: 'viridis',
        primary: true,
      },
      {
        id: 'vmin',
        label: 'Sv min (dB)',
        type: 'number',
        flag: '--vmin',
        default: -90,
        min: -140,
        max: 0,
        step: 1,
      },
      {
        id: 'vmax',
        label: 'Sv max (dB)',
        type: 'number',
        flag: '--vmax',
        default: -30,
        min: -140,
        max: 0,
        step: 1,
      },
      {
        id: 'output',
        label: 'Image output',
        type: 'path',
        flag: '-o',
        default: './echograms',
      },
    ],
  },
  {
    tool: 'aa-plot',
    label: 'Quick plot',
    description: 'Fast single-channel echogram preview.',
    consumes: 'l1',
    produces: 'image',
    verified: true,
    params: [
      {
        id: 'channel',
        label: 'Channel',
        type: 'enum',
        flag: '--channel',
        options: CHANNELS,
        default: 'GPT 38 kHz',
        primary: true,
      },
      {
        id: 'colormap',
        label: 'Colormap',
        type: 'enum',
        flag: '--cmap',
        options: COLORMAPS,
        default: 'ocean',
      },
      {
        id: 'showGrid',
        label: 'Show depth grid',
        type: 'boolean',
        flag: '--grid',
        default: true,
      },
    ],
  },
  {
    tool: 'aa-kmeans',
    label: 'K-means',
    description: 'Cluster the Sv field into acoustic classes.',
    consumes: 'sv',
    produces: 'mask',
    verified: true,
    params: [
      {
        id: 'clusters',
        label: 'Clusters (k)',
        type: 'number',
        flag: '-k',
        default: 4,
        min: 2,
        max: 12,
        step: 1,
        primary: true,
      },
      {
        id: 'seed',
        label: 'Random seed',
        type: 'number',
        flag: '--seed',
        default: 42,
        min: 0,
        max: 99999,
        step: 1,
      },
      {
        id: 'normalize',
        label: 'Normalize inputs',
        type: 'boolean',
        flag: '--normalize',
        default: true,
      },
    ],
  },
  {
    tool: 'aa-dbscan',
    label: 'DBScan',
    description: 'Density-based clustering of the Sv field.',
    consumes: 'sv',
    produces: 'mask',
    verified: true,
    params: [
      {
        id: 'eps',
        label: 'Epsilon',
        type: 'number',
        flag: '--eps',
        default: 0.5,
        min: 0.05,
        max: 10,
        step: 0.05,
        primary: true,
      },
      {
        id: 'minSamples',
        label: 'Min samples',
        type: 'number',
        flag: '--min-samples',
        default: 10,
        min: 1,
        max: 500,
        step: 1,
      },
    ],
  },
  {
    /*
     * `aa-seabed` is the expected name for the seabed-detection tool but it was
     * NOT verified against an installed AA-SI environment. There are now two
     * separate things to confirm, not one:
     *   1. the tool name and flags (`ls $VIRTUAL_ENV/bin/aa-*`);
     *   2. whether it reads L1 or Sv. It is declared here as consuming Sv,
     *      because bottom detection normally runs on calibrated data — but the
     *      original entry said L1 and neither spelling was ever checked.
     * It produces `lines` (one bottom depth per ping) rather than a mask; the
     * rasterized form is what `aa-mask` makes from it.
     */
    tool: 'aa-seabed',
    label: 'Detect seabed',
    description: 'Find the bottom echo and emit a bottom line.',
    consumes: 'sv',
    produces: 'lines',
    verified: false,
    params: [
      INPUT_PARAM,
      {
        id: 'threshold',
        label: 'Detection threshold (dB)',
        type: 'number',
        flag: '--threshold',
        default: -35,
        min: -90,
        max: 0,
        step: 1,
        primary: true,
        help: 'Sv above this is treated as a candidate bottom return.',
      },
      {
        id: 'minDepth',
        label: 'Minimum depth (m)',
        type: 'number',
        flag: '--min-depth',
        default: 10,
        min: 0,
        max: 2000,
        step: 1,
      },
    ],
  },
  /*
   * The escape hatch. There are far more console tools than this catalogue can
   * usefully list — every aa-* tool that ships later, plus the whole Unix
   * toolbox (grep, tee, head, sort, xargs...) which is genuinely useful in a
   * pipe chain. Rather than enumerate them, this stage lets the user write the
   * command line directly.
   *
   * It stays compatible with file swapping because the command is a *template*:
   * `{input}` is substituted with whatever is selected in the workspace, so
   * changing files re-targets the command without editing it.
   *
   * `any` on both sides is load-bearing: it is what stops a hand-written stage
   * from raising a composition warning wherever the user puts it.
   */
  {
    tool: 'sh',
    label: 'Custom command',
    description:
      'Write the command yourself. Use {input} where the selected file should go.',
    consumes: 'any',
    produces: 'any',
    freeform: true,
    verified: true,
    params: [],
  },
];

export function findTool(tool: string): ToolTemplate | undefined {
  return toolCatalog.find((t) => t.tool === tool);
}

/**
 * Build a StageDef from a template. The first stage of a pipeline gets the
 * injectable input parameter, so a new pipeline picks up the NCEI selection
 * exactly like the built-in ones.
 *
 * A stage that already declares a `target` role is left alone: it names its own
 * input as an argument (`aa-evr regions.evr`, `aa-extract store.zarr`), and
 * injecting a second one would produce a command with two inputs and nothing to
 * say which the tool would actually read.
 */
export function makeStage(template: ToolTemplate, index: number): StageDef {
  const withoutInput = template.params.filter((p) => p.role !== 'input');
  const declaresTarget = template.params.some((p) => p.role === 'target');
  const params =
    index === 0 && !declaresTarget ? [INPUT_PARAM, ...withoutInput] : withoutInput;

  return {
    id: `${template.tool.replace(/^aa-/, '')}-${index + 1}`,
    tool: template.tool,
    label: template.label,
    description: template.description,
    params: template.freeform ? [] : params,
    freeform: template.freeform,
  };
}
