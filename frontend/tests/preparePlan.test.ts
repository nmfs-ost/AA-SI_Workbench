import { describe, expect, it } from 'vitest';

import {
  baseProblem,
  coverage,
  defaultBase,
  destinationUri,
  fetchEnd,
  formatDuration,
  formatUtc,
  parseUtc,
  planRange,
  ticks,
} from '../src/components/panels/prepare/plan';
import type { PlanFile } from '../src/components/panels/prepare/plan';

/**
 * The Prepare card's promise: a time range becomes exactly the files that
 * cover it, and the request fetches exactly those. The backend refuses to
 * combine anything else, so a wrong answer here is a failed run, not a
 * cosmetic slip.
 */

const MIN = 60e3;

/** Files every `step` minutes from `start`, named the NCEI way. */
function files(start: string, count: number, step = 20): PlanFile[] {
  const t0 = Date.parse(start);
  return Array.from({ length: count }, (_, i) => {
    const t = new Date(t0 + i * step * MIN).toISOString();
    const name = `D${t.slice(0, 10).replace(/-/g, '')}-T${t.slice(11, 19).replace(/:/g, '')}.raw`;
    return { name, acquiredAt: t, sizeBytes: 100 };
  });
}

describe('parseUtc / formatUtc', () => {
  it('reads what people type and what tools print, always as UTC', () => {
    const want = Date.UTC(2016, 6, 3, 6, 0, 0);
    for (const text of ['2016-07-03 06:00', '2016-07-03T06:00:00', '2016-07-03T06:00:00Z',
      ' 2016-07-03 06:00:00 ']) {
      expect(parseUtc(text)).toBe(want);
    }
    expect(parseUtc('2016-07-03')).toBe(Date.UTC(2016, 6, 3));
    expect(formatUtc(want)).toBe('2016-07-03 06:00:00');
  });

  it('refuses dates that do not exist instead of rolling them over', () => {
    expect(parseUtc('2016-02-31 00:00')).toBeNull();
    expect(parseUtc('2016-07-03 25:00')).toBeNull();
    expect(parseUtc('2016-07-03 06:60')).toBeNull();
    expect(parseUtc('yesterday')).toBeNull();
  });
});

describe('planRange', () => {
  const survey = files('2016-07-03T05:00:00Z', 30); // 05:00 .. 14:40, every 20 min

  it('takes every file that covers the range, including the one holding its first ping', () => {
    const plan = planRange(survey, Date.UTC(2016, 6, 3, 6, 10), Date.UTC(2016, 6, 3, 7, 0))!;
    // 06:00 holds 06:10; 06:40 is the last to start before 07:00.
    expect(plan.files.map((f) => f.name)).toEqual([
      'D20160703-T060000.raw', 'D20160703-T062000.raw', 'D20160703-T064000.raw',
    ]);
    expect(plan.fetchFrom).toBe('2016-07-03T06:00:00');
    expect(plan.fetchTo).toBe('2016-07-03T06:40:00');
    expect(plan.bytes).toBe(300);
    expect(plan.cadenceSeconds).toBe(1200);
  });

  it('keeps a file that runs longer than the cadence when the range starts inside it', () => {
    // 20-minute cadence, but the 06:00 file runs to 06:45 (a ping-rate change).
    const uneven = [
      ...files('2016-07-03T05:00:00Z', 4),
      ...files('2016-07-03T06:45:00Z', 4),
    ];
    const plan = planRange(uneven, Date.UTC(2016, 6, 3, 6, 35), Date.UTC(2016, 6, 3, 7, 10))!;
    expect(plan.files[0].name).toBe('D20160703-T060000.raw');
  });

  it('does not take a file that starts exactly when the range ends', () => {
    const plan = planRange(survey, Date.UTC(2016, 6, 3, 6, 0), Date.UTC(2016, 6, 3, 6, 40))!;
    expect(plan.files.map((f) => f.name)).toEqual(['D20160703-T060000.raw', 'D20160703-T062000.raw']);
  });

  it('is null for an empty or inverted range, and for a range inside a gap', () => {
    const gappy = [...files('2016-07-03T00:00:00Z', 6), ...files('2016-07-03T12:00:00Z', 6)];
    expect(planRange(survey, Date.UTC(2016, 6, 3, 8), Date.UTC(2016, 6, 3, 7))).toBeNull();
    expect(planRange(gappy, Date.UTC(2016, 6, 3, 5), Date.UTC(2016, 6, 3, 6))).toBeNull();
  });

  it('finds a transit gap inside the chosen files by aa-combine\'s rule', () => {
    const gappy = [...files('2016-07-03T00:00:00Z', 6), ...files('2016-07-03T12:00:00Z', 6)];
    const plan = planRange(gappy, Date.UTC(2016, 6, 3, 0), Date.UTC(2016, 6, 3, 14))!;
    expect(plan.files).toHaveLength(12);
    expect(plan.gaps).toHaveLength(1);
    expect(plan.gaps[0].before).toBe('D20160703-T014000.raw');
    expect(plan.gaps[0].after).toBe('D20160703-T120000.raw');
    // 01:40 -> 12:00 start to start, less one 20-minute file.
    expect(plan.gaps[0].seconds).toBe((10 * 60 + 20 - 20) * 60);
    // Raising the floor above the gap makes it acceptable, as --gap_seconds does.
    expect(planRange(gappy, Date.UTC(2016, 6, 3, 0), Date.UTC(2016, 6, 3, 14), 86400)!.gaps)
      .toHaveLength(0);
  });

  it('gives a one-file range a window aa-request accepts', () => {
    const plan = planRange(survey, Date.UTC(2016, 6, 3, 6, 5), Date.UTC(2016, 6, 3, 6, 15))!;
    expect(plan.files).toHaveLength(1);
    expect(plan.fetchFrom).toBe('2016-07-03T06:00:00');
    expect(plan.fetchTo).toBe('2016-07-03T06:00:01');
  });

  it('asks for one second past midnight, which aa-request would read as the whole day', () => {
    expect(fetchEnd(Date.UTC(2016, 6, 4, 0, 0, 0))).toBe('2016-07-04T00:00:01');
    expect(fetchEnd(Date.UTC(2016, 6, 4, 0, 20, 0))).toBe('2016-07-04T00:20:00');
  });
});

