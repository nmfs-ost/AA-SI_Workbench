/**
 * Reading and writing .ipynb documents.
 *
 * The governing constraint: **a notebook edited here must still open in
 * JupyterLab, unchanged except for what the user changed.** That rules out
 * parsing into a convenient shape and writing that shape back out, because
 * every field this module doesn't know about — cell metadata, attachments,
 * widget state, `collapsed` flags — would be silently dropped on the first
 * save. So each cell keeps its original object, and serialization writes the
 * edits *over* it.
 *
 * There is no kernel and no execution here. Outputs are preserved byte-for-byte
 * and rendered read-only; running a notebook is what Jupyter and the terminal
 * are for. Pretending otherwise would be the one dishonest thing in this panel.
 */

export type CellType = 'code' | 'markdown' | 'raw';

export interface NotebookCell {
  /** nbformat >= 4.5 cell id. Generated when a file predates the field. */
  id: string;
  cellType: CellType;
  /** Joined source, the way an editor wants it. */
  source: string;
  /** The original cell object, so unknown fields survive a save. */
  raw: Record<string, unknown>;
}

export interface Notebook {
  cells: NotebookCell[];
  /** The original document, minus cells — metadata, nbformat, everything else. */
  raw: Record<string, unknown>;
  nbformat: number;
  nbformatMinor: number;
  /** Kernel language, when the document declares one. Used for highlighting. */
  language: string;
}

export type NotebookParse =
  | { ok: true; notebook: Notebook }
  | { ok: false; error: string };

const CELL_TYPES: readonly CellType[] = ['code', 'markdown', 'raw'];

/** nbformat allows source as a string or a list of lines; normalise to a string. */
function joinSource(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((line) => String(line)).join('');
  return '';
}

/**
 * Split back into the line array Jupyter writes: every line keeps its trailing
 * newline except the last. Round-tripping an untouched notebook through
 * join → split therefore produces the identical array, which keeps diffs to
 * what the user actually edited.
 */
export function splitSource(source: string): string[] {
  if (source === '') return [];
  const lines = source.split('\n');
  return lines.map((line, index) =>
    index === lines.length - 1 ? line : `${line}\n`,
  ).filter((line, index, all) => !(index === all.length - 1 && line === ''));
}

/** A short, collision-resistant cell id in the shape Jupyter uses. */
export function makeCellId(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function newCell(cellType: CellType = 'code'): NotebookCell {
  return {
    id: makeCellId(),
    cellType,
    source: '',
    raw:
      cellType === 'code'
        ? { cell_type: 'code', execution_count: null, metadata: {}, outputs: [] }
        : { cell_type: cellType, metadata: {} },
  };
}

/** A minimal valid notebook, matching what the backend's create route writes. */
export function newNotebook(): Notebook {
  return {
    cells: [newCell('code')],
    raw: {
      metadata: {
        kernelspec: {
          display_name: 'Python 3',
          language: 'python',
          name: 'python3',
        },
        language_info: { name: 'python' },
      },
    },
    nbformat: 4,
    nbformatMinor: 5,
    language: 'python',
  };
}

export function parseNotebook(text: string): NotebookParse {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return {
      ok: false,
      error: "This file isn't valid JSON, so it can't be read as a notebook.",
    };
  }
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    return { ok: false, error: 'A notebook has to be a JSON object.' };
  }

  const record = document as Record<string, unknown>;
  const rawCells = record.cells;
  if (!Array.isArray(rawCells)) {
    return { ok: false, error: 'This JSON file has no cells, so it isn\u2019t a notebook.' };
  }

  const cells: NotebookCell[] = rawCells.map((entry) => {
    const cell = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<
      string,
      unknown
    >;
    const declared = String(cell.cell_type ?? 'code') as CellType;
    return {
      id: typeof cell.id === 'string' && cell.id ? cell.id : makeCellId(),
      cellType: CELL_TYPES.includes(declared) ? declared : 'raw',
      source: joinSource(cell.source),
      raw: cell,
    };
  });

  const metadata = (record.metadata ?? {}) as Record<string, unknown>;
  const languageInfo = (metadata.language_info ?? {}) as Record<string, unknown>;
  const kernelspec = (metadata.kernelspec ?? {}) as Record<string, unknown>;

  // Everything except the cells, kept verbatim so a save preserves it.
  const rest: Record<string, unknown> = { ...record };
  delete rest.cells;

  return {
    ok: true,
    notebook: {
      cells,
      raw: rest,
      nbformat: typeof record.nbformat === 'number' ? record.nbformat : 4,
      nbformatMinor:
        typeof record.nbformat_minor === 'number' ? record.nbformat_minor : 5,
      language: String(languageInfo.name ?? kernelspec.language ?? 'python'),
    },
  };
}

