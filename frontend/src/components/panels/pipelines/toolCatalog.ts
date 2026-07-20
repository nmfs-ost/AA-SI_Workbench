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
 */

import type { ParamDef, StageDef } from './pipelineTypes';

export interface ToolTemplate {
  tool: string;
  label: string;
  description: string;
  /** What this tool takes in / puts out, shown as a hint when composing. */
  consumes: 'raw' | 'nc' | 'sv' | 'none';
  produces: 'raw' | 'nc' | 'sv' | 'image' | 'none';
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

export const toolCatalog: readonly ToolTemplate[] = [
  {
    tool: 'aa-fetch',
    label: 'Fetch',
    description: 'Download files from the NCEI archive.',
    consumes: 'raw',
    produces: 'raw',
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
    description: 'Convert a raw file to an EchoData NetCDF.',
    consumes: 'raw',
    produces: 'nc',
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
      'Combine several EchoData files into one (needs ≥2 files, same sonar model, chronological order).',
    consumes: 'nc',
    produces: 'nc',
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
        help: 'Leave empty to keep all channels.',
      },
      {
        id: 'destination',
        label: 'Upload destination',
        type: 'path',
        flag: '--upload',
        default: 'gs://<derived-assets-bucket>/',
      },
    ],
  },
  {
    tool: 'aa-sv',
    label: 'Compute Sv',
    description: 'Calibrated volume backscattering strength.',
    consumes: 'nc',
    produces: 'sv',
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
    ],
  },
  {
    tool: 'aa-graph',
    label: 'Echogram',
    description: 'Render an echogram image.',
    consumes: 'sv',
    produces: 'image',
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
    consumes: 'nc',
    produces: 'image',
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
    produces: 'nc',
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
    produces: 'nc',
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
];

export function findTool(tool: string): ToolTemplate | undefined {
  return toolCatalog.find((t) => t.tool === tool);
}

/**
 * Build a StageDef from a template. The first stage of a pipeline gets the
 * injectable input parameter, so a new pipeline picks up the NCEI selection
 * exactly like the built-in ones.
 */
export function makeStage(template: ToolTemplate, index: number): StageDef {
  const withoutInput = template.params.filter((p) => p.role !== 'input');
  const params =
    index === 0
      ? [INPUT_PARAM, ...withoutInput]
      : withoutInput;

  return {
    id: `${template.tool.replace(/^aa-/, '')}-${index + 1}`,
    tool: template.tool,
    label: template.label,
    description: template.description,
    params,
  };
}
