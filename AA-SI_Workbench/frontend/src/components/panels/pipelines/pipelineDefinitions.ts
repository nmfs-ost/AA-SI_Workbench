/**
 * Saved pipeline definitions.
 *
 * These model the real AA-SI console tools and the chain they compose:
 *   aa-get | aa-fetch | aa-raw (aa-ed) | aa-combine | aa-sv | aa-graph / aa-plot
 *
 * Each entry stands for a pipeline a user has already built and saved. Because
 * the UI is generated from this schema, adding a new pipeline (or a new flag on
 * an existing tool) means editing only this file.
 *
 * When a real backend catalogue of user-saved pipelines exists, replace this
 * module's export with a fetch — the store and every component consume
 * `pipelineDefinitions`, not the literals.
 */

import type { PipelineDefinition } from './pipelineTypes';

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

export const pipelineDefinitions: readonly PipelineDefinition[] = [
  {
    id: 'ncei-to-combined-nc',
    name: 'NCEI raw → combined .nc',
    description:
      'Fetch raw files from NCEI, convert each to EchoData, and combine them into a single derived NetCDF.',
    tags: ['NCEI', 'combine', 'derived asset'],
    inputKind: 'raw',
    author: 'aa-si',
    updatedAt: '2026-05-14T10:12:00Z',
    stages: [
      {
        id: 'fetch',
        tool: 'aa-fetch',
        label: 'Fetch',
        description: 'Download the selected raw files from the NCEI archive.',
        params: [
          {
            id: 'input',
            label: 'Input file',
            type: 'file',
            role: 'input',
            default: '',
            help: 'Injected from the file selected in the NCEI panel.',
            primary: true,
          },
          {
            id: 'outputRoot',
            label: 'Download directory',
            type: 'path',
            flag: '-o',
            default: './downloads',
            primary: true,
            help: 'Parent directory for the per-run download folder.',
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
        id: 'convert',
        tool: 'aa-raw',
        label: 'Convert',
        description: 'Convert each raw file to an EchoData NetCDF.',
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
        id: 'combine',
        tool: 'aa-combine',
        label: 'Combine',
        description:
          'Combine the converted files into one EchoData set (needs ≥2 files, same sonar model, chronological order).',
        params: [
          {
            id: 'output',
            label: 'Output .nc',
            type: 'string',
            flag: '-o',
            default: 'combined.nc',
            primary: true,
          },
          {
            id: 'channels',
            label: 'Channels',
            type: 'multi',
            flag: '--channels',
            options: CHANNELS,
            default: [],
            primary: true,
            help: 'Leave empty to keep all channels.',
          },
          {
            id: 'destination',
            label: 'Upload destination',
            type: 'path',
            flag: '--upload',
            default: 'gs://<derived-assets-bucket>/',
            help: 'Where the derived asset is written.',
          },
        ],
      },
    ],
  },

  {
    id: 'sv-echogram',
    name: 'Sv + echogram',
    description:
      'Compute volume backscattering strength from a converted file and render an echogram image.',
    tags: ['Sv', 'echogram', 'plot'],
    inputKind: 'nc',
    author: 'aa-si',
    updatedAt: '2026-06-02T15:41:00Z',
    stages: [
      {
        id: 'sv',
        tool: 'aa-sv',
        label: 'Compute Sv',
        description: 'Calibrated volume backscattering strength.',
        params: [
          {
            id: 'input',
            label: 'Input file',
            type: 'file',
            role: 'input',
            default: '',
            help: 'Injected from the file selected in the NCEI panel.',
            primary: true,
          },
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
        ],
      },
      {
        id: 'graph',
        tool: 'aa-graph',
        label: 'Echogram',
        description: 'Render the echogram image.',
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
            primary: true,
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
            primary: true,
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
    ],
  },

  {
    id: 'quick-look',
    name: 'Quick look',
    description:
      'Convert a single raw file and plot it immediately — the fastest way to eyeball a transect.',
    tags: ['fast', 'preview'],
    inputKind: 'raw',
    author: 'aa-si',
    updatedAt: '2026-06-21T08:05:00Z',
    stages: [
      {
        id: 'convert',
        tool: 'aa-raw',
        label: 'Convert',
        description: 'Raw → EchoData.',
        params: [
          {
            id: 'input',
            label: 'Input file',
            type: 'file',
            role: 'input',
            default: '',
            help: 'Injected from the file selected in the NCEI panel.',
            primary: true,
          },
          {
            id: 'sonarModel',
            label: 'Sonar model',
            type: 'enum',
            flag: '--sonar-model',
            options: SONAR_MODELS,
            default: 'EK80',
            primary: true,
          },
        ],
      },
      {
        id: 'plot',
        tool: 'aa-plot',
        label: 'Plot',
        description: 'Quick echogram preview.',
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
            primary: true,
          },
          {
            id: 'showGrid',
            label: 'Show depth grid',
            type: 'boolean',
            flag: '--grid',
            default: true,
            primary: true,
          },
        ],
      },
    ],
  },

  {
    id: 'full-transect-product',
    name: 'Full transect product',
    description:
      'End-to-end: fetch from NCEI, convert, combine, compute Sv, and publish the derived asset with an echogram.',
    tags: ['end-to-end', 'NCEI', 'publish'],
    inputKind: 'raw',
    author: 'aa-si',
    updatedAt: '2026-07-01T13:20:00Z',
    stages: [
      {
        id: 'fetch',
        tool: 'aa-fetch',
        label: 'Fetch',
        description: 'Download raws for the selected range.',
        params: [
          {
            id: 'input',
            label: 'Input file',
            type: 'file',
            role: 'input',
            default: '',
            help: 'Injected from the file selected in the NCEI panel.',
            primary: true,
          },
          {
            id: 'outputRoot',
            label: 'Download directory',
            type: 'path',
            flag: '-o',
            default: './downloads',
            primary: true,
          },
        ],
      },
      {
        id: 'convert',
        tool: 'aa-raw',
        label: 'Convert',
        description: 'Raw → EchoData.',
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
        ],
      },
      {
        id: 'combine',
        tool: 'aa-combine',
        label: 'Combine',
        description: 'Merge into one transect.',
        params: [
          {
            id: 'output',
            label: 'Output .nc',
            type: 'string',
            flag: '-o',
            default: 'transect.nc',
            primary: true,
          },
          {
            id: 'channels',
            label: 'Channels',
            type: 'multi',
            flag: '--channels',
            options: CHANNELS,
            default: [],
          },
        ],
      },
      {
        id: 'sv',
        tool: 'aa-sv',
        label: 'Sv',
        description: 'Compute Sv for the combined transect.',
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
        ],
      },
      {
        id: 'publish',
        tool: 'aa-graph',
        label: 'Publish',
        description: 'Render the echogram and upload the derived asset.',
        params: [
          {
            id: 'destination',
            label: 'Upload destination',
            type: 'path',
            flag: '--upload',
            default: 'gs://<derived-assets-bucket>/',
            primary: true,
          },
          {
            id: 'colormap',
            label: 'Colormap',
            type: 'enum',
            flag: '--cmap',
            options: COLORMAPS,
            default: 'viridis',
          },
        ],
      },
    ],
  },

  {
    id: 'kmeans-classify',
    name: 'K-means classification',
    description:
      'Cluster Sv values into acoustic classes — the graphical form of aa-find’s KMeans operation.',
    tags: ['classify', 'experimental'],
    inputKind: 'nc',
    author: 'aa-si',
    updatedAt: '2026-04-09T09:55:00Z',
    stages: [
      {
        id: 'sv',
        tool: 'aa-sv',
        label: 'Compute Sv',
        description: 'Sv is the input to clustering.',
        params: [
          {
            id: 'input',
            label: 'Input file',
            type: 'file',
            role: 'input',
            default: '',
            help: 'Injected from the file selected in the NCEI panel.',
            primary: true,
          },
        ],
      },
      {
        id: 'kmeans',
        tool: 'aa-kmeans',
        label: 'K-means',
        description: 'Cluster the Sv field.',
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
            primary: true,
          },
        ],
      },
    ],
  },

  /* ---------------------------------------------------------------- *
   * Single-purpose pipelines. Each does one thing, so a new user can  *
   * run something useful without reading a five-stage chain first.    *
   * ---------------------------------------------------------------- */

  {
    id: 'download-raw',
    name: 'Download raw files',
    description:
      'Fetch the selected raw files from NCEI to this workstation. No conversion, no processing \u2014 just get the data local.',
    tags: ['NCEI', 'download'],
    inputKind: 'raw',
    author: 'aa-si',
    updatedAt: '2026-07-20T00:00:00Z',
    stages: [
      {
        id: 'fetch',
        tool: 'aa-fetch',
        label: 'Fetch',
        description: 'Download the selected raw files from the NCEI archive.',
        params: [
          {
            id: 'input',
            label: 'Input file',
            type: 'file',
            role: 'input',
            default: '',
            help: 'Injected from the file selected in the NCEI panel.',
            primary: true,
          },
          {
            id: 'outputRoot',
            label: 'Download directory',
            type: 'path',
            flag: '-o',
            default: './downloads',
            primary: true,
            help: 'Parent directory for the per-run download folder.',
          },
        ],
      },
    ],
  },
  {
    id: 'raw-to-nc',
    name: 'Compute .nc',
    description:
      'Convert raw echosounder files to EchoData NetCDF \u2014 the starting point for every downstream product.',
    tags: ['convert', 'NetCDF'],
    inputKind: 'raw',
    author: 'aa-si',
    updatedAt: '2026-07-20T00:00:00Z',
    stages: [
      {
        id: 'convert',
        tool: 'aa-raw',
        label: 'Convert',
        description: 'Convert each raw file to an EchoData NetCDF.',
        params: [
          {
            id: 'input',
            label: 'Input file',
            type: 'file',
            role: 'input',
            default: '',
            help: 'Injected from the file selected in the left window.',
            primary: true,
          },
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
            id: 'outputDir',
            label: 'Output directory',
            type: 'path',
            flag: '-o',
            default: './nc',
            primary: true,
          },
        ],
      },
    ],
  },
  {
    id: 'compute-sv',
    name: 'Compute Sv',
    description:
      'Calibrate volume backscattering strength from an EchoData NetCDF. Produces the Sv product the echogram and most analyses read.',
    tags: ['Sv', 'calibration'],
    inputKind: 'nc',
    author: 'aa-si',
    updatedAt: '2026-07-20T00:00:00Z',
    stages: [
      {
        id: 'sv',
        tool: 'aa-sv',
        label: 'Compute Sv',
        description: 'Calibrate volume backscattering strength.',
        params: [
          {
            id: 'input',
            label: 'Input .nc',
            type: 'file',
            role: 'input',
            default: '',
            help: 'Injected from the file selected in the left window.',
            primary: true,
          },
          {
            id: 'channels',
            label: 'Channels',
            type: 'multi',
            flag: '--channels',
            options: CHANNELS,
            default: [],
            primary: true,
            help: 'Leave empty to calibrate every channel in the file.',
          },
          {
            id: 'waveform',
            label: 'Waveform mode',
            type: 'enum',
            flag: '--waveform-mode',
            options: ['CW', 'BB'],
            default: 'CW',
          },
        ],
      },
    ],
  },
  {
    id: 'seabed-detection',
    name: 'Seabed detection',
    description:
      'Detect the seabed line in an Sv product and write it as a mask, so bottom returns can be excluded downstream. The tool name is unverified \u2014 see toolCatalog.ts.',
    tags: ['seabed', 'mask', 'unverified tool'],
    inputKind: 'nc',
    author: 'aa-si',
    updatedAt: '2026-07-20T00:00:00Z',
    stages: [
      {
        id: 'seabed',
        tool: 'aa-seabed',
        label: 'Detect seabed',
        description: 'Find the bottom echo and emit a seabed mask.',
        params: [
          {
            id: 'input',
            label: 'Input .nc',
            type: 'file',
            role: 'input',
            default: '',
            help: 'Injected from the file selected in the left window.',
            primary: true,
          },
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
            help: 'Ignore returns shallower than this, excluding surface noise.',
          },
          {
            id: 'outputDir',
            label: 'Output directory',
            type: 'path',
            flag: '-o',
            default: './masks',
          },
        ],
      },
    ],
  },
] as const;
