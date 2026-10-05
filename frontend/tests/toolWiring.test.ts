import { describe, expect, it } from 'vitest';

import {
  compression,
  formatBytes,
  formatCount,
  sparsity,
  type StoreSummary,
} from '../src/services/storeApi';

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
