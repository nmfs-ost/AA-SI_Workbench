/**
 * Seam detection for the Combine workflow.
 *
 * Combining is not concatenation. A combined store is one continuous ping axis,
 * and anything binned from it afterwards — MVBS above all — will happily average
 * across a discontinuity and produce a result that looks entirely plausible and
 * is not real. There is no later stage that can detect this, because by then
 * the gap is indistinguishable from a stretch of quiet water.
 *
 * So the check belongs *before* the command is composed, and it can be done
 * here: the panel already holds every selected file's acquisition time, and the
 * cadence of an echosounder acquisition is regular enough that an outlier is
 * obvious. No backend, no tool, no metadata read.
 *
 * What this deliberately does NOT do
 * ----------------------------------
 * Only *transit gaps* are found here, because time is the only signal available
 * client-side from a directory listing. The other two things you must never
 * combine across — a calibration change and a channel-configuration change —
 * are inside the files. They belong to `aa-combine`'s own QC pass, which is why
 * that tool emits a report rather than just a store. A clean result from this
 * function is not a statement that the selection is safe to combine.
 */

/**
 * The absolute minimum before a gap is called a gap, whatever the cadence.
 *
 * A ship does not stop logging for ninety seconds and call it a transit — that
 * is an acquisition hiccup, and on a fast cadence it is a large *multiple* of
 * the median while being nothing at all in wall-clock terms. Without this floor
 * the relative test alone fires on those, and a warning that fires on hiccups
 * is one people learn to click past, which costs more than it saves.
 *
 * Fifteen minutes is chosen as the shortest interruption plausibly worth
 * splitting a combine on. It is a judgement, not a measurement: if real seams
 * are being missed on a coarse-file survey, this is the number to lower, and
 * `GAP_FACTOR` is the one to lower if hiccups start getting through.
 */
const FLOOR_SECONDS = 15 * 60;

/**
 * How many times the typical interval a gap must reach before it is called one.
 *
 * Acquisition files land on a near-fixed cadence, so the median interval is a
 * good scale and an outlier is usually orders of magnitude out, not a little
 * over. 6x is well clear of the jitter from a file that ran slightly long and
 * well under a genuine transit, which is typically hours against minutes.
 */
const GAP_FACTOR = 6;

export interface SeamInput {
  name: string;
  /** ISO 8601 acquisition time. */
  acquiredAt: string;
}

export interface Seam {
  /** Index of the file *before* the gap, in chronological order. */
  index: number;
  before: string;
  after: string;
  seconds: number;
  /** The gap as a multiple of the run's typical interval. */
  factor: number;
}

export interface SeamReport {
  /** Files that carried a usable timestamp, in chronological order. */
  ordered: SeamInput[];
  /** The median interval between consecutive files, in seconds. */
  medianSeconds: number;
  seams: Seam[];
  /**
   * The selection split at every seam. One group means one continuous run.
   * This is what a "split into N groups" affordance would act on.
   */
  groups: SeamInput[][];
  /**
   * Files whose acquisition time could not be read. They are excluded from the
   * analysis rather than defaulted to epoch zero, which would fabricate a
   * spectacular gap and bury the real ones.
   */
  undated: string[];
}

function parse(iso: string): number {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? Number.NaN : ms;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Find the transit gaps in a set of files.
 *
 * Sorts by time first: the panel's list order follows the current sort control,
 * not the clock, and a gap is only meaningful chronologically.
 */
export function findSeams(files: readonly SeamInput[]): SeamReport {
  const undated: string[] = [];
  const dated: { file: SeamInput; t: number }[] = [];

  for (const file of files) {
    const t = parse(file.acquiredAt);
    if (Number.isNaN(t)) undated.push(file.name);
    else dated.push({ file, t });
  }

  dated.sort((a, b) => a.t - b.t);
  const ordered = dated.map((d) => d.file);

  // Two files give one interval, which is its own median and can never be an
  // outlier against itself. Below three, there is nothing to compare.
  if (dated.length < 3) {
    return {
      ordered,
      medianSeconds: 0,
      seams: [],
      groups: ordered.length > 0 ? [ordered] : [],
      undated,
    };
  }

  const intervals: number[] = [];
  for (let i = 1; i < dated.length; i += 1) {
    intervals.push((dated[i].t - dated[i - 1].t) / 1000);
  }

  const medianSeconds = median(intervals);
  const threshold = Math.max(FLOOR_SECONDS, medianSeconds * GAP_FACTOR);

  const seams: Seam[] = [];
  intervals.forEach((seconds, i) => {
    if (seconds <= threshold) return;
    seams.push({
      index: i,
      before: dated[i].file.name,
      after: dated[i + 1].file.name,
      seconds,
      factor: medianSeconds > 0 ? seconds / medianSeconds : Number.POSITIVE_INFINITY,
    });
  });

  // Split at each seam. Boundaries are the seam indices, so group k runs from
  // the previous boundary to this one inclusive.
  const groups: SeamInput[][] = [];
  let start = 0;
  for (const seam of seams) {
    groups.push(ordered.slice(start, seam.index + 1));
    start = seam.index + 1;
  }
  groups.push(ordered.slice(start));

  return { ordered, medianSeconds, seams, groups, undated };
}

/** A gap length a human can read, chosen to the coarsest useful unit. */
export function formatGap(seconds: number): string {
  if (!Number.isFinite(seconds)) return 'unknown';
  if (seconds < 90) return `${Math.round(seconds)} s`;
  const minutes = seconds / 60;
  if (minutes < 90) return `${minutes.toFixed(minutes < 10 ? 1 : 0)} min`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toFixed(1)} h`;
  return `${(hours / 24).toFixed(1)} days`;
}
