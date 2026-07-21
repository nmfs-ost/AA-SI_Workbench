/**
 * POSIX path arithmetic for display purposes.
 *
 * Deliberately not a general path library: the backend owns every real path
 * decision (resolution, confinement, existence). These helpers only answer
 * "what should this tab be called" and "which folder am I looking at", so they
 * stay small enough to read in one sitting and are covered by unit tests.
 */

/** The last segment of a path — the file name shown on an editor tab. */
export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const cut = trimmed.lastIndexOf('/');
  return cut === -1 ? trimmed : trimmed.slice(cut + 1);
}

/** Everything above the last segment. '/' for a top-level entry. */
export function dirname(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  const cut = trimmed.lastIndexOf('/');
  if (cut === -1) return '';
  return cut === 0 ? '/' : trimmed.slice(0, cut);
}

/** Lower-case extension including the dot, or '' when there isn't one. */
export function extname(path: string): string {
  const name = basename(path);
  const cut = name.lastIndexOf('.');
  return cut <= 0 ? '' : name.slice(cut).toLowerCase();
}

/**
 * Shorten a path for a one-line header, keeping the end — the end is the part
 * that identifies the file, and the middle is what a reader skips anyway.
 */
export function ellipsizePath(path: string, maxLength = 52): string {
  if (path.length <= maxLength) return path;
  const segments = path.split('/');
  const tail: string[] = [];
  let length = 0;
  for (let i = segments.length - 1; i >= 0; i -= 1) {
    const next = length + segments[i].length + 1;
    if (next > maxLength - 2 && tail.length > 0) break;
    tail.unshift(segments[i]);
    length = next;
  }
  return `…/${tail.join('/')}`;
}
