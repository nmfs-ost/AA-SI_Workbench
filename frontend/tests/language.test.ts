import { describe, expect, it } from 'vitest';

import {
  basename,
  dirname,
  ellipsizePath,
  extname,
} from '../src/components/panels/editor/paths';
import {
  documentViewFor,
  isOpenable,
  languageFor,
  unsupportedReason,
} from '../src/components/panels/editor/language';
import type { FsKind } from '../src/services/filesApi';

/**
 * These functions decide what happens when a scientist clicks a file, so the
 * cases that matter are the awkward ones: dotfiles, no extension, and the
 * multi-gigabyte binaries that must never be loaded as text.
 */

describe('path helpers', () => {
  it('splits absolute POSIX paths', () => {
    expect(basename('/home/user/a.py')).toBe('a.py');
    expect(dirname('/home/user/a.py')).toBe('/home/user');
    expect(extname('/home/user/a.py')).toBe('.py');
  });

  it('handles a file at the root', () => {
    expect(basename('/a.txt')).toBe('a.txt');
    expect(dirname('/a.txt')).toBe('/');
  });

  it('treats a leading dot as part of the name, not an extension', () => {
    expect(extname('/home/user/.bashrc')).toBe('');
    expect(basename('/home/user/.bashrc')).toBe('.bashrc');
  });

  it('lowercases extensions so matching is case-insensitive', () => {
    expect(extname('/x/DATA.CSV')).toBe('.csv');
  });

  it('shortens a long path from the left, keeping the filename', () => {
    const long = '/home/user/surveys/HB1906/EK60/raw/D20190812-T161746.raw';
    const short = ellipsizePath(long, 30);
    expect(short.length).toBeLessThanOrEqual(30);
    expect(short.startsWith('…')).toBe(true);
    expect(short.endsWith('D20190812-T161746.raw')).toBe(true);
    expect(ellipsizePath('/short/path', 30)).toBe('/short/path');
  });
});

describe('languageFor', () => {
  const cases: Array<[string, string]> = [
    ['/x/a.py', 'python'],
    ['/x/a.ipynb', 'json'],
    ['/x/a.json', 'json'],
    ['/x/a.md', 'markdown'],
    ['/x/a.sh', 'shell'],
    ['/x/a.yaml', 'yaml'],
    ['/x/a.yml', 'yaml'],
    ['/x/a.ts', 'javascript'],
    ['/x/a.csv', 'plain'],
    ['/x/LICENSE', 'plain'],
  ];
  for (const [path, expected] of cases) {
    it(`${path} → ${expected}`, () => expect(languageFor(path)).toBe(expected));
  }

  it('recognises well-known dotfiles by name', () => {
    expect(languageFor('/x/.bashrc')).toBe('shell');
  });
});

describe('documentViewFor', () => {
  it('routes a notebook to the cell editor', () => {
    expect(documentViewFor('notebook', '/x/a.ipynb')).toBe('notebook');
    // Extension wins even if the server guessed a generic kind.
    expect(documentViewFor('file', '/x/a.ipynb')).toBe('notebook');
  });

  it('routes images to the image view', () => {
    expect(documentViewFor('image', '/x/a.png')).toBe('image');
  });

  it('refuses the acoustic binaries', () => {
    for (const kind of ['raw', 'netcdf', 'zarr'] as FsKind[]) {
      expect(documentViewFor(kind, '/x/f')).toBe('unsupported');
      expect(isOpenable(kind, '/x/f')).toBe(false);
      expect(unsupportedReason(kind).length).toBeGreaterThan(10);
    }
  });

  it('opens everything else as text', () => {
    for (const kind of ['text', 'python', 'markdown', 'table', 'file'] as FsKind[]) {
      expect(documentViewFor(kind, '/x/f')).toBe('text');
      expect(isOpenable(kind, '/x/f')).toBe(true);
    }
  });

  it('never opens a folder', () => {
    expect(isOpenable('folder', '/x/dir')).toBe(false);
  });
});
