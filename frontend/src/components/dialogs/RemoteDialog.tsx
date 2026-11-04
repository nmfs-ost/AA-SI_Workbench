import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Switch,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { CloudSyncOutlined } from '@mui/icons-material';

import {
  cleanAccounts,
  describeCard,
  remoteApi,
  type RemoteRequest,
  type RemoteState,
} from '../../services/remoteApi';
import type { DialogComponentProps } from './registry';

/**
 * Tools ▸ Remote Requests: whether other apps may ask this Workbench to
 * prepare data (backend api/remote.py), which accounts start a run at once,
 * and the requests that came in. A request from any other account waits here
 * until it is run, its account allowed, or it is discarded.
 */
export function RemoteDialog({ open, onClose }: DialogComponentProps) {
  const theme = useTheme();
  const c = theme.aa.color;
  const [state, setState] = useState<RemoteState | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [accounts, setAccounts] = useState('');
  const [gcloud, setGcloud] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const show = useCallback((next: RemoteState) => {
    setState(next);
    setEnabled(next.settings.enabled);
    setAccounts(next.settings.accounts.join('\n'));
    setGcloud(next.settings.acceptGcloudTokens);
  }, []);

  const load = useCallback(() => {
    setError('');
    remoteApi
      .state()
      .then(show)
      .catch((e: Error) => setError(e.message));
  }, [show]);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  const save = async () => {
    setBusy(true);
    setError('');
    try {
      show(await remoteApi.save({ enabled, accounts: cleanAccounts(accounts), acceptGcloudTokens: gcloud }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const decide = async (action: 'run' | 'allow' | 'discard', id: string) => {
    setBusy(true);
    setError('');
    try {
      const done = await remoteApi[action](id);
      if (done.status === 'refused') setError(done.detail);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saved = state?.settings;
  const changed =
    !!saved &&
    (saved.enabled !== enabled ||
      saved.acceptGcloudTokens !== gcloud ||
      saved.accounts.join('\n') !== cleanAccounts(accounts).join('\n'));
  const held = state?.requests.filter((r) => r.status === 'held') ?? [];
  const past = state?.requests.filter((r) => r.status !== 'held').slice(0, 20) ?? [];
  const small = { fontSize: 11.5, color: c.text.secondary, lineHeight: 1.55 } as const;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <CloudSyncOutlined sx={{ fontSize: 20, color: c.accent.main }} />
        Remote requests
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
        <Typography sx={small}>
          Other Google Cloud apps (a metadata manager, say) can ask this Workbench to prepare a survey's time range,
          as the Prepare EchoData panel does. A run they start is yours: your account, your folder, your costs. Only
          Prepare requests are taken; a request can't choose the bucket or folders on this machine, or run commands
          of its own.
        </Typography>

        <FormControlLabel
          control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} />}
          label={<Typography sx={{ fontSize: 13 }}>Accept remote requests on this workstation</Typography>}
        />

        <Box>
          <Typography sx={{ fontSize: 12.5, fontWeight: 600, mb: 0.5 }}>Accounts that may start a run</Typography>
          <TextField
            value={accounts}
            onChange={(e) => setAccounts(e.target.value)}
            placeholder={'metadata-manager@your-project.iam.gserviceaccount.com\ncolleague@noaa.gov'}
            multiline
            minRows={2}
            fullWidth
            size="small"
            inputProps={{ 'aria-label': 'Accounts that may start a run', style: { fontSize: 12.5 } }}
          />
          <Typography sx={{ ...small, mt: 0.5 }}>
            One address per line. A request from any other account waits below for you to decide.
          </Typography>
          <FormControlLabel
            control={<Checkbox size="small" checked={gcloud} onChange={(e) => setGcloud(e.target.checked)} />}
            label={
              <Typography sx={{ fontSize: 12 }}>
                Also accept a person's own gcloud token (for testing from a terminal)
              </Typography>
            }
          />
        </Box>

        <Box>
          <Typography sx={{ fontSize: 12.5, fontWeight: 600, mb: 0.5 }}>How an app sends one</Typography>
          <Box
            component="pre"
            sx={{
              m: 0,
              p: 1,
              fontSize: 11,
              fontFamily: theme.aa.font.mono,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              borderRadius: `${theme.aa.radius.md}px`,
              border: `1px solid ${c.border.subtle}`,
              backgroundColor: c.bg.editor,
            }}
          >
            {`POST ${state?.url || 'https://<port>-<this workstation>/'}api/remote/prepare
X-AA-Identity: <Google ID token for the app's account, audience "${state?.audience ?? '…'}">
{"vessel": "Henry_B._Bigelow", "survey": "HB1603", "sonar": "EK60",
 "start": "2016-07-03T06:00:00", "end": "2016-07-03T12:00:00"}`}
          </Box>
          <Typography sx={{ ...small, mt: 0.5 }}>
            The app needs access to this workstation in Cloud Workstations, and this workstation must be running with
            the Workbench open. That access reaches all of the Workbench, so give it only to accounts you would trust
            with the workstation. docs/guides/remote-requests.md has the details.
          </Typography>
        </Box>

        <Box>
          <Typography sx={{ fontSize: 12.5, fontWeight: 600, mb: 0.5 }}>
            Waiting for you{held.length ? ` (${held.length})` : ''}
          </Typography>
          {held.length === 0 && <Typography sx={small}>Nothing is waiting.</Typography>}
          {held.map((r) => (
            <RequestRow key={r.id} request={r}>
              <Button size="small" disabled={busy} onClick={() => decide('run', r.id)} sx={{ textTransform: 'none' }}>
                Run it
              </Button>
              <Button size="small" disabled={busy} onClick={() => decide('allow', r.id)} sx={{ textTransform: 'none' }}>
                Always allow {r.caller}
              </Button>
              <Button
                size="small"
                color="inherit"
                disabled={busy}
                onClick={() => decide('discard', r.id)}
                sx={{ textTransform: 'none' }}
              >
                Discard
              </Button>
            </RequestRow>
          ))}
        </Box>

        {past.length > 0 && (
          <Box>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600, mb: 0.5 }}>Recent</Typography>
            {past.map((r) => (
              <RequestRow key={r.id} request={r} />
            ))}
          </Box>
        )}

        {error && <Typography sx={{ fontSize: 12, color: c.status.warning }}>{error}</Typography>}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose} sx={{ textTransform: 'none' }}>
          Close
        </Button>
        <Button variant="contained" disabled={!changed || busy} onClick={save} sx={{ textTransform: 'none' }}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const STATUS_LABEL: Record<RemoteRequest['status'], string> = {
  started: 'Started',
  held: 'Waiting',
  starting: 'Starting',
  refused: 'Not started',
  discarded: 'Discarded',
};

function RequestRow({ request, children }: { request: RemoteRequest; children?: ReactNode }) {
  const theme = useTheme();
  const c = theme.aa.color;
  return (
    <Box
      data-testid="remote-request"
      sx={{ py: 0.75, borderTop: `1px solid ${c.border.subtle}`, display: 'flex', flexDirection: 'column', gap: 0.25 }}
    >
      <Typography sx={{ fontSize: 12.5 }}>
        <b>{STATUS_LABEL[request.status]}</b> · {request.caller} · {request.receivedAt.replace('T', ' ').replace('Z', ' UTC')}
      </Typography>
      <Typography sx={{ fontSize: 12, color: c.text.secondary }}>{describeCard(request.card)}</Typography>
      {request.card.note && (
        <Typography sx={{ fontSize: 12, color: c.text.secondary }}>“{request.card.note}”</Typography>
      )}
      {request.destination && (
        <Typography sx={{ fontSize: 11.5, color: c.text.muted, wordBreak: 'break-all' }}>
          → {request.destination}
        </Typography>
      )}
      {request.status === 'refused' && request.detail && (
        <Typography sx={{ fontSize: 11.5, color: c.status.warning }}>{request.detail}</Typography>
      )}
      {children && <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>{children}</Box>}
    </Box>
  );
}
