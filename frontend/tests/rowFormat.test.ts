import { describe, expect, it } from 'vitest';

import {
  formatAbsolute,
  formatBytes,
  formatRelativeTime,
  modifiedTooltip,
} from '../src/components/panels/rowFormat';

/**
 * Row formatting for the file browsers.
 *
 * `formatRelativeTime` takes `now` as an argument precisely so it can be tested
 * without freezing the clock — the boundaries between "now", minutes, hours,
 * days and a date are the whole content of the function, and they are invisible
 * by inspection.
 */

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** A fixed reference point, mid-year so the same-year branch is exercised. */
const NOW = Date.parse('2026-08-05T12:00:00Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

describe('formatBytes', () => {
  it('renders nothing for zero', () => {
    // A folder's row should be blank here, not "0 B".
    expect(formatBytes(0)).toBe('');
    expect(formatBytes(-1)).toBe('');
  });

  it('renders bytes without a decimal', () => {
    expect(formatBytes(512)).toBe('512 B');
  });

  it('keeps one decimal below ten of a unit', () => {
    expect(formatBytes(1536)).toBe('1.5 KB');
  });

  it('drops the decimal at ten and above', () => {
    expect(formatBytes(10 * 1024)).toBe('10 KB');
  });

  it('scales up to terabytes', () => {
    expect(formatBytes(3 * 1024 ** 4)).toBe('3.0 TB');
  });

  it('does not invent a unit past the largest', () => {
    expect(formatBytes(5000 * 1024 ** 4)).toContain('TB');
  });
});

describe('formatRelativeTime', () => {
  it('is empty for a missing timestamp', () => {
    expect(formatRelativeTime('', NOW)).toBe('');
  });

  it('is empty for an unparseable one', () => {
    // Better a blank column than the string "NaN" down every row.
    expect(formatRelativeTime('not a date', NOW)).toBe('');
  });

  it('says now for anything under a minute', () => {
    expect(formatRelativeTime(ago(5 * SECOND), NOW)).toBe('now');
  });

  it('says now for a timestamp slightly in the future', () => {
    /* A file written by a running job can carry an mtime a second or two ahead
       of this clock — NFS, container skew, or simply a different machine.
       "in 2s" is noise and makes the reader wonder what happened. */
    expect(formatRelativeTime(new Date(NOW + 2 * SECOND).toISOString(), NOW)).toBe('now');
  });

  it('switches to minutes at one minute', () => {
    expect(formatRelativeTime(ago(MINUTE), NOW)).toBe('1m');
    expect(formatRelativeTime(ago(59 * MINUTE), NOW)).toBe('59m');
  });

  it('switches to hours at one hour', () => {
    expect(formatRelativeTime(ago(HOUR), NOW)).toBe('1h');
    expect(formatRelativeTime(ago(23 * HOUR), NOW)).toBe('23h');
  });

  it('switches to days at one day', () => {
    expect(formatRelativeTime(ago(DAY), NOW)).toBe('1d');
    expect(formatRelativeTime(ago(6 * DAY), NOW)).toBe('6d');
  });

  it('switches to a date at a week', () => {
    // Past a week the question has usually changed from "did that just run?"
    // to "which survey is this from?", and a count of days stops helping.
    const formatted = formatRelativeTime(ago(8 * DAY), NOW);
    expect(formatted).not.toMatch(/^\d+d$/);
    expect(formatted.length).toBeGreaterThan(0);
  });

  it('includes the year only when it differs', () => {
    const thisYear = formatRelativeTime(ago(30 * DAY), NOW);
    const lastYear = formatRelativeTime(ago(400 * DAY), NOW);
    expect(thisYear).not.toMatch(/202\d/);
    expect(lastYear).toMatch(/202\d/);
  });

  it('never returns something wider than the column', () => {
    /* The column is sized for the widest thing this renders. A value that
       overflowed it would push the hover buttons out of alignment down the
       whole tree, which is the kind of fault that is noticed as "the panel
       looks broken" rather than as a formatting bug. */
    for (const elapsed of [0, MINUTE, 59 * MINUTE, HOUR, 23 * HOUR, DAY, 6 * DAY]) {
      expect(formatRelativeTime(ago(elapsed), NOW).length).toBeLessThanOrEqual(4);
    }
  });
});

describe('formatAbsolute', () => {
  it('is empty for a missing or unparseable timestamp', () => {
    expect(formatAbsolute('')).toBe('');
    expect(formatAbsolute('nonsense')).toBe('');
  });

  it('renders something for a real timestamp', () => {
    expect(formatAbsolute('2026-08-05T12:00:00Z')).not.toBe('');
  });
});

describe('modifiedTooltip', () => {
  it('says owner, never "modified by"', () => {
    /* POSIX records st_uid and nothing about who last wrote the bytes. The two
       differ on a shared workstation, which is exactly where a column headed
       "modified by" would be confidently wrong. */
    const tooltip = modifiedTooltip('2026-08-05T12:00:00Z', 'ada');
    expect(tooltip).toContain('Owner: ada');
    expect(tooltip.toLowerCase()).not.toContain('modified by');
  });

  it('omits the owner when it is unknown', () => {
    const tooltip = modifiedTooltip('2026-08-05T12:00:00Z');
    expect(tooltip).toContain('Modified');
    expect(tooltip).not.toContain('Owner');
  });

  it('still names the owner when there is no timestamp', () => {
    expect(modifiedTooltip('', 'ada')).toBe('Owner: ada');
  });

  it('is empty when there is nothing to say', () => {
    // An empty tooltip renders no tooltip, rather than an empty grey box.
    expect(modifiedTooltip('', '')).toBe('');
  });
});
