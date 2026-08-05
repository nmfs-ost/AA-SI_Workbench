/**
 * Finding the clickable things in terminal output.
 *
 * Pure string work, kept away from the panel so it can be tested without an
 * xterm instance and a DOM. `TerminalPanel` supplies the buffer plumbing; this
 * decides what counts as a link.
 *
 * ## Why not the web-links addon
 *
 * `@xterm/addon-web-links` does one of the three kinds below. The other two are
 * the ones that matter here, because of what these tools actually print:
 * `aa-fetch` prints the run directory, `aa-ed` in batch mode prints a
 * directory, `aa-combine` prints the store it wrote, and `aa-upload` prints a
 * `gs://` URI. Those are the outputs a person then has to select, copy, and
 * paste into another panel — which is exactly the manual step a link removes.
 * Adding the addon for http and hand-rolling a provider for the other two
 * would mean two hover styles and two activation paths for one gesture, so
 * there is one provider and no new dependency.
 *
 * ## Kinds
 *
 *   url   http(s) — opens a browser tab
 *   gs    a bucket URI — selects it in the right dock, the way clicking the
 *         same object in the Derived panel does
 *   path  an absolute POSIX path, or one under `~` — opens in the editor, or
 *         reveals in Files when it is a directory. Which of those it is comes
 *         from `/api/fs/stat`; it cannot be guessed from the text, because the
 *         directories these tools print have no extension.
 *
 * Relative paths are deliberately not matched. `data/raw` in a log line is
 * relative to whatever directory the tool was run in, which the terminal does
 * not know, and a link that resolves against the wrong directory is worse than
 * no link — it either fails or, much worse, opens a different file with the
 * same name.
 */

export type LinkKind = 'url' | 'gs' | 'path';

export interface FoundLink {
  kind: LinkKind;
  /** The exact text to act on, quotes already stripped. */
  text: string;
  /** Half-open range into the line: [start, end). */
  start: number;
  end: number;
}

/**
 * Trailing characters that are almost always punctuation rather than part of
 * the target. `.` is here because "wrote to /home/ada/out." ends a sentence far
 * more often than it names a file called `out.`; a real trailing dot in a name
 * is vanishingly rare and the row's own tooltip still shows the full path.
 */
const TRAILING = new Set(['.', ',', ';', ':', '!', '?', "'", '"', '`']);

/** Closers only trimmed when the match holds no matching opener. */
const PAIRS: ReadonlyArray<readonly [string, string]> = [
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ['<', '>'],
];

/**
 * Strip punctuation the surrounding prose contributed.
 *
 * Brackets are balanced rather than blindly trimmed, because a URL may legally
 * contain them — a wiki link ending in `(disambiguation)` is the standard
 * example, and truncating it produces a 404 rather than a visibly broken link.
 */
function trimTrailing(text: string): string {
  let end = text.length;
  for (;;) {
    if (end === 0) break;
    const last = text[end - 1];

    if (TRAILING.has(last)) {
      end -= 1;
      continue;
    }

    const pair = PAIRS.find(([, close]) => close === last);
    if (pair) {
      const body = text.slice(0, end);
      const opens = body.split(pair[0]).length - 1;
      const closes = body.split(pair[1]).length - 1;
      if (closes > opens) {
        end -= 1;
        continue;
      }
    }
    break;
  }
  return text.slice(0, end);
}

/* A bucket URI. The bucket name rules are GCS's: lowercase alphanumerics,
   dashes, underscores and dots. The object part takes anything but whitespace
   and the shell metacharacters that would have ended the token anyway. */
