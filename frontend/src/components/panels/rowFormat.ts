/**
 * Formatting for the columns every file browser shows.
 *
 * `formatBytes` was written twice, identically, in `FilesPanel` and
 * `DerivedPanel`. That is harmless right up until someone fixes a rounding
 * edge in one of them, and it is the same class of duplication `panelStyles.ts`
 * was created to end. The Modified column arrives needing the same treatment in
 * both places, so both live here now.
 */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

/** A size, or "" for zero — a folder's row should show nothing, not "0 B". */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '';
  const i = Math.min(UNITS.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${UNITS[i]}`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * A timestamp as an age: "3m", "2h", "5d", then a date.
 *
 * Relative, because the question this column answers is almost always "is this
 * the file I just wrote?" — and `2h` answers it at a glance where
 * `2026-08-05T14:22:31Z` does not. It is also two characters wide against
 * twenty, which is what lets the column exist at all in a dock this narrow.
 *
 * The cutover to an absolute date is at a week. Past that, "23d" has stopped
 * being easier to read than "12 Jul", and the question has usually changed
 * from "did that just run?" to "which survey is this from?".
 *
 * The exact timestamp is never lost — `formatAbsolute` puts it in the row's
 * tooltip. This is a summary, not a replacement.
 */
export function formatRelativeTime(iso: string, now: number = Date.now()): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';

  const elapsed = now - then;

  /* A file written by a job that is still running can carry an mtime a second
     or two ahead of this clock — NFS, a container clock skew, or simply the
     server being on a different machine. "in 2s" is noise; "now" is true
     enough and does not make the user wonder what happened. */
  if (elapsed < MINUTE) return 'now';
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < 7 * DAY) return `${Math.floor(elapsed / DAY)}d`;

  const date = new Date(then);
  const sameYear = date.getFullYear() === new Date(now).getFullYear();
  return date.toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

/** The full timestamp, for a tooltip. Local time — the reader's own clock. */
export function formatAbsolute(iso: string): string {
  if (!iso) return '';
  const parsed = Date.parse(iso);
  if (Number.isNaN(parsed)) return '';
  return new Date(parsed).toLocaleString();
}

/**
 * The Modified tooltip, including ownership when it is known.
 *
 * "Owner", never "modified by". POSIX records `st_uid` and nothing about who
 * last wrote the bytes, so the two only coincide on a single-user machine —
 * and this UI runs on shared workstations. Labelling the field for what it
 * actually holds is the difference between a useful column and a confidently
 * wrong one.
 */
export function modifiedTooltip(iso: string, owner = ''): string {
  const stamp = formatAbsolute(iso);
  if (!stamp) return owner ? `Owner: ${owner}` : '';
  return owner ? `Modified ${stamp}\nOwner: ${owner}` : `Modified ${stamp}`;
}