describe('names and places', () => {
  it('names the asset after the survey, echosounder and requested range', () => {
    expect(defaultBase('HB1603', 'EK60', Date.UTC(2016, 6, 3, 6), Date.UTC(2016, 6, 3, 12)))
      .toBe('HB1603_EK60_20160703T060000-20160703T120000');
  });

  it('puts products under the user, vessel and survey, like the backend', () => {
    expect(destinationUri('bkt', 'jane.doe', 'Henry_B._Bigelow', 'HB1603', 'X'))
      .toBe('gs://bkt/derived_products/jane.doe/Henry_B._Bigelow/HB1603/X/');
    expect(destinationUri('bkt', '', 'Bell M. Shimada', 'SH1701', 'X'))
      .toBe('gs://bkt/derived_products/unknown-user/Bell_M._Shimada/SH1701/X/');
  });

  it('says why a base name cannot be used', () => {
    expect(baseProblem('HB1603_night')).toBe('');
    expect(baseProblem('a/b')).toMatch('/');
    expect(baseProblem('.hidden')).toMatch('start');
    expect(baseProblem('two words')).toMatch('spaces');
  });
});

describe('drawing helpers', () => {
  it('measures coverage per bin, so a gap shows as empty bins', () => {
    const gappy = [...files('2016-07-03T00:00:00Z', 6), ...files('2016-07-03T12:00:00Z', 6)];
    const bins = coverage(gappy, Date.UTC(2016, 6, 3, 0), Date.UTC(2016, 6, 3, 14), 14);
    expect(bins[0].cover).toBeCloseTo(1);
    expect(bins[5].cover).toBe(0);
    expect(bins[12].cover).toBeCloseTo(1);
  });

  it('puts ticks on round times', () => {
    const t = ticks(Date.UTC(2016, 6, 3, 5, 10), Date.UTC(2016, 6, 3, 11, 0));
    expect(t.length).toBeGreaterThan(1);
    for (const ms of t) expect(ms % (3600e3)).toBe(0);
  });

  it('reads durations the way a person says them', () => {
    expect(formatDuration(45 * 60)).toBe('45 min');
    expect(formatDuration(6 * 3600)).toBe('6 h');
    expect(formatDuration(6.5 * 3600)).toBe('6 h 30 min');
    expect(formatDuration(3 * 86400)).toBe('3 days');
  });
});