const GS = /gs:\/\/[a-z0-9][a-z0-9._-]*(?:\/[^\s"'`<>|]*)?/g;

const URL = /\bhttps?:\/\/[^\s"'`<>|]+/g;

/*
 * An absolute path, or one under `~`.
 *
 * The leading `(?<![\w~/])` is what stops this matching the tail of something
 * already claimed: without it, `https://host/a/b` yields a spurious `/a/b`, and
 * `38/120` in a channel list yields `/120`. The URL and gs passes run first and
 * blank out what they consume, but the guard is cheap and covers the cases
 * those passes never see.
 *
 * A single `/` is not a link: `and/or` should not become a link to the root
 * directory, so at least one more segment is required.
 */
const PATH = /(?<![\w~/])(?:~|(?=\/))(?:\/[\w.@+-]+)+\/?/g;

/** A quoted run whose contents look like a path — how a tool prints a name
    with a space in it. Without this, `'/data/Dyson's Bank/x.raw'` links only
    as far as the space, which points at a directory that does not exist. */
const QUOTED = /(["'])((?:~|\/)[^"'\n]*)\1/g;

function collect(
  line: string,
  pattern: RegExp,
  kind: LinkKind,
  taken: boolean[],
  out: FoundLink[],
): void {
  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(line)) !== null) {
    const start = match.index;
    if (taken[start]) continue;

    const text = trimTrailing(match[0]);
    if (!text) continue;
    // A bare "~" is the home directory but reads as prose far more often.
    if (kind === 'path' && text.length < 3) continue;

    const end = start + text.length;
    for (let i = start; i < end; i += 1) taken[i] = true;
    out.push({ kind, text, start, end });
  }
}

/**
 * Every link in one logical line, ordered by position.
 *
 * Passes run most-specific first and mark the characters they consume, so a
 * path inside a URL is not also reported as a path. Overlaps are resolved by
 * whoever got there first rather than by length, which is why the order of the
 * calls below is load-bearing.
 */
export function findLinks(line: string): FoundLink[] {
  const taken = new Array<boolean>(line.length).fill(false);
  const found: FoundLink[] = [];

  // Quoted first: it is the only pass that can span a space, so anything it
  // claims would otherwise be truncated by one of the others.
  QUOTED.lastIndex = 0;
  let quoted: RegExpExecArray | null;
  while ((quoted = QUOTED.exec(line)) !== null) {
    const inner = quoted[2];
    const start = quoted.index + 1; // skip the opening quote
    const end = start + inner.length;
    if (inner.length < 3) continue;
    for (let i = start; i < end; i += 1) taken[i] = true;
    found.push({ kind: 'path', text: inner, start, end });
  }

  collect(line, URL, 'url', taken, found);
  collect(line, GS, 'gs', taken, found);
  collect(line, PATH, 'path', taken, found);

  return found.sort((a, b) => a.start - b.start);
}

/* ------------------------------------------------------------------ */
/* Buffer geometry                                                     */
/* ------------------------------------------------------------------ */

/** The slice of a terminal buffer this module needs. Narrow on purpose: it is
    what lets the geometry below be tested with a plain array of strings. */
export interface BufferLike {
  length: number;
  getLine(index: number): { isWrapped: boolean; translate(): string } | undefined;
}

export interface LogicalLine {
  text: string;
  /** 0-based buffer index of the line the logical line starts on. */
  startRow: number;
}

/**
 * Reassemble the logical line containing a buffer row.
 *
 * This is not optional detail. The paths these tools print are long, the
 * terminal lives in a dock a third of the window wide, and a wrapped path is
 * the *normal* case rather than an edge one. A provider that only looked at
 * single rows would link the first 80 characters of every run directory and
 * nothing else — which is worse than no link, because it looks like it worked.
 *
 * Every row but the last contributes its full width, since a wrapped row has
 * no trailing whitespace to trim — that is what makes index arithmetic against
 * `cols` valid in `positionAt`.
 */
export function logicalLineAt(buffer: BufferLike, row: number): LogicalLine | null {
  let start = row;
  for (;;) {
    const line = buffer.getLine(start);
    if (!line) return null;
    if (!line.isWrapped || start === 0) break;
    start -= 1;
  }

  const parts: string[] = [];
  let index = start;
  for (;;) {
    const line = buffer.getLine(index);
    if (!line) break;
    parts.push(line.translate());
    const next = buffer.getLine(index + 1);
    if (index + 1 >= buffer.length || !next?.isWrapped) break;
    index += 1;
  }

  return { text: parts.join(''), startRow: start };
}

/**
 * Map an index in a logical line to a buffer cell.
 *
 * Returns **1-based** x and y, which is what xterm's `ILink.range` wants — and
 * is one off from `buffer.getLine`, which is 0-based. Keeping the conversion in
 * one named function is the only reason that difference has not caused a bug
 * here.
 */
export function positionAt(
  index: number,
  startRow: number,
  cols: number,
): { x: number; y: number } {
  return {
    x: (index % cols) + 1,
    y: startRow + Math.floor(index / cols) + 1,
  };
}

/** What the panel shows while a link is hovered. */
export function describeLink(link: FoundLink): string {
  switch (link.kind) {
    case 'url':
      return `Open ${link.text} in a new tab`;
    case 'gs':
      return `Inspect ${link.text}`;
    case 'path':
      return `Open ${link.text}`;
  }
}
