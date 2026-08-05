import { describe, expect, it } from 'vitest';

import {
  buildArgv,
  buildCommand,
  COMMAND_OVERRIDE,
  type PipelineDefinition,
  type StageDef,
} from '../src/components/panels/pipelines/pipelineTypes';
import {
  compression,
  formatBytes,
  formatCount,
  sparsity,
  type StoreSummary,
} from '../src/services/storeApi';

const combine: StageDef = {
  id: 'combine',
  tool: 'aa-combine',
  label: 'Combine',
  description: '',
  params: [
    { id: 'input', label: 'Input', type: 'file', role: 'input', default: '' },
    { id: 'output', label: 'Output', type: 'string', flag: '-o', default: 'combined.zarr' },
    {
      id: 'channels',
      label: 'Channels',
      type: 'multi',
      flag: '--channels',
      options: ['GPT 18 kHz', 'GPT 38 kHz'],
      default: [],
    },
    { id: 'strict', label: 'Strict', type: 'boolean', flag: '--strict', default: false },
    { id: 'sonar', label: 'Sonar', type: 'string', flag: '--sonar_model', default: '' },
  ],
};

describe('buildArgv', () => {
  it('separates arguments instead of quoting them', () => {
    const argv = buildArgv(combine, { combine: {} }, "/data/Dyson's Bank/f.nc");
    expect(argv).toEqual({
      tool: 'aa-combine',
      // The path stays ONE argument. This is the whole reason argv is generated
      // from the schema rather than lexed back out of the display string.
      args: ["/data/Dyson's Bank/f.nc", '-o', 'combined.zarr'],
    });
  });

  it('quotes the same path in the display string', () => {
    const command = buildCommand(
      { stages: [combine] } as unknown as PipelineDefinition,
      { combine: {} },
      "/data/Dyson's Bank/f.nc",
    );
    expect(command[0]).toContain('"/data/Dyson\'s Bank/f.nc"');
  });

  it('omits a false boolean and emits a true one as a bare flag', () => {
    expect(buildArgv(combine, { combine: { strict: false } }, 'a.nc')?.args).not.toContain(
      '--strict',
    );
    expect(buildArgv(combine, { combine: { strict: true } }, 'a.nc')?.args).toContain('--strict');
  });

  it('joins a multi value into one comma-separated argument', () => {
    const argv = buildArgv(
      combine,
      { combine: { channels: ['GPT 18 kHz', 'GPT 38 kHz'] } },
      'a.nc',
    );
    expect(argv?.args).toContain('--channels');
    expect(argv?.args).toContain('GPT 18 kHz,GPT 38 kHz');
  });

  it('drops an empty optional rather than passing a bare flag', () => {
    const argv = buildArgv(combine, { combine: { sonar: '   ' } }, 'a.nc');
    expect(argv?.args).not.toContain('--sonar_model');
  });

  it('refuses a hand-written command', () => {
    // A shell string may contain a pipe. Running it as argv would execute a
    // program with an argument called "|", so null is the honest answer.
    const values = { combine: { [COMMAND_OVERRIDE]: 'aa-combine a.nc | grep -v WARN' } };
    expect(buildArgv(combine, values, 'a.nc')).toBeNull();
  });

  it('refuses a freeform stage', () => {
    expect(buildArgv({ ...combine, freeform: true }, { combine: {} }, 'a.nc')).toBeNull();
  });
});

describe('store ratios', () => {
  const base: StoreSummary = {
    schema: 'aa/1',
    kind: 'l1',
    uri: 'file:///tmp/L1.zarr',
    zarrFormat: 2,
    consolidated: true,
    group: null,
  };

  it('computes sparsity and compression', () => {
    const summary: StoreSummary = {
      ...base,
      chunkCount: { expected: 1160, written: 1122 },
      bytes: { stored: 250, logical: 1000 },
    };
    expect(sparsity(summary)).toBeCloseTo(1122 / 1160);
    expect(compression(summary)).toBeCloseTo(0.25);
  });

  it('returns null — not zero — when the census could not count', () => {
    // A sharded store reports written: null because proving an inner chunk
    // exists means decoding the shard index. Rendering that as 0% would be a
    // confident lie about a store that is probably fine.
    const sharded: StoreSummary = {
      ...base,
      chunkCount: { expected: 1160, written: null },
    };
    expect(sparsity(sharded)).toBeNull();
    expect(sparsity(base)).toBeNull();
    expect(compression(base)).toBeNull();
  });

  it('distinguishes an unknown byte total from a zero one', () => {
    expect(formatBytes(null)).toBe('—');
    expect(formatBytes(undefined)).toBe('—');
    expect(formatBytes(0)).toBe('0 B');
    expect(formatCount(null)).toBe('—');
    expect(formatCount(0)).toBe('0');
  });

  it('formats bytes at the scales a store actually reaches', () => {
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 ** 3 * 250)).toBe('250 GB');
  });
});
