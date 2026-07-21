import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, IconButton, Tooltip, Typography, useTheme } from '@mui/material';
import {
  AddOutlined,
  ArrowDownwardOutlined,
  ArrowUpwardOutlined,
  DeleteOutlineOutlined,
} from '@mui/icons-material';

import { CodeEditor } from './CodeEditor';
import {
  cellOutputs,
  deleteCell,
  insertCellAfter,
  moveCell,
  parseNotebook,
  serializeNotebook,
  setCellSource,
  setCellType,
  stripAnsi,
  type CellType,
  type Notebook,
  type NotebookCell,
} from './notebook';

/**
 * A Jupyter notebook, editable as a document.
 *
 * What this is: a way to read a notebook and change its cells without leaving
 * the Workbench — fix a path, add a note, reorder an analysis, start a new one.
 *
 * What this is **not**: a kernel. Nothing here executes. Outputs are whatever
 * Jupyter last wrote and are shown read-only, preserved exactly on save. The
 * "Run" affordance is deliberately absent rather than present-and-disabled,
 * because a greyed-out run button reads as "not yet", and this one isn't
 * coming — running notebooks is what JupyterLab and the terminal are for.
 *
 * The notebook is held as parsed state here and pushed back to the editor
 * store as serialized JSON on every edit, so the dirty flag, Save, and revert
 * all work on exactly the same text a plain file would.
 */

interface Props {
  /** Serialized .ipynb JSON — the editor store's buffer. */
  text: string;
  onChange: (next: string) => void;
  onSave?: () => void;
  readOnly?: boolean;
}

const CELL_TYPE_LABEL: Record<CellType, string> = {
  code: 'Code',
  markdown: 'Markdown',
  raw: 'Raw',
};

function CellToolbar({
  cell,
  readOnly,
  onMove,
  onDelete,
  onInsert,
  onToggleType,
  canDelete,
}: {
  cell: NotebookCell;
  readOnly: boolean;
  onMove: (delta: number) => void;
  onDelete: () => void;
  onInsert: () => void;
  onToggleType: () => void;
  canDelete: boolean;
}) {
  const theme = useTheme();
  return (
    <Box
      className="aa-cell-tools"
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.25,
        opacity: 0,
        transition: 'opacity .12s',
        '&:focus-within': { opacity: 1 },
      }}
    >
      <Tooltip title={`Switch to ${cell.cellType === 'code' ? 'Markdown' : 'Code'}`}>
        <Typography
          component="button"
          disabled={readOnly}
          onClick={onToggleType}
          sx={{
            fontSize: 10.5,
            letterSpacing: 0.4,
            textTransform: 'uppercase',
            color: theme.aa.color.text.secondary,
            background: 'none',
            border: `1px solid ${theme.aa.color.border.subtle}`,
            borderRadius: `${theme.aa.radius.sm}px`,
            px: 0.6,
            py: 0.1,
            cursor: readOnly ? 'default' : 'pointer',
            '&:hover': { borderColor: theme.aa.color.accent.main },
          }}
        >
          {CELL_TYPE_LABEL[cell.cellType]}
        </Typography>
      </Tooltip>
      <Tooltip title="Move up">
        <span>
          <IconButton size="small" disabled={readOnly} onClick={() => onMove(-1)}>
            <ArrowUpwardOutlined sx={{ fontSize: 13 }} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Move down">
        <span>
          <IconButton size="small" disabled={readOnly} onClick={() => onMove(1)}>
            <ArrowDownwardOutlined sx={{ fontSize: 13 }} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title="Add cell below">
        <span>
          <IconButton size="small" disabled={readOnly} onClick={onInsert}>
            <AddOutlined sx={{ fontSize: 14 }} />
          </IconButton>
        </span>
      </Tooltip>
      <Tooltip title={canDelete ? 'Delete cell' : 'A notebook keeps at least one cell'}>
        <span>
          <IconButton
            size="small"
            disabled={readOnly || !canDelete}
            onClick={onDelete}
          >
            <DeleteOutlineOutlined sx={{ fontSize: 14 }} />
          </IconButton>
        </span>
      </Tooltip>
    </Box>
  );
}

