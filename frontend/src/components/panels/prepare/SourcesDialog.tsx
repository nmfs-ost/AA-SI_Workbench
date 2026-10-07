import { useEffect, useState } from 'react';
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
  alpha,
  useTheme,
} from '@mui/material';
import { AddRounded, StorageOutlined } from '@mui/icons-material';

import { DEFAULT_LAYOUT } from '../../../services/sources/sourcesApi';
import type { DataSource } from '../../../services/sources/sourcesApi';
import { removeSource, saveSource } from '../../../state/prepare';

/**
 * Where raw files come from, and how to connect another place.
 *
 * NCEI is built in. An archive (OMAO, or one added here) is a folder tree of
 * .raw files, <location>/<vessel>/<survey>/<echosounder>/, in a gs:// bucket
 * or a folder on the workstation. What is set here is kept in the Workbench's
 * own settings (sources.json); a deployment can name sources for everyone with
 * AASI_SOURCES_FILE. A new kind of source (an API) is wired in on the server.
 */
export function SourcesDialog({
  open,
  focus,
  sources,
  onClose,
}: {
  open: boolean;
  /** The source to open on ('' : the list). */
  focus: string;
  sources: DataSource[];
  onClose: () => void;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const [editing, setEditing] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const wanted = sources.find((x) => x.id === focus);
    setEditing(wanted && wanted.kind !== 'ncei' && !wanted.ready ? wanted.id : null);
  }, [open, focus, sources]);

  const current = editing === '' ? null : sources.find((x) => x.id === editing) ?? null;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, pb: 0.5 }}>
        <StorageOutlined sx={{ fontSize: 20, color: c.accent.main }} />
        Data sources
      </DialogTitle>
      <DialogContent sx={{ pt: '8px !important' }}>
        {editing === null ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Typography sx={{ fontSize: 12, color: c.text.secondary, lineHeight: 1.55 }}>
              Prepare EchoData takes raw files from any of these. An archive is a folder of{' '}
              <Mono>vessel/survey/echosounder/*.raw</Mono> in a bucket or on this workstation.
            </Typography>
            <Box sx={{ border: `1px solid ${c.border.subtle}`, borderRadius: `${theme.aa.radius.md}px` }}>
              {sources.map((x) => (
                <Box
                  key={x.id}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1.25,
                    px: 1.25,
                    py: 1,
                    '& + &': { borderTop: `1px solid ${c.border.subtle}` },
                  }}
                >
                  <Box
                    sx={{
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      flexShrink: 0,
                      backgroundColor: x.ready ? c.status.success : c.text.disabled,
                    }}
                    title={x.ready ? 'Connected' : 'Not connected'}
                  />
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography sx={{ fontSize: 12.5, fontWeight: 600 }}>
                      {x.name}{' '}
                      <Box component="span" sx={{ fontWeight: 400, fontSize: 11, color: c.text.muted }}>
                        {x.builtin ? 'built in' : 'added'} · {x.fetch ? `fetched with ${x.fetch}` : 'not connected'}
                      </Box>
                    </Typography>
                    <Typography
                      sx={{
                        fontSize: 11,
                        color: c.text.muted,
                        fontFamily: x.where ? theme.aa.font.mono : undefined,
                        wordBreak: 'break-all',
                      }}
                    >
                      {x.where || x.detail || x.description}
                    </Typography>
                  </Box>
                  {x.kind !== 'ncei' && (
                    <Button size="small" onClick={() => setEditing(x.id)} sx={{ textTransform: 'none', fontSize: 11.5 }}>
                      {x.ready ? 'Change…' : 'Connect…'}
                    </Button>
                  )}
                </Box>
              ))}
            </Box>
            <Box>
              <Button
                size="small"
                variant="outlined"
                startIcon={<AddRounded />}
                onClick={() => setEditing('')}
                sx={{ textTransform: 'none' }}
              >
                Add an archive
              </Button>
            </Box>
            <Typography sx={{ fontSize: 11, color: c.text.muted, lineHeight: 1.55 }}>
              NCEI is listed from its public S3 bucket, or the project&apos;s BigQuery cache when the Workbench is
              started with <Mono>--source cache</Mono>. Other kinds of source (an API, a database) are added on the
              server; see <Mono>docs/guides/data-sources.md</Mono>.
            </Typography>
          </Box>
        ) : (
          <SourceForm source={current} existing={sources} onDone={() => setEditing(null)} />
        )}
      </DialogContent>
      {editing === null && (
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose} sx={{ textTransform: 'none' }}>
            Close
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
}

/** A source id from its name: "Shimada share" → "shimada-share". */
export function idFromName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

function SourceForm({
  source,
  existing,
  onDone,
}: {
  /** null: a new archive. */
  source: DataSource | null;
  existing: DataSource[];
  onDone: () => void;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const [name, setName] = useState(source?.name ?? '');
  const [description, setDescription] = useState(source?.description ?? '');
  const [root, setRoot] = useState(source?.root ?? '');
  const [layout, setLayout] = useState(source?.layout || DEFAULT_LAYOUT);
  const [sonar, setSonar] = useState(source?.sonar ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const adding = source === null;
  const id = adding ? idFromName(name) : source.id;
  const taken = adding && existing.some((x) => x.id === id);
  const noSonarFolders = !layout.includes('{sonar}');
  const why = adding && !name.trim()
    ? 'Name it.'
    : taken
      ? `There is already a source called ${name.trim()}.`
      : !root.trim()
        ? 'Say where its raw files are.'
        : noSonarFolders && !sonar.trim()
          ? 'Name its echosounder.'
          : '';

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      await saveSource({
        id,
        root: root.trim(),
        layout: layout.trim(),
        sonar: noSonarFolders ? sonar.trim() : '',
        ...(adding ? { name: name.trim(), kind: 'archive', description: description.trim() } : {}),
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!source) return;
    setBusy(true);
    setError('');
    try {
      await removeSource(source.id);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
      <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
        {adding ? 'Add an archive' : `${source.ready ? 'Change' : 'Connect'} ${source.name}`}
      </Typography>
      {adding && (
        <>
          <TextField
            size="small"
            label="Name"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ maxLength: 40 }}
            helperText={name.trim() ? `Its id: ${id}` : ' '}
          />
          <TextField
            size="small"
            label="What it holds (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            InputLabelProps={{ shrink: true }}
            inputProps={{ maxLength: 300 }}
          />
        </>
      )}
      <TextField
        size="small"
        label="Where its raw files are"
        placeholder="gs://bucket/folder  or  /mnt/share/raw"
        value={root}
        autoFocus={!adding}
        onChange={(e) => setRoot(e.target.value)}
        InputLabelProps={{ shrink: true }}
        inputProps={{ spellCheck: false }}
        sx={{ '& input': { fontFamily: theme.aa.font.mono, fontSize: 12.5 } }}
        helperText="A gs:// folder is listed with your Google credentials and fetched with aa-download; a folder on this workstation is copied with cp."
      />
      <TextField
        size="small"
        label="Folders below it"
        value={layout}
        onChange={(e) => setLayout(e.target.value)}
        InputLabelProps={{ shrink: true }}
        inputProps={{ spellCheck: false }}
        sx={{ '& input': { fontFamily: theme.aa.font.mono, fontSize: 12.5 } }}
        helperText="Names, and {vessel}, {survey}, {sonar} in that order, e.g. data/raw/{vessel}/{survey}/{sonar}."
      />
      {noSonarFolders && (
        <TextField
          size="small"
          label="Its echosounder"
          placeholder="EK80"
          value={sonar}
          onChange={(e) => setSonar(e.target.value)}
          InputLabelProps={{ shrink: true }}
          helperText="No {sonar} folders: every file is from this echosounder."
        />
      )}
      {root.trim() && (
        <Box
          sx={{
            px: 1,
            py: 0.75,
            borderRadius: `${theme.aa.radius.sm}px`,
            backgroundColor: alpha(c.accent.main, 0.06),
            border: `1px solid ${c.border.subtle}`,
            fontFamily: theme.aa.font.mono,
            fontSize: 11,
            color: c.text.secondary,
            wordBreak: 'break-all',
          }}
        >
          {`${root.trim().replace(/\/+$/, '')}/${layout.trim().replace(/^\/+|\/+$/g, '')}/D20240101-T000000.raw`}
        </Box>
      )}
      {error && (
        <Alert severity="error" sx={{ fontSize: 12, py: 0 }}>
          {error}
        </Alert>
      )}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {!adding && source.root && (
          <Button
            size="small"
            color="error"
            disabled={busy}
            onClick={() => void remove()}
            sx={{ textTransform: 'none' }}
          >
            {source.builtin ? 'Disconnect' : 'Remove'}
          </Button>
        )}
        <Typography sx={{ flex: 1, fontSize: 11.5, color: c.text.muted, textAlign: 'right' }}>{why}</Typography>
        <Button onClick={onDone} disabled={busy} sx={{ textTransform: 'none' }}>
          Back
        </Button>
        <Button
          variant="contained"
          disableElevation
          disabled={Boolean(why) || busy}
          onClick={() => void save()}
          sx={{ textTransform: 'none' }}
        >
          {busy ? 'Checking…' : adding ? 'Add' : 'Save'}
        </Button>
      </Box>
    </Box>
  );
}

function Mono({ children }: { children: string }) {
  const theme = useTheme();
  return (
    <Box component="code" sx={{ fontFamily: theme.aa.font.mono, fontSize: '0.92em' }}>
      {children}
    </Box>
  );
}
