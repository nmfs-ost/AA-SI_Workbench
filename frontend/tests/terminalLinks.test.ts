import { describe, expect, it } from 'vitest';

import {
  describeLink,
  findLinks,
  logicalLineAt,
  positionAt,
  type BufferLike,
} from '../src/components/panels/terminalLinks';

/**
 * Terminal link detection.
 *
 * The cases here are mostly transcriptions of what the aa-* tools actually
 * print, because the failure mode that matters is not "missed a link" — it is
 * "linked something that is not a path", which sends a click to `/api/fs/stat`
 * for a string that was never a file, and "linked half a path", which looks
 * like it worked and opens the wrong thing.
 */

describe('URLs', () => {
  it('finds a plain http link', () => {
    const [link] = findLinks('See https://example.com/docs for details');
    expect(link).toMatchObject({ kind: 'url', text: 'https://example.com/docs' });
  });

  it('drops the full stop that ended the sentence', () => {
    const [link] = findLinks('Docs are at https://example.com/guide.');
    expect(link.text).toBe('https://example.com/guide');
  });

  it('keeps a bracket the URL actually contains', () => {
    const [link] = findLinks('https://en.wikipedia.org/wiki/Echo_(disambiguation)');
    expect(link.text).toBe('https://en.wikipedia.org/wiki/Echo_(disambiguation)');
  });

  it('drops a bracket the prose contributed', () => {
    const [link] = findLinks('(see https://example.com/x)');
    expect(link.text).toBe('https://example.com/x');
  });

  it('does not also report the URL path as a path', () => {
    // The bug this prevents: `https://host/a/b` yielding a second link to
    // `/a/b`, which is a real directory on plenty of machines.
    const links = findLinks('https://example.com/home/data');
    expect(links).toHaveLength(1);
    expect(links[0].kind).toBe('url');
  });
});

describe('bucket URIs', () => {
  it('finds a gs:// object', () => {
    const [link] = findLinks('Uploaded gs://ggn-nmfs-aa-dev-1-data/derived/HB1603.zarr');
    expect(link).toMatchObject({
      kind: 'gs',
      text: 'gs://ggn-nmfs-aa-dev-1-data/derived/HB1603.zarr',
    });
  });

  it('finds a bare bucket', () => {
    const [link] = findLinks('bucket is gs://ggn-nmfs-aa-dev-1-data');
    expect(link.text).toBe('gs://ggn-nmfs-aa-dev-1-data');
  });

  it('does not also report the object path as a path', () => {
    const links = findLinks('gs://bucket/a/b/c.zarr');
    expect(links).toHaveLength(1);
    expect(links[0].kind).toBe('gs');
  });
});

describe('paths', () => {
  it('finds an absolute path', () => {
    const [link] = findLinks('Wrote /home/ada/HB1603_EK60_NCEI/survey.zarr');
    expect(link).toMatchObject({
      kind: 'path',
      text: '/home/ada/HB1603_EK60_NCEI/survey.zarr',
    });
  });

  it('finds a directory with no extension', () => {
    // aa-fetch and aa-ed both print a directory, which is exactly why the
    // panel has to ask /api/fs/stat rather than reading the suffix.
    const [link] = findLinks('Run directory: /home/ada/aa-runs/20260805T1422');
    expect(link.text).toBe('/home/ada/aa-runs/20260805T1422');
  });

  it('keeps a trailing slash', () => {
    const [link] = findLinks('into /home/ada/Downloads/');
    expect(link.text).toBe('/home/ada/Downloads/');
  });

  it('expands from a tilde', () => {
    const [link] = findLinks('config at ~/.config/aa/settings.toml');
    expect(link).toMatchObject({ kind: 'path', text: '~/.config/aa/settings.toml' });
  });

  it('links a quoted path containing a space', () => {
    // The name in the repo's own cautionary example. Without the quoted pass
    // this links as far as "Dyson's" and points at nothing.
    const [link] = findLinks(`saved to "/data/Dysons Bank/leg 2.raw"`);
    expect(link.text).toBe('/data/Dysons Bank/leg 2.raw');
  });

  it('excludes the quotes from the range', () => {
    const line = `path: "/data/x.raw"`;
    const [link] = findLinks(line);
    expect(line.slice(link.start, link.end)).toBe('/data/x.raw');
  });

  it('drops the full stop that ended the sentence', () => {
    const [link] = findLinks('Nothing at /home/ada/missing.');
    expect(link.text).toBe('/home/ada/missing');
  });

  it.each([
    ['and/or', 'a slash between two words'],
    ['38/120 kHz', 'a ratio'],
    ['see doc/readme.md', 'a relative path'],
    ['100%', 'no slash at all'],
    ['/', 'the root on its own'],
  ])('does not link %s (%s)', (line) => {
    expect(findLinks(line)).toHaveLength(0);
  });

  it('finds several paths on one line', () => {
    const links = findLinks('cp /data/a.raw /data/b.raw');
    expect(links.map((l) => l.text)).toEqual(['/data/a.raw', '/data/b.raw']);
  });

  it('reports links in positional order', () => {
    const links = findLinks('gs://bucket/x then /home/ada/y then https://example.com');
    expect(links.map((l) => l.kind)).toEqual(['gs', 'path', 'url']);
  });
});

