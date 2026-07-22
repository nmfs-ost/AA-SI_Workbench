/**
 * Options for the two NCEI workflows, as data.
 *
 * The panel renders whatever is declared here, so adding a flag is a one-line
 * change and never touches a component — the same rule the pipelines feature
 * follows.
 *
 * ── ACCURACY WARNING ─────────────────────────────────────────────────────────
 * Only the flags marked `verified: true` were taken from the project's existing
 * tool catalogue. The rest are *proposals* based on what these operations need;
 * they have NOT been checked against the installed tools. Run
 *
 *     aa-fetch --help ; aa-combine --help
 *
 * and correct the `flag` strings below. Anything the schema gets wrong can be
 * worked around immediately with the "Additional flags" field, which is
 * appended verbatim — so an incomplete schema is never a blocker.
 * ─────────────────────────────────────────────────────────────────────────────
 */

export type OptionType = 'string' | 'path' | 'enum' | 'multi' | 'boolean' | 'number';

export interface OptionDef {
  id: string;
  label: string;
  type: OptionType;
  /** CLI flag. Omit for a positional argument. */
  flag?: string;
  default: string | number | boolean | string[];
  options?: readonly string[];
  placeholder?: string;
  help?: string;
  /** Shown without expanding "All options". */
  primary?: boolean;
  /** False = the flag name is a proposal, not confirmed against the tool. */
  verified?: boolean;
  /** Only render when the output format matches. */
  onlyForFormat?: OutputFormat;
}

export type OutputFormat = 'nc' | 'zarr';

export interface FormatInfo {
  id: OutputFormat;
  label: string;
  ext: string;
  /** One line at the point of choice, so the trade-off is visible. */
  summary: string;
  goodFor: string;
  watchOut: string;
}

/**
 * The two output shapes, described in terms of the problem they solve rather
 * than their file format. A survey's worth of echosounder data is large enough
 * that this choice has real consequences, and it shouldn't require knowing what
 * a chunked array store is.
 */
export const OUTPUT_FORMATS: readonly FormatInfo[] = [
  {
    id: 'nc',
    label: 'Single file (.nc)',
    ext: '.nc',
    summary: 'One NetCDF file containing the whole combined dataset.',
    goodFor: 'Sharing, archiving, and any tool that already reads NetCDF.',
    watchOut: 'Must be read as a whole — awkward once it grows past a few GB.',
  },
  {
    id: 'zarr',
    label: 'Chunked store (.zarr)',
    ext: '.zarr',
    summary: 'A folder of many small chunks instead of one large file.',
    goodFor: 'Big surveys: read one region without loading everything, and open it directly from cloud storage.',
    watchOut: 'It is a directory, not a file — copy it with a tool that handles folders.',
  },
];

/** The console tools each step runs, shown so the operation is legible. */
export interface Stage {
  id: string;
  label: string;
  tool: string;
  description: string;
}

export const DOWNLOAD_STAGES: readonly Stage[] = [
  {
    id: 'fetch',
    label: 'Fetch',
    tool: 'aa-fetch',
    description: 'Copies the selected raw files from the NCEI archive to this workstation.',
  },
];

export const COMBINE_STAGES: readonly Stage[] = [
  {
    id: 'fetch',
    label: 'Fetch',
    tool: 'aa-fetch',
    description: 'The raw files have to be local before anything can read them.',
  },
  {
    id: 'convert',
    label: 'Convert',
    tool: 'aa-raw',
    description: 'Each raw file becomes an EchoData dataset.',
  },
  {
    id: 'combine',
    label: 'Combine',
    tool: 'aa-combine',
    description: 'The per-file datasets are merged into one, in time order.',
  },
  {
    id: 'upload',
    label: 'Upload',
    tool: 'gs://',
    description: 'Optional: publish the result to the derived-assets bucket.',
  },
];

export const CHANNELS = [
  'GPT 18 kHz',
  'GPT 38 kHz',
  'GPT 70 kHz',
  'GPT 120 kHz',
  'GPT 200 kHz',
  'WBT 38 kHz',
  'WBT 120 kHz',
] as const;

/* ------------------------------------------------------------------ */
/* Workflow 1 — download the individual raw files                      */
/* ------------------------------------------------------------------ */

