import { describe, expect, it } from 'vitest';

import { findSeams, formatGap } from '../src/components/panels/ncei/seams';
import type { SeamInput } from '../src/components/panels/ncei/seams';

/**
 * Transit-gap detection for the Combine workflow.
 *
 * The property that matters is asymmetric: a missed seam produces a combined
 * store that silently averages across a gap, which nothing downstream can
 * detect. A false seam only produces a warning the user can dismiss. So the
 * tests lean on "does it find the real gap", and the no-false-positive cases
 * exist to keep the warning from becoming noise people learn to ignore.
 */

/** Files on a fixed cadence starting at `start`, one every `stepMin` minutes. */
function run(start: string, count: number, stepMin: number, prefix = 'D'): SeamInput[] {
  const t0 = Date.parse(start);
  return Array.from({ length: count }, (_, i) => ({
    name: `${prefix}${i}.raw`,
    acquiredAt: new Date(t0 + i * stepMin * 60_000).toISOString(),
  }));
}

describe('findSeams', () => {
  it('finds no seam in a continuous run', () => {
    const report = findSeams(run('2016-07-25T20:00:00Z', 20, 10));
    expect(report.seams).toHaveLength(0);
    expect(report.groups).toHaveLength(1);
    expect(report.medianSeconds).toBe(600);
  });

  it('finds a transit gap and splits the selection at it', () => {
    const before = run('2016-07-25T20:00:00Z', 10, 10, 'A');
    // Six hours later — the shape of a real transit.
    const after = run('2016-07-26T04:30:00Z', 10, 10, 'B');
    const report = findSeams([...before, ...after]);

    expect(report.seams).toHaveLength(1);
    expect(report.seams[0].before).toBe('A9.raw');
    expect(report.seams[0].after).toBe('B0.raw');
    expect(report.groups).toHaveLength(2);
    expect(report.groups[0]).toHaveLength(10);
    expect(report.groups[1]).toHaveLength(10);
  });

  it('finds several gaps and produces one more group than gaps', () => {
    const files = [
      ...run('2016-07-25T00:00:00Z', 6, 10, 'A'),
      ...run('2016-07-25T08:00:00Z', 6, 10, 'B'),
      ...run('2016-07-25T20:00:00Z', 6, 10, 'C'),
    ];
    const report = findSeams(files);
    expect(report.seams).toHaveLength(2);
    expect(report.groups).toHaveLength(3);
    expect(report.groups.flat()).toHaveLength(18);
  });

  it('sorts chronologically first, because list order follows the sort control', () => {
    const files = run('2016-07-25T20:00:00Z', 8, 10);
    const shuffled = [files[5], files[0], files[7], files[2], files[1], files[6], files[3], files[4]];
    const report = findSeams(shuffled);

    expect(report.ordered.map((f) => f.name)).toEqual(files.map((f) => f.name));
    expect(report.seams).toHaveLength(0);
  });

  it('does not flag ordinary jitter as a gap', () => {
    // One file ran ~50% long. Well inside the tolerance; flagging it would
    // train people to dismiss the warning.
    const files = run('2016-07-25T20:00:00Z', 10, 10);
    const late = Date.parse(files[5].acquiredAt) + 5 * 60_000;
    files[5] = { ...files[5], acquiredAt: new Date(late).toISOString() };

    expect(findSeams(files).seams).toHaveLength(0);
  });

  it('does not flag a large multiple that is still a short interruption', () => {
    // 2 s cadence, one 90 s pause: 45x the median, and nothing at all in
    // wall-clock terms. The relative test alone would fire here; the absolute
    // floor is the only thing stopping it, which is what this pins down.
    const files = run('2016-07-25T20:00:00Z', 20, 2 / 60);
    const shifted = files.map((f, i) =>
      i < 10 ? f : { ...f, acquiredAt: new Date(Date.parse(f.acquiredAt) + 90_000).toISOString() },
    );

    expect(findSeams(shifted).seams).toHaveLength(0);
  });

  it('still flags a genuine transit on that same fast cadence', () => {
    // The floor must not be so high that it swallows real seams on a
    // fine-grained run. Same shape as above, four hours instead of ninety
    // seconds.
    const files = run('2016-07-25T20:00:00Z', 20, 2 / 60);
    const shifted = files.map((f, i) =>
      i < 10
        ? f
        : { ...f, acquiredAt: new Date(Date.parse(f.acquiredAt) + 4 * 3600_000).toISOString() },
    );

    expect(findSeams(shifted).seams).toHaveLength(1);
  });

  it('reports files with unreadable timestamps rather than dating them to the epoch', () => {
    const files: SeamInput[] = [
      ...run('2016-07-25T20:00:00Z', 5, 10),
      { name: 'broken.raw', acquiredAt: 'not a date' },
    ];
    const report = findSeams(files);

    expect(report.undated).toEqual(['broken.raw']);
    // The decisive part: an epoch-zero default would have produced a 46-year
    // gap and buried anything real underneath it.
    expect(report.seams).toHaveLength(0);
    expect(report.ordered).toHaveLength(5);
  });

  it('reports nothing for selections too small to have a cadence', () => {
    for (const count of [0, 1, 2]) {
      const report = findSeams(run('2016-07-25T20:00:00Z', count, 10));
      expect(report.seams).toHaveLength(0);
      expect(report.groups.flat()).toHaveLength(count);
    }
  });

  it('never loses or duplicates a file across the groups', () => {
    const files = [
      ...run('2016-07-25T00:00:00Z', 4, 10, 'A'),
      ...run('2016-07-25T12:00:00Z', 4, 10, 'B'),
    ];
    const report = findSeams(files);
    const names = report.groups.flat().map((f) => f.name);

    expect(names).toHaveLength(files.length);
    expect(new Set(names).size).toBe(files.length);
  });
});

describe('formatGap', () => {
  it('picks the coarsest unit that still says something', () => {
    expect(formatGap(45)).toBe('45 s');
    expect(formatGap(600)).toBe('10 min');
    expect(formatGap(150)).toBe('2.5 min');
    expect(formatGap(3600)).toBe('60 min');
    expect(formatGap(22_320)).toBe('6.2 h');
    expect(formatGap(345_600)).toBe('4.0 days');
  });

  it('survives an infinite factor rather than printing NaN', () => {
    expect(formatGap(Number.POSITIVE_INFINITY)).toBe('unknown');
  });
});