describe('describeLink', () => {
  it('says what each kind will do', () => {
    expect(describeLink({ kind: 'url', text: 'u', start: 0, end: 1 })).toContain('tab');
    expect(describeLink({ kind: 'gs', text: 'g', start: 0, end: 1 })).toContain('Inspect');
    expect(describeLink({ kind: 'path', text: 'p', start: 0, end: 1 })).toContain('Open');
  });
});

/* ------------------------------------------------------------------ */
/* Buffer geometry                                                     */
/* ------------------------------------------------------------------ */

/** A buffer built from fixed-width rows, the way xterm stores a wrapped line. */
function bufferOf(rows: ReadonlyArray<{ text: string; isWrapped: boolean }>): BufferLike {
  return {
    length: rows.length,
    getLine: (index) => {
      const row = rows[index];
      return row ? { isWrapped: row.isWrapped, translate: () => row.text } : undefined;
    },
  };
}

describe('logicalLineAt', () => {
  it('returns a single unwrapped line as-is', () => {
    const buffer = bufferOf([{ text: 'hello', isWrapped: false }]);
    expect(logicalLineAt(buffer, 0)).toEqual({ text: 'hello', startRow: 0 });
  });

  it('joins a wrapped line from its first row', () => {
    const buffer = bufferOf([
      { text: '/home/ada/', isWrapped: false },
      { text: 'survey.raw', isWrapped: true },
    ]);
    expect(logicalLineAt(buffer, 0)).toEqual({
      text: '/home/ada/survey.raw',
      startRow: 0,
    });
  });

  it('walks back to the start when asked about a continuation row', () => {
    // xterm calls the provider per visible row, so the continuation is asked
    // about as often as the first row is.
    const buffer = bufferOf([
      { text: '/home/ada/', isWrapped: false },
      { text: 'survey.raw', isWrapped: true },
    ]);
    expect(logicalLineAt(buffer, 1)).toEqual({
      text: '/home/ada/survey.raw',
      startRow: 0,
    });
  });

  it('joins three rows and stops at the next unwrapped one', () => {
    const buffer = bufferOf([
      { text: 'before', isWrapped: false },
      { text: 'aaa', isWrapped: false },
      { text: 'bbb', isWrapped: true },
      { text: 'ccc', isWrapped: true },
      { text: 'after', isWrapped: false },
    ]);
    expect(logicalLineAt(buffer, 2)).toEqual({ text: 'aaabbbccc', startRow: 1 });
  });

  it('finds a path that only exists across the wrap', () => {
    const buffer = bufferOf([
      { text: 'wrote /home/ada/HB1603_', isWrapped: false },
      { text: 'EK60_NCEI/survey.zarr', isWrapped: true },
    ]);
    const line = logicalLineAt(buffer, 0);
    const [link] = findLinks(line!.text);
    expect(link.text).toBe('/home/ada/HB1603_EK60_NCEI/survey.zarr');
  });

  it('returns null past the end of the buffer', () => {
    expect(logicalLineAt(bufferOf([]), 0)).toBeNull();
  });
});

describe('positionAt', () => {
  const COLS = 10;

  it('is 1-based, because ILink.range is', () => {
    expect(positionAt(0, 0, COLS)).toEqual({ x: 1, y: 1 });
  });

  it('stays on the first row within the width', () => {
    expect(positionAt(9, 0, COLS)).toEqual({ x: 10, y: 1 });
  });

  it('rolls onto the next row at the width', () => {
    expect(positionAt(10, 0, COLS)).toEqual({ x: 1, y: 2 });
  });

  it('offsets by the logical line start', () => {
    expect(positionAt(12, 4, COLS)).toEqual({ x: 3, y: 6 });
  });

  it('places a link that spans a wrap on two different rows', () => {
    const start = positionAt(6, 0, COLS);
    const end = positionAt(15, 0, COLS);
    expect(start.y).toBe(1);
    expect(end.y).toBe(2);
  });
});