export const downloadOptions: readonly OptionDef[] = [
  {
    id: 'destination',
    label: 'Download directory',
    type: 'path',
    flag: '--file_download_directory',
    default: '',
    primary: true,
    verified: true,
    help: 'Created if it does not exist. Relative paths resolve from your home directory.',
  },
  {
    id: 'overwrite',
    label: 'Re-download files that already exist',
    type: 'boolean',
    flag: '--overwrite',
    default: false,
    verified: false,
  },
];

/* ------------------------------------------------------------------ */
/* Workflow 2 — combine into one dataset                               */
/* ------------------------------------------------------------------ */

export const combineOptions: readonly OptionDef[] = [
  {
    id: 'output',
    label: 'Output name',
    type: 'string',
    flag: '-o',
    default: '',
    primary: true,
    verified: true,
    help: 'The single dataset all selected files are combined into.',
  },
  {
    id: 'channels',
    label: 'Channels',
    type: 'multi',
    flag: '--channels',
    options: CHANNELS,
    default: [],
    primary: true,
    verified: true,
    help: 'Leave empty to keep every channel present in the files.',
  },
  {
    id: 'destination',
    label: 'Upload destination',
    type: 'path',
    flag: '--upload',
    default: '',
    primary: true,
    verified: true,
    help: 'gs:// URI to publish the combined dataset to. Leave empty to keep it local.',
  },
  {
    id: 'workdir',
    label: 'Working directory',
    type: 'path',
    flag: '--workdir',
    default: '',
    verified: false,
    help: 'Where the intermediate per-file .nc conversions are written.',
  },
  {
    id: 'compression',
    label: 'Compression',
    type: 'enum',
    flag: '--compression',
    options: ['none', 'zlib', 'blosc-lz4', 'blosc-zstd'],
    default: 'zlib',
    verified: false,
    help: 'Zarr stores usually want blosc; NetCDF only supports zlib.',
  },
  {
    id: 'chunkPings',
    label: 'Chunk size (pings)',
    type: 'number',
    flag: '--chunk-pings',
    default: 1000,
    verified: false,
    onlyForFormat: 'zarr',
    help: 'Zarr chunking along the ping_time axis. Larger chunks read faster but write slower.',
  },
  {
    id: 'consolidated',
    label: 'Write consolidated metadata',
    type: 'boolean',
    flag: '--consolidated',
    default: true,
    verified: false,
    onlyForFormat: 'zarr',
    help: 'Makes opening the store much faster over the network. Recommended for gs:// stores.',
  },
  {
    id: 'overwrite',
    label: 'Overwrite an existing output',
    type: 'boolean',
    flag: '--overwrite',
    default: false,
    verified: false,
  },
];

export type OptionValues = Record<string, string | number | boolean | string[]>;

export function defaultsFor(defs: readonly OptionDef[]): OptionValues {
  const values: OptionValues = {};
  for (const def of defs) values[def.id] = def.default;
  return values;
}

/** Shell-quote a value only when it needs it. Shared with the recipes feature. */
import { quote } from '../shellQuote';
export { quote };

/**
 * Build an argv string from a schema plus values.
 *
 * Booleans contribute their flag when true and nothing when false; empty
 * strings and empty lists are skipped entirely, so an untouched optional field
 * never appears in the command.
 */
export function buildFlags(
  defs: readonly OptionDef[],
  values: OptionValues,
  format: OutputFormat,
): string[] {
  const parts: string[] = [];
  for (const def of defs) {
    if (def.onlyForFormat && def.onlyForFormat !== format) continue;
    const value = values[def.id];
    if (value === undefined || value === null) continue;

    if (def.type === 'boolean') {
      if (value === true && def.flag) parts.push(def.flag);
      continue;
    }
    if (Array.isArray(value)) {
      if (value.length > 0 && def.flag) {
        parts.push(def.flag, quote(value.join(',')));
      }
      continue;
    }
    const text = String(value).trim();
    if (!text) continue;
    if (def.flag) parts.push(def.flag, quote(text));
    else parts.push(quote(text));
  }
  return parts;
}

/** Swap the extension when the user changes output format. */
export function withFormatExtension(name: string, format: OutputFormat): string {
  const ext = OUTPUT_FORMATS.find((f) => f.id === format)?.ext ?? '.nc';
  const base = name.replace(/\.(nc|netcdf|zarr)$/i, '');
  return `${base}${ext}`;
}
