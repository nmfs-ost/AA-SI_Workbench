/**
 * Planning for the Prepare EchoData card: a time range -> the raw files that
 * cover it, and everything the card says about them before anything runs.
 *
 * The user asks for a time range. The files are an implementation detail, but
 * one the card has to get exactly right, because it is also a promise: the
 * backend checks that the fetch delivered exactly these files, and stops if it
 * did not. So the rules live here, as pure functions with tests, rather than
 * inline in a component.
 *
 * A raw file is named for the moment it *starts*; how long it runs is not in
 * the listing. A file is taken to run until the next one starts, except across
 * a gap, where it is taken to run for one typical cadence. That is what
 * "covers" means below, and it is why the first file of a plan can start
 * before the range does: it holds the range's first ping.
 */

/** What the planner needs from a catalogue row. */
export interface PlanFile {
  name: string;
  /** ISO 8601, UTC. */
  acquiredAt: string;
  sizeBytes: number;
}

export interface Gap {
  /** The file before the gap and the one after it. */
  before: string;
  after: string;
  /** Epoch ms where the gap starts (estimated end of `before`) and ends. */
  from: number;
  to: number;
  /** Estimated dead time, seconds: what aa-combine reads out. */
  seconds: number;
}

export interface RangePlan {
  files: PlanFile[];
  bytes: number;
  /** The file-aligned window the request asks NCEI for (tool spelling, UTC). */
  fetchFrom: string;
  fetchTo: string;
  /** Epoch ms the chosen files actually span. */
  coverFrom: number;
  coverTo: number;
  /** Gaps inside the chosen files, by aa-combine's rule. */
  gaps: Gap[];
  /** Typical start-to-start cadence of the chosen files, seconds (0 if < 2). */
  cadenceSeconds: number;
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/**
 * A UTC date-time a person typed or a tool printed -> epoch ms.
 *
 * Accepts "2016-07-03 06:00", "2016-07-03T06:00:00", "...Z", and a bare date.
 * Everything is UTC: NCEI names files in UTC and so do the tools, and a range
 * silently shifted by the viewer's time zone is the most expensive mistake
 * this card could make.
 */
export function parseUtc(value: string): number | null {
  const text = value.trim().replace(' ', 'T').replace(/Z$/i, '');
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?)?$/.exec(text);
  if (!m) return null;
  const [, y, mo, d, h = '0', mi = '0', s = '0'] = m;
  const ms = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  const back = new Date(ms);
  // Reject 2016-02-31, 25:00 and 06:60 rather than letting Date roll them over.
  if (back.getUTCMonth() !== +mo - 1 || back.getUTCDate() !== +d) return null;
  if (+h > 23 || +mi > 59 || +s > 59) return null;
  return ms;
}

