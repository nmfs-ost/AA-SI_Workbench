import { describe, expect, it } from 'vitest';

import {
  cellOutputs,
  deleteCell,
  insertCellAfter,
  moveCell,
  newNotebook,
  parseNotebook,
  serializeNotebook,
  setCellSource,
  setCellType,
  splitSource,
  stripAnsi,
} from '../src/components/panels/editor/notebook';

/**
 * A notebook the Workbench opens was almost certainly written by Jupyter and
 * will be opened by Jupyter again. These tests hold the line that matters most:
 * saving a notebook must not damage anything the Workbench doesn't understand.
 */

const SAMPLE = {
  cells: [
    {
      cell_type: 'markdown',
      id: 'intro',
      metadata: { tags: ['heading'] },
      source: ['# Survey review\n', '\n', 'Notes.'],
    },
    {
      cell_type: 'code',
      id: 'load',
      execution_count: 7,
      metadata: { scrolled: true, collapsed: false },
      outputs: [
        { output_type: 'stream', name: 'stdout', text: ['loaded 12 files\n'] },
        {
          output_type: 'execute_result',
          execution_count: 7,
          data: { 'text/plain': ['<xarray.Dataset>'] },
          metadata: {},
        },
      ],
      source: ['import echopype as ep\n', 'ds = ep.open_raw(path)'],
    },
  ],
  metadata: {
    kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' },
    language_info: { name: 'python', version: '3.11.7' },
    // A key no part of the Workbench knows about.
    aa_si_custom: { survey: 'HB1906', reviewed_by: 'nobody' },
  },
  nbformat: 4,
  nbformat_minor: 5,
};

function parseOrThrow(text: string) {
  const parsed = parseNotebook(text);
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.notebook;
}

describe('parseNotebook', () => {
  it('reads cells, ids, types and joined source', () => {
    const notebook = parseOrThrow(JSON.stringify(SAMPLE));
    expect(notebook.cells).toHaveLength(2);
    expect(notebook.cells[0].cellType).toBe('markdown');
    expect(notebook.cells[0].id).toBe('intro');
    expect(notebook.cells[0].source).toBe('# Survey review\n\nNotes.');
    expect(notebook.cells[1].source).toBe('import echopype as ep\nds = ep.open_raw(path)');
    expect(notebook.language).toBe('python');
  });

  it('accepts a source given as a single string', () => {
    const notebook = parseOrThrow(
      JSON.stringify({ cells: [{ cell_type: 'code', source: 'x = 1' }], nbformat: 4 }),
    );
    expect(notebook.cells[0].source).toBe('x = 1');
  });

  it('invents an id for a cell that has none, so React keys stay stable', () => {
    const notebook = parseOrThrow(
      JSON.stringify({ cells: [{ cell_type: 'code', source: '' }] }),
    );
    expect(notebook.cells[0].id).toMatch(/\S/);
  });

  it('explains itself instead of throwing on input that is not a notebook', () => {
    expect(parseNotebook('not json').ok).toBe(false);
    expect(parseNotebook('[]').ok).toBe(false);
    expect(parseNotebook('{"a": 1}').ok).toBe(false);
    const failure = parseNotebook('not json');
    if (!failure.ok) expect(failure.error.length).toBeGreaterThan(10);
  });
});

