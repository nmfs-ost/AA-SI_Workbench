import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material';
import {
  ArticleOutlined,
  CodeOutlined,
  CreateNewFolderOutlined,
  MenuBookOutlined,
  NotesOutlined,
} from '@mui/icons-material';

import { filesApi, type NewEntryKind } from '../../services/filesApi';
import { openFile } from '../../state/editors';
import { getFileBrowserState, refreshFileBrowser } from '../../state/fileBrowser';
import { ellipsizePath } from '../panels/editor/paths';

/**
 * Create a file or folder on the workstation.
 *
 * Two entry points, one implementation: the File ▸ New menu and the **+** in
 * the Files panel toolbar both open this, the menu preselecting a kind. It
 * creates into whichever folder the Files panel is showing, which is the answer
 * that needs no explaining — you make the thing where you're standing.
 *
 * The extension is added by the server rather than typed by the user, so
 * "analysis" becomes `analysis.py` and nobody creates `analysis.py.py`. The
 * preview line shows exactly what will appear on disk before anything happens.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  /** Which kind to preselect, from the menu item. */
  payload?: string;
}

interface KindOption {
  kind: NewEntryKind;
  label: string;
  suffix: string;
  icon: typeof ArticleOutlined;
  placeholder: string;
}

/** Mirrors NEW_FILE_SUFFIX in backend/src/aa_si_workbench/api/files.py. */
const KINDS: readonly KindOption[] = [
  {
    kind: 'text',
    label: 'Text',
    suffix: '.txt',
    icon: NotesOutlined,
    placeholder: 'notes',
  },
  {
    kind: 'python',
    label: 'Python',
    suffix: '.py',
    icon: CodeOutlined,
    placeholder: 'analysis',
  },
  {
    kind: 'notebook',
    label: 'Notebook',
    suffix: '.ipynb',
    icon: MenuBookOutlined,
    placeholder: 'survey-review',
  },
  {
    kind: 'markdown',
    label: 'Markdown',
    suffix: '.md',
    icon: ArticleOutlined,
    placeholder: 'README',
  },
  {
    kind: 'folder',
    label: 'Folder',
    suffix: '',
    icon: CreateNewFolderOutlined,
    placeholder: 'outputs',
  },
] as const;

function isNewEntryKind(value: string): value is NewEntryKind {
  return KINDS.some((option) => option.kind === value);
}

export function NewFileDialog({ open, onClose, payload }: Props) {
  const theme = useTheme();
  const nameRef = useRef<HTMLInputElement | null>(null);

  const [kind, setKind] = useState<NewEntryKind>('text');
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const option = KINDS.find((entry) => entry.kind === kind) ?? KINDS[0];

  /* Reset on each open: a dialog that remembers the last thing you typed is a
     dialog that creates the wrong file when you're not reading carefully. */
  useEffect(() => {
    if (!open) return;
    setKind(payload && isNewEntryKind(payload) ? payload : 'text');
    setName('');
    setError('');
    setBusy(false);

    const current = getFileBrowserState().currentDirectory;
    if (current) {
      setDestination(current);
      return;
    }
    // Files hasn't been opened yet, so fall back to the first browsable root.
    void filesApi
      .roots()
      .then((roots) => setDestination(roots[0]?.path ?? ''))
      .catch(() => setDestination(''));
  }, [open, payload]);

  const finalName = useMemo(() => {
    const trimmed = name.trim();
    if (!trimmed) return '';
    if (!option.suffix) return trimmed;
    return trimmed.toLowerCase().endsWith(option.suffix)
      ? trimmed
      : `${trimmed}${option.suffix}`;
  }, [name, option.suffix]);

  const invalidName = /[\\/]/.test(name);
  const canCreate = finalName !== '' && !invalidName && destination !== '' && !busy;

  const handleCreate = async () => {
    if (!canCreate) return;
    setBusy(true);
    setError('');
    try {
      const entry = await filesApi.create(destination, name.trim(), kind);
      // Show it in the tree, then open it — creating a notebook you can't see
      // would be a strange kind of success.
      refreshFileBrowser(entry.path);
      if (!entry.isDir) openFile(entry.path, entry.name);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not create that.');
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      TransitionProps={{ onEntered: () => nameRef.current?.focus() }}
    >
      <DialogTitle sx={{ fontSize: 15, pb: 1 }}>New file</DialogTitle>

      <DialogContent sx={{ pt: '4px !important' }}>
        <ToggleButtonGroup
          exclusive
          fullWidth
          size="small"
          value={kind}
          onChange={(_, next: NewEntryKind | null) => {
            if (next) setKind(next);
          }}
          sx={{ mb: 2 }}
        >
          {KINDS.map((entry) => {
            const Icon = entry.icon;
            return (
              <ToggleButton
                key={entry.kind}
                value={entry.kind}
                sx={{
                  flexDirection: 'column',
                  gap: 0.25,
                  py: 0.75,
                  fontSize: 11,
                  textTransform: 'none',
                  lineHeight: 1.2,
                }}
              >
                <Icon sx={{ fontSize: 17 }} />
                {entry.label}
              </ToggleButton>
            );
          })}
        </ToggleButtonGroup>

        <TextField
          inputRef={nameRef}
          fullWidth
          size="small"
          label="Name"
          value={name}
          placeholder={option.placeholder}
          error={invalidName}
          helperText={
            invalidName
              ? 'Names can’t contain slashes — pick the folder in Files first.'
              : ' '
          }
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleCreate();
            }
          }}
        />

        <Box
          sx={{
            mt: 0.5,
            p: 1,
            borderRadius: `${theme.aa.radius.sm}px`,
            backgroundColor: theme.aa.color.bg.base,
            border: `1px solid ${theme.aa.color.border.subtle}`,
          }}
        >
          <Typography
            sx={{
              fontSize: 10.5,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              color: theme.aa.color.text.muted,
            }}
          >
            Creates
          </Typography>
          <Typography
            title={destination ? `${destination}/${finalName}` : undefined}
            sx={{
              fontFamily: theme.aa.font.mono,
              fontSize: 11.5,
              mt: 0.25,
              wordBreak: 'break-all',
              color: finalName
                ? theme.aa.color.text.primary
                : theme.aa.color.text.muted,
            }}
          >
            {destination ? ellipsizePath(destination, 46) : 'No folder available'}
            {finalName ? `/${finalName}` : '/…'}
          </Typography>
        </Box>

        <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.muted, mt: 1 }}>
          Files are created in the folder open in the Files panel. Select a
          different folder there to change this.
        </Typography>

        {error && (
          <Alert severity="error" sx={{ mt: 1.5, fontSize: 12 }}>
            {error}
          </Alert>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} size="small" color="inherit">
          Cancel
        </Button>
        <Button
          onClick={() => void handleCreate()}
          size="small"
          variant="contained"
          disabled={!canCreate}
        >
          {busy ? 'Creating…' : 'Create'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
