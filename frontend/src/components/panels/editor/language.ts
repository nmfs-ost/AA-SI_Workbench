/**
 * What kind of thing is this file, and can we open it?
 *
 * Two separate questions that are easy to conflate. `documentViewFor` decides
 * which *surface* renders a file (a text editor, a notebook, an image, or an
 * explanation). `languageFor` decides how to colour the text once it's open.
 * Both are pure lookups on the extension so they can be unit-tested and so a
 * new file type is one table entry, not a branch in a component.
 */

import type { FsKind } from '../../../services/filesApi';
import { extname } from './paths';

/** Syntax families the highlighter knows. `plain` means "no colouring". */
export type Language =
  | 'python'
  | 'json'
  | 'markdown'
  | 'shell'
  | 'javascript'
  | 'yaml'
  | 'plain';

/** Which editing surface a file gets. */
export type DocumentView = 'text' | 'notebook' | 'image' | 'unsupported';

const LANGUAGE_BY_EXTENSION: Record<string, Language> = {
  '.py': 'python',
  '.pyi': 'python',
  '.ipynb': 'json',
  '.json': 'json',
  '.geojson': 'json',
  '.md': 'markdown',
  '.markdown': 'markdown',
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'javascript',
  '.tsx': 'javascript',
  '.yml': 'yaml',
  '.yaml': 'yaml',
  '.toml': 'yaml',
  '.cfg': 'yaml',
  '.ini': 'yaml',
};

/** Files with no extension that are still worth colouring. */
const LANGUAGE_BY_NAME: Record<string, Language> = {
  dockerfile: 'shell',
  makefile: 'shell',
  '.bashrc': 'shell',
  '.zshrc': 'shell',
  '.profile': 'shell',
  '.gitignore': 'plain',
};

export function languageFor(path: string): Language {
  const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extname(path)] ?? LANGUAGE_BY_NAME[name] ?? 'plain';
}

/**
 * The surface for a file, from the kind the backend tagged it with.
 *
 * `file` — an extension nothing recognised — is treated as text rather than
 * unsupported: the server has already established the bytes decode as UTF-8 by
 * the time this matters, and a scientist's `.dat` of ASCII numbers should open.
 */
export function documentViewFor(kind: FsKind, path = ''): DocumentView {
  if (kind === 'notebook') return 'notebook';
  if (kind === 'image') return 'image';
  if (kind === 'raw' || kind === 'netcdf' || kind === 'zarr' || kind === 'folder') {
    return 'unsupported';
  }
  if (kind === 'file' && extname(path) === '.ipynb') return 'notebook';
  return 'text';
}

/**
 * Should a click in a file listing open this?
 *
 * Anything with a viewable surface, which is everything except the scientific
 * binaries. Those keep their existing behaviour — identify into Metadata, hand
 * the path to a pipeline — because a 400 MB `.raw` has nothing to show and
 * opening a tab that says so on every click would be worse than not opening.
 */
export function isOpenable(kind: FsKind, path = ''): boolean {
  return documentViewFor(kind, path) !== 'unsupported';
}

/** Human label for the "you can't open this" state, phrased as a fact. */
export function unsupportedReason(kind: FsKind): string {
  switch (kind) {
    case 'raw':
      return 'Raw echosounder files are binary instrument data. Convert one with aa-raw to inspect it.';
    case 'netcdf':
      return 'NetCDF is a binary container. Open it with echopype or xarray in a notebook.';
    case 'zarr':
      return 'A Zarr store is a directory of compressed chunks rather than a single readable file.';
    default:
      return 'There is no viewer for this file type.';
  }
}