/** "2016-07-03 06:00:00" — how the card shows and edits a time. */
export function formatUtc(ms: number, seconds = true): string {
  const d = new Date(ms);
  const base =
    `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return seconds ? `${base}:${pad(d.getUTCSeconds())}` : base;
}

/** "2016-07-03T06:00:00" — how the tools take a time (aa-request --from). */
export function toolTime(ms: number): string {
  return formatUtc(ms).replace(' ', 'T');
}

/** "20160703T060000" — the stamp in an asset name. */
export function stamp(ms: number): string {
  return toolTime(ms).replace(/[-:]/g, '');
}

/** "6 h", "45 min", "2 days 3 h" — a duration a person reads at a glance. */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 90) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 120) return `${minutes} min`;
  const hours = seconds / 3600;
  if (hours < 48) {
    const whole = Math.floor(hours);
    const rest = Math.round((hours - whole) * 60);
    return rest ? `${whole} h ${rest} min` : `${whole} h`;
  }
  const days = Math.floor(hours / 24);
  const rest = Math.round(hours - days * 24);
  return rest ? `${days} days ${rest} h` : `${days} days`;
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

interface Timed {
  file: PlanFile;
  start: number;
  /** Estimated end, for drawing: the next start, or ~one cadence before a pause. */
  end: number;
  /**
   * How far the file may hold data, for choosing files: the next file's start
   * unless a gap (by aa-combine's default rule) follows, in which case its
   * drawn end. Deliberately generous: a file that runs longer than the cadence
   * (a ping-rate change) must not be dropped from a range that starts inside
   * it; an extra file just before the range costs a little time, a missing
   * one costs data.
   */
  reach: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** aa-combine's defaults: a gap is at least this long and this many cadences. */
const DEFAULT_GAP_SECONDS = 900;
const DEFAULT_GAP_FACTOR = 6;

/** Fallback length of a lone file, when there is no cadence to read. */
const LONE_FILE_SECONDS = 20 * 60;

/**
 * Files in time order, each with an estimated end.
 *
 * A file whose successor starts much later than the cadence sits before a gap,
 * and its end is its start plus one cadence, not the next start: nobody logged
 * the transit.
 */
export function timeline(files: readonly PlanFile[]): { timed: Timed[]; cadence: number } {
  const dated = files
    .map((file) => ({ file, start: Date.parse(file.acquiredAt) }))
    .filter((f) => Number.isFinite(f.start))
    .sort((a, b) => a.start - b.start);
  const intervals = dated.slice(1).map((f, i) => (f.start - dated[i].start) / 1000);
  const cadence = median(intervals);
  const typical = (cadence || LONE_FILE_SECONDS) * 1000;
  const timed = dated.map((f, i) => {
    const next = dated[i + 1]?.start;
    const end = next !== undefined ? Math.min(next, f.start + typical * 1.5) : f.start + typical;
    const interval = next !== undefined ? next - f.start : Infinity;
    const gap = interval - typical >= DEFAULT_GAP_SECONDS * 1000 && interval >= typical * DEFAULT_GAP_FACTOR;
    const reach = next !== undefined && !gap ? next : end;
    return { ...f, end, reach };
  });
  return { timed, cadence };
}

/** First and last moment the catalogue covers, or null for no dated files. */
export function extentOf(files: readonly PlanFile[]): { from: number; to: number } | null {
  const { timed } = timeline(files);
  if (timed.length === 0) return null;
  return { from: timed[0].start, to: timed[timed.length - 1].end };
}

/**
 * Gaps by aa-combine's rule: dead time at least `gapSeconds` AND a
 * start-to-start interval at least `gapFactor` times the median cadence.
 * Dead time is estimated as the interval less one cadence, since the listing
 * has no end times.
 */
export function gapsOf(
  timed: readonly Timed[],
  cadence: number,
  gapSeconds: number,
  gapFactor: number,
): Gap[] {
  if (timed.length < 2 || cadence <= 0) return [];
  const gaps: Gap[] = [];
  for (let i = 1; i < timed.length; i += 1) {
    const interval = (timed[i].start - timed[i - 1].start) / 1000;
    const dead = interval - cadence;
    if (dead >= gapSeconds && interval / cadence >= gapFactor) {
      gaps.push({
        before: timed[i - 1].file.name,
        after: timed[i].file.name,
        from: timed[i - 1].end,
        to: timed[i].start,
        seconds: dead,
      });
    }
  }
  return gaps;
}

/**
 * The files that cover [from, to), and the window that fetches exactly them.
 *
 * Returns null when nothing covers the range (it lies in a gap, or outside
 * the survey).
 */
export function planRange(
  files: readonly PlanFile[],
  from: number,
  to: number,
  gapSeconds = 900,
  gapFactor = 6,
): RangePlan | null {
  if (!(to > from)) return null;
  const { timed } = timeline(files);
  const chosen = timed.filter((f) => f.start < to && f.reach > from);
  if (chosen.length === 0) return null;
  // Gaps and cadence of the chosen files alone: aa-combine judges the files
  // it is given, not the survey around them.
  const own = timeline(chosen.map((f) => f.file));
  const first = chosen[0].start;
  const last = chosen[chosen.length - 1].start;
  return {
    files: chosen.map((f) => f.file),
    bytes: chosen.reduce((sum, f) => sum + (f.file.sizeBytes || 0), 0),
    fetchFrom: toolTime(first),
    // One file: a window that starts and ends at once is refused by aa-request.
    fetchTo: fetchEnd(last === first ? last + 1000 : last),
    coverFrom: first,
    coverTo: chosen[chosen.length - 1].end,
    gaps: gapsOf(own.timed, own.cadence, gapSeconds, gapFactor),
    cadenceSeconds: own.cadence,
  };
}

/**
 * The request's end for a window whose last file starts at `last`.
 *
 * aa-request reads an end time of exactly 00:00:00 as "the whole of that
 * day", so a last file that starts at midnight would pull in 24 more hours of
 * data. One second later is the same set of files and is not ambiguous.
 */
export function fetchEnd(last: number): string {
  const midnight = new Date(last).getUTCHours() === 0 &&
    new Date(last).getUTCMinutes() === 0 &&
    new Date(last).getUTCSeconds() === 0;
  return toolTime(midnight ? last + 1000 : last);
}

/**
 * The asset's name: which survey, which echosounder, which time range.
 * Mirrors `default_base` in backend/src/aa_si_workbench/api/baseline.py.
 */
export function defaultBase(survey: string, sonar: string, from: number, to: number): string {
  return `${survey}_${sonar}_${stamp(from)}-${stamp(to)}`;
}

/** Why a typed base name cannot be used, or '' when it can. */
export function baseProblem(base: string): string {
  if (!base) return '';
  if (base.includes('/')) return 'A name cannot contain "/".';
  if (base.startsWith('.')) return 'A name cannot start with ".".';
  if (/\s/.test(base)) return 'Use "_" instead of spaces.';
  if (/[^\w.\-+]/.test(base)) return 'Letters, digits, "_", "-", "." and "+" only.';
  return '';
}

/**
 * Where the products go: the Workbench's own rule for per-user prefixes,
 * filled in. Mirrors PREFIX_TEMPLATE and `_clean_segment` in the backend.
 */
export function destinationUri(
  bucket: string,
  user: string,
  vessel: string,
  survey: string,
  base: string,
): string {
  const clean = (s: string) => s.replace(/ /g, '_').replace(/[^A-Za-z0-9_.-]/g, '') || 'unknown';
  const who = user ? clean(user) : 'unknown-user';
  return `gs://${bucket}/derived_products/${who}/${clean(vessel)}/${clean(survey)}/${base}/`;
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

export interface Bin {
  from: number;
  to: number;
  /** Fraction of the bin covered by files, 0..1. */
  cover: number;
}

/**
 * Coverage of [from, to) in `count` equal bins: the survey's shape at a
 * glance. Coverage rather than a file count, so a bin half-covered by one long
 * file and a bin full of short ones read the same when both were logging.
 */
export function coverage(files: readonly PlanFile[], from: number, to: number, count: number): Bin[] {
  const width = (to - from) / count;
  const bins: Bin[] = Array.from({ length: count }, (_, i) => ({
    from: from + i * width,
    to: from + (i + 1) * width,
    cover: 0,
  }));
  if (!(width > 0)) return bins;
  for (const { start, end } of timeline(files).timed) {
    if (end <= from || start >= to) continue;
    const a = Math.max(start, from);
    const b = Math.min(end, to);
    let i = Math.floor((a - from) / width);
    while (i < count && bins[i].from < b) {
      const overlap = Math.min(b, bins[i].to) - Math.max(a, bins[i].from);
      if (overlap > 0) bins[i].cover += overlap / width;
      i += 1;
    }
  }
  for (const bin of bins) bin.cover = Math.min(1, bin.cover);
  return bins;
}

/** Tick positions for an axis over [from, to): round hours or days. */
export function ticks(from: number, to: number, target = 4): number[] {
  const span = to - from;
  if (!(span > 0)) return [];
  const steps = [
    60e3, 5 * 60e3, 15 * 60e3, 30 * 60e3, 3600e3, 2 * 3600e3, 3 * 3600e3, 6 * 3600e3,
    12 * 3600e3, 86400e3, 2 * 86400e3, 7 * 86400e3, 14 * 86400e3, 30 * 86400e3,
  ];
  const step = steps.find((s) => span / s <= target) ?? steps[steps.length - 1];
  const out: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) out.push(t);
  return out;
}

/** A tick label: the date at midnight, else the time. */
export function tickLabel(ms: number, span: number): string {
  const d = new Date(ms);
  const dateText = `${d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' })} ${d.getUTCDate()}`;
  const midnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0;
  if (span > 2 * 86400e3 || midnight) return dateText;
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}
