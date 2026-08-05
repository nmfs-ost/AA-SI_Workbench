import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';

import { filesApi } from '../../services/filesApi';
import { renameOpenFile } from '../../state/editors';
import { refreshFileBrowser } from '../../state/fileBrowser';
import { basename, dirname, ellipsizePath } from '../panels/editor/paths';

/**
 * Rename one entry on the workstation.
 *
 * A dialog rather than an editable label in the tree. In-place editing is
 * nicer when it works, but it has to survive the listing refreshing underneath
 * it, a filter that may hide the row mid-edit, and a folder collapsing — and
 * getting any of those wrong loses what the user typed. The dialog has none of
 * those failure modes and costs one keystroke.
 *
 * ## The stem selection
 *
 * On open, the *stem* is selected and the extension is not. Renaming
 * `HB1603_EK60_survey.raw` almost always means changing the name and keeping
 * `.raw`, so selecting the whole field would make the first keystroke destroy
 * the suffix. This is what every file manager does, and it is invisible until
 * it is missing.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  /** The absolute path to rename, passed as the dialog payload. */
  payload?: string;
}

export function RenameDialog({ open, onClose, payload }: Props) {
  const theme = useTheme();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const path = payload ?? '';
  const original = basename(path);
  const parent = dirname(path);

  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName(original);
    setError('');
    setBusy(false);
  }, [open, original]);

  /** Select the stem, leaving the extension alone. See the note above. */
  const selectStem = () => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const dot = original.lastIndexOf('.');
    // `dot <= 0` covers both "no extension" and a dotfile like `.bashrc`,
    // where the leading dot is part of the name rather than a suffix.
    if (dot <= 0) input.select();
    else input.setSelectionRange(0, dot);
  };

  const trimmed = name.trim();
  const invalid = /[\\/]/.test(name) || trimmed === '.' || trimmed === '..';
  const unchanged = trimmed === original;
  const canRename = trimmed !== '' && !invalid && !busy;

  const handleRename = async () => {
    if (!canRename) return;
    if (unchanged) {
      onClose();
      return;
    }
    setBusy(true);
    setError('');
    try {
      const entry = await filesApi.rename(path, trimmed);
      // An editor tab holding the old path would silently save to a file that
      // no longer exists, so it is re-pointed before the tree is refreshed.
      renameOpenFile(path, entry.path, entry.name);
      refreshFileBrowser(entry.path);
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not rename that.');
      setBusy(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      TransitionProps={{ onEntered: selectStem }}
    >
      <DialogTitle sx={{ fontSize: 15, pb: 1 }}>Rename</DialogTitle>

      <DialogContent sx={{ pt: '4px !important' }}>
        <TextField
          fullWidth
          size="small"
          label="Name"
          value={name}
          inputRef={inputRef}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              void handleRename();
            }
          }}
          error={invalid}
          helperText={
            invalid ? "A name can't contain a slash — use Move to relocate." : ' '
          }
          InputLabelProps={{ shrink: true }}
          sx={{ mb: 1 }}
        />

        <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'baseline' }}>
          <Typography sx={{ fontSize: 11, color: theme.aa.color.text.muted }}>
            in
          </Typography>
          <Typography
            title={parent}
            sx={{
              fontSize: 11,
              fontFamily: theme.aa.font.mono,
              color: theme.aa.color.text.secondary,
              minWidth: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {ellipsizePath(parent, 44)}
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mt: 1.5, fontSize: 12, py: 0.25 }}>
            {error}
          </Alert>
        )}
      </DialogContent>

      <DialogActions>
        <Button size="small" onClick={onClose}>
          Cancel
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={!canRename}
          onClick={() => void handleRename()}
        >
          Rename
        </Button>
      </DialogActions>
    </Dialog>
  );
}