function Outputs({ cell }: { cell: NotebookCell }) {
  const theme = useTheme();
  const outputs = useMemo(() => cellOutputs(cell), [cell]);
  if (outputs.length === 0) return null;

  return (
    <Box
      sx={{
        borderTop: `1px solid ${theme.aa.color.border.subtle}`,
        px: 1.25,
        py: 0.75,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.75,
      }}
    >
      {outputs.map((output, index) => {
        if (output.kind === 'image' && output.imageUrl) {
          return (
            <Box
              key={index}
              component="img"
              src={output.imageUrl}
              alt="Notebook output"
              sx={{ maxWidth: '100%', alignSelf: 'flex-start' }}
            />
          );
        }
        return (
          <Box
            key={index}
            component="pre"
            sx={{
              m: 0,
              fontFamily: theme.aa.font.mono,
              fontSize: 11.5,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
              color:
                output.kind === 'error'
                  ? theme.aa.color.status.error
                  : theme.aa.color.text.secondary,
            }}
          >
            {stripAnsi(output.text)}
          </Box>
        );
      })}
    </Box>
  );
}

export function NotebookEditor({ text, onChange, onSave, readOnly = false }: Props) {
  const theme = useTheme();
  const [notebook, setNotebook] = useState<Notebook | null>(null);
  const [error, setError] = useState('');
  /** The text this component last emitted, so its own writes don't reset it. */
  const emittedRef = useRef<string | null>(null);

  useEffect(() => {
    if (emittedRef.current === text) return;
    const parsed = parseNotebook(text);
    if (parsed.ok) {
      setNotebook(parsed.notebook);
      setError('');
    } else {
      setNotebook(null);
      setError(parsed.error);
    }
  }, [text]);

  const apply = useCallback(
    (next: Notebook) => {
      setNotebook(next);
      const serialized = serializeNotebook(next);
      emittedRef.current = serialized;
      onChange(serialized);
    },
    [onChange],
  );

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography sx={{ fontSize: 12.5, color: theme.aa.color.status.error }}>
          {error}
        </Typography>
        <Typography sx={{ fontSize: 12, color: theme.aa.color.text.muted, mt: 1 }}>
          Nothing has been changed on disk. Open it in a terminal to inspect the
          raw JSON.
        </Typography>
      </Box>
    );
  }

  if (!notebook) return null;

  const canDelete = notebook.cells.length > 1;

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          p: 1.5,
          maxWidth: 1100,
        }}
      >
        {notebook.cells.map((cell, index) => (
          <Box
            key={cell.id}
            sx={{
              border: `1px solid ${theme.aa.color.border.subtle}`,
              borderRadius: `${theme.aa.radius.md}px`,
              backgroundColor: theme.aa.color.bg.panel,
              overflow: 'hidden',
              '&:hover .aa-cell-tools': { opacity: 1 },
            }}
          >
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.25,
                height: 26,
                borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
                backgroundColor: theme.aa.color.bg.chrome,
              }}
            >
              <Typography
                sx={{
                  fontFamily: theme.aa.font.mono,
                  fontSize: 11,
                  color: theme.aa.color.text.muted,
                  minWidth: 28,
                }}
              >
                {cell.cellType === 'code' ? `[${index + 1}]` : '·'}
              </Typography>
              <Box sx={{ flex: 1 }} />
              <CellToolbar
                cell={cell}
                readOnly={readOnly}
                canDelete={canDelete}
                onMove={(delta) => apply(moveCell(notebook, cell.id, delta))}
                onDelete={() => apply(deleteCell(notebook, cell.id))}
                onInsert={() => apply(insertCellAfter(notebook, cell.id))}
                onToggleType={() =>
                  apply(
                    setCellType(
                      notebook,
                      cell.id,
                      cell.cellType === 'code' ? 'markdown' : 'code',
                    ),
                  )
                }
              />
            </Box>

            <CodeEditor
              value={cell.source}
              language={cell.cellType === 'code' ? 'python' : 'markdown'}
              readOnly={readOnly}
              autoHeight
              showGutter={false}
              ariaLabel={`${CELL_TYPE_LABEL[cell.cellType]} cell ${index + 1}`}
              placeholder={cell.cellType === 'code' ? 'Write code…' : 'Write notes…'}
              onSave={onSave}
              onChange={(next) => apply(setCellSource(notebook, cell.id, next))}
            />

            {cell.cellType === 'code' && <Outputs cell={cell} />}
          </Box>
        ))}

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, pt: 0.5 }}>
          <Typography
            component="button"
            disabled={readOnly}
            onClick={() =>
              apply(
                insertCellAfter(
                  notebook,
                  notebook.cells[notebook.cells.length - 1]?.id ?? '',
                ),
              )
            }
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              fontSize: 12,
              color: theme.aa.color.accent.main,
              background: 'none',
              border: 'none',
              cursor: readOnly ? 'default' : 'pointer',
              p: 0,
              '&:hover': { textDecoration: 'underline' },
            }}
          >
            <AddOutlined sx={{ fontSize: 15 }} /> Add cell
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.muted }}>
            Cells don't run here — outputs are whatever Jupyter last saved.
          </Typography>
        </Box>
      </Box>
    </Box>
  );
}
