/**
 * Calibration parameters, declared with the same schema the pipelines use — so
 * the panel renders through the shared `ParamControl` and every control is
 * type-appropriate without bespoke UI code.
 *
 * STARTING POINT, NOT SETTLED. These are the values echosounder processing
 * normally needs (they map onto echopype's `env_params` / `cal_params` when
 * computing Sv), chosen so the panel is useful rather than empty. Adjust the
 * arrays below as the real requirements firm up — that is the only edit needed.
 */

export type { ParamDef, ParamValue } from '../pipelines/pipelineTypes';
import type { ParamDef } from '../pipelines/pipelineTypes';

export interface CalibrationSection {
  id: string;
  title: string;
  description: string;
  params: readonly ParamDef[];
}

export const calibrationSections: readonly CalibrationSection[] = [
  {
    id: 'source',
    title: 'Source',
    description: 'Where calibration values come from for the selected file.',
    params: [
      {
        id: 'source',
        label: 'Calibration source',
        type: 'enum',
        options: [
          'Use values from file',
          'Sphere calibration (.xml)',
          'Manual override',
        ],
        default: 'Use values from file',
        help: 'Values stored in the raw/converted file, a calibration result, or entered here.',
      },
      {
        id: 'calFile',
        label: 'Calibration file',
        type: 'path',
        default: '',
        placeholder: 'path to calibration .xml',
        help: 'Used when the source is a sphere calibration result.',
      },
    ],
  },
  {
    id: 'environment',
    title: 'Environment',
    description:
      'Water-column properties used to derive sound speed and absorption.',
    params: [
      {
        id: 'temperature',
        label: 'Temperature (°C)',
        type: 'number',
        default: 8,
        min: -2,
        max: 35,
        step: 0.1,
      },
      {
        id: 'salinity',
        label: 'Salinity (PSU)',
        type: 'number',
        default: 34.5,
        min: 0,
        max: 45,
        step: 0.1,
      },
      {
        id: 'pressure',
        label: 'Pressure (dbar)',
        type: 'number',
        default: 50,
        min: 0,
        max: 10000,
        step: 1,
      },
      {
        id: 'soundSpeed',
        label: 'Sound speed (m/s)',
        type: 'number',
        default: 1480,
        min: 1400,
        max: 1600,
        step: 1,
        help: 'Leave at the computed value unless overriding.',
      },
      {
        id: 'absorption',
        label: 'Absorption (dB/km)',
        type: 'number',
        default: 10,
        min: 0,
        max: 200,
        step: 0.1,
      },
    ],
  },
  {
    id: 'transducer',
    title: 'Transducer',
    description: 'Per-channel calibration values applied when computing Sv.',
    params: [
      {
        id: 'channel',
        label: 'Channel',
        type: 'enum',
        options: [
          'All channels',
          'GPT 18 kHz',
          'GPT 38 kHz',
          'GPT 70 kHz',
          'GPT 120 kHz',
          'GPT 200 kHz',
        ],
        default: 'All channels',
      },
      {
        id: 'gain',
        label: 'Gain (dB)',
        type: 'number',
        default: 25,
        min: 0,
        max: 60,
        step: 0.01,
      },
      {
        id: 'saCorrection',
        label: 'Sa correction (dB)',
        type: 'number',
        default: 0,
        min: -10,
        max: 10,
        step: 0.01,
      },
      {
        id: 'beamAngle',
        label: 'Equivalent beam angle (dB)',
        type: 'number',
        default: -20.7,
        min: -30,
        max: 0,
        step: 0.1,
      },
      {
        id: 'applyToPipelines',
        label: 'Apply to pipeline runs',
        type: 'boolean',
        default: true,
        help: 'Pass these values to aa-sv when a pipeline computes Sv.',
      },
    ],
  },
];

/** Flat defaults keyed by param id, for seeding the store. */
export function calibrationDefaults(): Record<string, ParamDef['default']> {
  const out: Record<string, ParamDef['default']> = {};
  for (const section of calibrationSections) {
    for (const param of section.params) {
      out[param.id] = param.default;
    }
  }
  return out;
}