describe('serializeNotebook', () => {
  it('preserves metadata it does not understand', () => {
    const text = serializeNotebook(parseOrThrow(JSON.stringify(SAMPLE)));
    const document = JSON.parse(text);
    expect(document.metadata.aa_si_custom).toEqual({
      survey: 'HB1906',
      reviewed_by: 'nobody',
    });
    expect(document.metadata.kernelspec.name).toBe('python3');
  });

  it('preserves outputs and execution counts byte for byte', () => {
    const text = serializeNotebook(parseOrThrow(JSON.stringify(SAMPLE)));
    const document = JSON.parse(text);
    expect(document.cells[1].outputs).toEqual(SAMPLE.cells[1].outputs);
    expect(document.cells[1].execution_count).toBe(7);
    expect(document.cells[1].metadata).toEqual({ scrolled: true, collapsed: false });
  });

  it('round-trips a full notebook with no semantic change', () => {
    const once = serializeNotebook(parseOrThrow(JSON.stringify(SAMPLE)));
    const twice = serializeNotebook(parseOrThrow(once));
    expect(twice).toBe(once);
    expect(JSON.parse(once)).toEqual({
      ...SAMPLE,
      // Source is stored as a line array either way; the sample already is one.
      cells: SAMPLE.cells,
    });
  });

  it("writes Jupyter's formatting so a save isn't a whole-file diff", () => {
    const text = serializeNotebook(parseOrThrow(JSON.stringify(SAMPLE)));
    expect(text.endsWith('\n')).toBe(true);
    // One space of indentation per level, which is what nbformat writes.
    expect(text.split('\n')[1]).toMatch(/^ "/);
    expect(text.split('\n')[1]).not.toMatch(/^ {2}"/);
  });

  it('drops outputs when a code cell becomes markdown, as nbformat requires', () => {
    const notebook = parseOrThrow(JSON.stringify(SAMPLE));
    const changed = setCellType(notebook, 'load', 'markdown');
    const document = JSON.parse(serializeNotebook(changed));
    expect(document.cells[1].cell_type).toBe('markdown');
    expect(document.cells[1]).not.toHaveProperty('outputs');
    expect(document.cells[1]).not.toHaveProperty('execution_count');
  });

  it('gives a new code cell the fields nbformat demands', () => {
    const document = JSON.parse(serializeNotebook(newNotebook()));
    expect(document.nbformat).toBe(4);
    expect(document.cells[0].outputs).toEqual([]);
    expect(document.cells[0].execution_count).toBeNull();
    expect(typeof document.cells[0].id).toBe('string');
  });
});

describe('cell operations', () => {
  const base = parseOrThrow(JSON.stringify(SAMPLE));

  it('edits one cell and leaves the rest identical', () => {
    const next = setCellSource(base, 'intro', 'changed');
    expect(next.cells[0].source).toBe('changed');
    expect(next.cells[1]).toBe(base.cells[1]);
    expect(base.cells[0].source).toBe('# Survey review\n\nNotes.');
  });

  it('inserts after the named cell', () => {
    const next = insertCellAfter(base, 'intro');
    expect(next.cells).toHaveLength(3);
    expect(next.cells[1].source).toBe('');
    expect(next.cells[2].id).toBe('load');
  });

  it('moves a cell and clamps at the ends', () => {
    expect(moveCell(base, 'load', -1).cells.map((c) => c.id)).toEqual(['load', 'intro']);
    expect(moveCell(base, 'intro', -1).cells.map((c) => c.id)).toEqual(['intro', 'load']);
    expect(moveCell(base, 'load', 1).cells.map((c) => c.id)).toEqual(['intro', 'load']);
  });

  it('never deletes the last cell', () => {
    const one = deleteCell(base, 'intro');
    expect(one.cells).toHaveLength(1);
    expect(deleteCell(one, 'load').cells).toHaveLength(1);
  });
});

describe('output rendering', () => {
  it('reads stream text, results and errors', () => {
    const notebook = parseOrThrow(JSON.stringify(SAMPLE));
    const outputs = cellOutputs(notebook.cells[1]);
    expect(outputs[0].text).toBe('loaded 12 files\n');
    expect(outputs[1].text).toContain('xarray.Dataset');
  });

  it('strips the escape codes a terminal traceback carries', () => {
    expect(stripAnsi('\u001b[0;31mValueError\u001b[0m: bad')).toBe('ValueError: bad');
  });
});

describe('splitSource', () => {
  it('keeps the newline on each line, as nbformat specifies', () => {
    expect(splitSource('a\nb')).toEqual(['a\n', 'b']);
    expect(splitSource('a\n')).toEqual(['a\n']);
    expect(splitSource('')).toEqual([]);
  });
});

/**
 * Output rendering — the graphics path.
 *
 * A notebook is opened to look at its figures, so the representation chosen
 * for an output is the whole feature. These pin the two things that are easy
 * to get wrong: picking the *best* available representation rather than the
 * first one enumerated, and encoding SVG in a way that survives a non-ASCII
 * axis label.
 */
describe('cellOutputs', () => {
  const codeCell = (outputs: unknown[]) =>
    parseOrThrow(
      JSON.stringify({
        nbformat: 4,
        nbformat_minor: 5,
        metadata: {},
        cells: [
          { cell_type: 'code', id: 'a', source: 'plot()', metadata: {}, execution_count: 1, outputs },
        ],
      }),
    ).cells[0];

  it('renders a PNG figure as an inline data URL', () => {
    const [out] = cellOutputs(
      codeCell([{ output_type: 'display_data', data: { 'image/png': 'iVBORw0KGgo=' }, metadata: {} }]),
    );
    expect(out.kind).toBe('image');
    expect(out.imageUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('strips the newlines Jupyter wraps base64 payloads at', () => {
    const [out] = cellOutputs(
      codeCell([
        { output_type: 'display_data', data: { 'image/png': 'iVBOR\nw0KG\ngo=' }, metadata: {} },
      ]),
    );
    expect(out.imageUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
  });

  it('prefers the image over the text/plain that accompanies it', () => {
    // matplotlib writes both. Showing "<Figure size 640x480>" instead of the
    // figure is the failure this guards against.
    const outs = cellOutputs(
      codeCell([
        {
          output_type: 'execute_result',
          data: { 'text/plain': '<Figure size 640x480 with 1 Axes>', 'image/png': 'iVBORw0=' },
          metadata: {},
        },
      ]),
    );
    expect(outs).toHaveLength(1);
    expect(outs[0].kind).toBe('image');
  });

  it('prefers PNG when several image representations are stored', () => {
    const [out] = cellOutputs(
      codeCell([
        {
          output_type: 'display_data',
          data: { 'image/svg+xml': '<svg/>', 'image/jpeg': '/9j/4AA=', 'image/png': 'iVBORw0=' },
          metadata: {},
        },
      ]),
    );
    expect(out.imageUrl?.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('percent-encodes SVG, which is stored as text rather than base64', () => {
    const [out] = cellOutputs(
      codeCell([
        {
          output_type: 'display_data',
          data: { 'image/svg+xml': ['<svg>', '<text>Sv (dB)</text>', '</svg>'] },
          metadata: {},
        },
      ]),
    );
    expect(out.kind).toBe('image');
    expect(out.imageUrl?.startsWith('data:image/svg+xml,')).toBe(true);
    expect(decodeURIComponent(out.imageUrl!.slice('data:image/svg+xml,'.length))).toContain(
      'Sv (dB)',
    );
  });

  it('survives a non-Latin-1 glyph in an SVG label', () => {
    // btoa() throws here. Axis units are exactly where degrees and micro signs
    // turn up, so this is the realistic case rather than an exotic one.
    const [out] = cellOutputs(
      codeCell([
        { output_type: 'display_data', data: { 'image/svg+xml': '<text>°C ± 2 µm</text>' }, metadata: {} },
      ]),
    );
    expect(out.imageUrl).toBeDefined();
    expect(decodeURIComponent(out.imageUrl!.slice('data:image/svg+xml,'.length))).toContain('°C');
  });

  it('does not render stored HTML', () => {
    // A DataFrame's HTML would look better than its text form, but rendering
    // markup out of a file means trusting it. The text/plain says the same
    // thing safely.
    const [out] = cellOutputs(
      codeCell([
        {
          output_type: 'execute_result',
          data: { 'text/html': '<table><tr><td>1</td></tr></table>', 'text/plain': '   a\n0  1' },
          metadata: {},
        },
      ]),
    );
    expect(out.kind).toBe('result');
    expect(out.text).toContain('a');
    expect(out.imageUrl).toBeUndefined();
  });

  it('keeps streams and errors distinct from results', () => {
    const outs = cellOutputs(
      codeCell([
        { output_type: 'stream', name: 'stdout', text: ['loading\n', 'done\n'] },
        { output_type: 'error', ename: 'ValueError', evalue: 'bad', traceback: ['line 1', 'line 2'] },
      ]),
    );
    expect(outs.map((o) => o.kind)).toEqual(['stream', 'error']);
    expect(outs[0].text).toBe('loading\ndone\n');
    expect(outs[1].text).toBe('line 1\nline 2');
  });

  it('ignores malformed output entries rather than throwing', () => {
    expect(cellOutputs(codeCell([null, 'nonsense', { output_type: 'unknown' }]))).toEqual([]);
  });
});