export function serializeNotebook(notebook: Notebook): string {
  const cells = notebook.cells.map((cell) => {
    const out: Record<string, unknown> = {
      ...cell.raw,
      cell_type: cell.cellType,
      id: cell.id,
      source: splitSource(cell.source),
    };
    // Keep the shape valid when a cell's type has been switched: only code
    // cells carry outputs and an execution count, and nbformat rejects them
    // anywhere else.
    if (cell.cellType === 'code') {
      if (!Array.isArray(out.outputs)) out.outputs = [];
      if (!('execution_count' in out)) out.execution_count = null;
    } else {
      delete out.outputs;
      delete out.execution_count;
    }
    if (typeof out.metadata !== 'object' || out.metadata === null) out.metadata = {};
    return out;
  });

  const document = {
    ...notebook.raw,
    cells,
    nbformat: notebook.nbformat,
    nbformat_minor: notebook.nbformatMinor,
  };
  // Jupyter writes one-space indentation and a trailing newline; matching it
  // keeps a save from showing up as a whole-file diff.
  return `${JSON.stringify(document, null, 1)}\n`;
}

/* ------------------------------------------------------------------ */
/* Cell operations — all pure, all returning a new notebook            */
/* ------------------------------------------------------------------ */

function withCells(notebook: Notebook, cells: NotebookCell[]): Notebook {
  return { ...notebook, cells };
}

export function setCellSource(
  notebook: Notebook,
  id: string,
  source: string,
): Notebook {
  return withCells(
    notebook,
    notebook.cells.map((cell) => (cell.id === id ? { ...cell, source } : cell)),
  );
}

export function setCellType(
  notebook: Notebook,
  id: string,
  cellType: CellType,
): Notebook {
  return withCells(
    notebook,
    notebook.cells.map((cell) => (cell.id === id ? { ...cell, cellType } : cell)),
  );
}

/** Insert a new cell below `id`, or at the end when `id` isn't found. */
export function insertCellAfter(
  notebook: Notebook,
  id: string,
  cellType: CellType = 'code',
): Notebook {
  const cells = [...notebook.cells];
  const index = cells.findIndex((cell) => cell.id === id);
  const cell = newCell(cellType);
  cells.splice(index === -1 ? cells.length : index + 1, 0, cell);
  return withCells(notebook, cells);
}

/**
 * Remove a cell, except the last one — a notebook with no cells is legal
 * nbformat but a dead end in the UI, with nothing left to click.
 */
export function deleteCell(notebook: Notebook, id: string): Notebook {
  if (notebook.cells.length <= 1) return notebook;
  return withCells(
    notebook,
    notebook.cells.filter((cell) => cell.id !== id),
  );
}

export function moveCell(notebook: Notebook, id: string, delta: number): Notebook {
  const cells = [...notebook.cells];
  const index = cells.findIndex((cell) => cell.id === id);
  const target = index + delta;
  if (index === -1 || target < 0 || target >= cells.length) return notebook;
  const [cell] = cells.splice(index, 1);
  cells.splice(target, 0, cell);
  return withCells(notebook, cells);
}

/* ------------------------------------------------------------------ */
/* Outputs — rendered, never edited                                    */
/* ------------------------------------------------------------------ */

export interface CellOutput {
  /** 'stream' | 'result' | 'error' | 'image' */
  kind: 'stream' | 'result' | 'error' | 'image';
  text: string;
  /** data: URL for image/png outputs, so they render without another request. */
  imageUrl?: string;
}

/** Flatten a code cell's stored outputs into something displayable. */
export function cellOutputs(cell: NotebookCell): CellOutput[] {
  const raw = cell.raw.outputs;
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry): CellOutput[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const output = entry as Record<string, unknown>;
    const type = String(output.output_type ?? '');

    if (type === 'stream') {
      return [{ kind: 'stream', text: joinSource(output.text) }];
    }
    if (type === 'error') {
      const trace = Array.isArray(output.traceback)
        ? output.traceback.map(String).join('\n')
        : `${String(output.ename ?? 'Error')}: ${String(output.evalue ?? '')}`;
      return [{ kind: 'error', text: trace }];
    }
    if (type === 'execute_result' || type === 'display_data') {
      const data = (output.data ?? {}) as Record<string, unknown>;
      const png = data['image/png'];
      if (typeof png === 'string') {
        return [
          {
            kind: 'image',
            text: '',
            imageUrl: `data:image/png;base64,${png.replace(/\s/g, '')}`,
          },
        ];
      }
      return [{ kind: 'result', text: joinSource(data['text/plain']) }];
    }
    return [];
  });
}

/** ANSI escape sequences appear in tracebacks; strip them for plain display. */
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
}
