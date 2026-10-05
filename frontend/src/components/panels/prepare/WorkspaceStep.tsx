import { useEffect, useState } from 'react';
import {
  Box,
  FormControlLabel,
  IconButton,
  InputAdornment,
  Switch,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  ErrorOutlineRounded,
  MemoryRounded,
  RestartAltRounded,
  SaveOutlined,
  WarningAmberRounded,
} from '@mui/icons-material';

import { compactFieldSx } from '../panelStyles';
import type { BaselineRequest, Workspace } from '../../../services/baselineApi';
import { baselineApi } from '../../../services/baselineApi';
import { Note } from './ui';

/** 1500000 -> "1.5 MB": decimal units, as disks are sold and as the server words it. */
export function formatSize(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = Math.max(0, bytes);
  for (const unit of units) {
    if (n < 1000 || unit === 'TB') {
      if (unit === 'B') return `${Math.round(n)} B`;
      return `${n < 100 ? n.toFixed(1) : n.toFixed(0)} ${unit}`;
    }
    n /= 1000;
  }
  return `${n.toFixed(0)} TB`;
}

/**
 * The working-space report for a request, asked of the server as the form
 * changes (debounced, like the commands preview). The server owns the
 * arithmetic and the questions about the machine; the card only shows them.
 */
export function useWorkspace(request: BaselineRequest | null): {
  workspace: Workspace | null;
  error: string;
  busy: boolean;
} {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = request ? JSON.stringify(request) : '';

  useEffect(() => {
    if (!request) {
      setWorkspace(null);
      setError('');
      return;
    }
    let live = true;
    setBusy(true);
    const timer = setTimeout(() => {
      baselineApi
        .workspace(request)
        .then((w) => {
          if (live) {
            setWorkspace(w);
            setError('');
          }
        })
        .catch((e: Error) => {
          // A report for other settings would be a wrong answer: drop it.
          if (live) {
            setWorkspace(null);
            setError(e.message);
          }
        })
        .finally(() => live && setBusy(false));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `key` stands for the request's content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { workspace, error, busy };
}

interface Props {
  workspace: Workspace | null;
  error: string;
  busy: boolean;
  workRoot: string;
  defaultRoot: string;
  freeAsYouGo: boolean;
  keepLocal: boolean;
  onChange: (patch: { workRoot?: string; freeAsYouGo?: boolean; keepLocal?: boolean }) => void;
}

/**
 * Step 5: where the run works on this workstation, and whether the range fits.
 *
 * The console tools stream a range through this folder instead of holding it
 * in memory, so its free space, not the machine's memory, is what limits how
 * long a range can be. The step says how much the range needs at most and how
 * much is free, and "Free space as it goes" lowers the first by deleting each
 * kind of working file as soon as no later tool reads it. A folder on the
 * bucket's gcsfuse mount, or in memory, is refused by the server, which says
 * why; so is a range that cannot fit.
 */
export function WorkspaceStep({
  workspace: ws,
  error,
  busy,
  workRoot,
  defaultRoot,
  freeAsYouGo,
  keepLocal,
  onChange,
}: Props) {
  const theme = useTheme();
  const c = theme.aa.color;
  const [draft, setDraft] = useState(workRoot);
  useEffect(() => setDraft(workRoot), [workRoot]);
  const commit = () => {
    if (draft.trim() !== workRoot) onChange({ workRoot: draft.trim() });
  };

  const freeing = freeAsYouGo && !keepLocal;
  const over = Boolean(ws && ws.rawBytes && ws.freeBytes && ws.needBytes > ws.freeBytes);
  const share = ws && ws.freeBytes ? Math.min(1, ws.needBytes / ws.freeBytes) : 0;
  const barColor = over ? c.status.error : share > 0.8 ? c.status.warning : c.accent.main;

  const hint = (text: string) => (
    <Typography sx={{ fontSize: 10.5, color: c.text.muted, lineHeight: 1.45, mt: 0.25 }}>
      {text}
    </Typography>
  );

  return (
    <Box sx={{ opacity: busy && ws ? 0.75 : 1, transition: 'opacity .15s' }}>
      <TextField
        size="small"
        fullWidth
        label="Working folder on this workstation"
        value={draft}
        placeholder={defaultRoot || '~/aa-workbench-runs'}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        InputLabelProps={{ shrink: true }}
        inputProps={{ spellCheck: false, 'aria-label': 'Working folder' }}
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SaveOutlined sx={{ fontSize: 14, color: c.syntax.entity }} />
            </InputAdornment>
          ),
          endAdornment: workRoot ? (
            <InputAdornment position="end">
              <Tooltip title="Back to the Workbench's default folder">
                <IconButton size="small" edge="end" onClick={() => onChange({ workRoot: '' })}>
                  <RestartAltRounded sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            </InputAdornment>
          ) : undefined,
        }}
        sx={{
          ...compactFieldSx,
          '& .MuiInputBase-input': { fontFamily: theme.aa.font.mono, fontSize: 11.5 },
        }}
      />
      <Typography sx={{ fontSize: 10.5, color: c.text.muted, mt: 0.5, minHeight: 15 }}>
        {ws
          ? `${ws.filesystem || 'disk'}${ws.mountPoint ? ` at ${ws.mountPoint}` : ''} · ${formatSize(
              ws.freeBytes,
            )} free of ${formatSize(ws.totalBytes)}${ws.exists ? '' : ' · made when the run starts'}`
          : busy && !error ? 'Looking at the folder…' : ''}
      </Typography>
      {error && (
        <Box sx={{ mt: 0.5 }}>
          <Note tone="error" icon={<ErrorOutlineRounded className="note-icon" />}>
            {error}
          </Note>
        </Box>
      )}

      {/* What the range needs, against what is free */}
      {ws && ws.rawBytes > 0 && (
        <Box sx={{ mt: 1 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
            <Typography sx={{ fontSize: 11.5, color: c.text.primary }}>
              Needs at most{' '}
              <Box component="b" sx={{ color: over ? c.status.error : c.text.primary }}>
                {formatSize(ws.needBytes)}
              </Box>
            </Typography>
            <Typography sx={{ ml: 'auto', fontSize: 11, color: c.text.muted }}>
              {formatSize(ws.freeBytes)} free
            </Typography>
          </Box>
          <Box
            role="meter"
            aria-label="Working space this range needs, against the free space"
            aria-valuemin={0}
            aria-valuemax={ws.freeBytes}
            aria-valuenow={Math.min(ws.needBytes, ws.freeBytes)}
            sx={{
              mt: 0.5,
              height: 6,
              borderRadius: 3,
              overflow: 'hidden',
              backgroundColor: alpha(c.text.muted, 0.18),
            }}
          >
            <Box
              sx={{
                height: '100%',
                width: `${Math.max(share * 100, ws.needBytes > 0 ? 1.5 : 0)}%`,
                backgroundColor: barColor,
                borderRadius: 3,
                transition: 'width .2s, background-color .2s',
              }}
            />
          </Box>
          {hint(
            freeing
              ? `About ${formatSize(ws.needKeepingBytes)} if every working file were kept until the end.`
              : `About ${formatSize(ws.needFreeingBytes)} with Free space as it goes.`,
          )}
        </Box>
      )}

      <Box sx={{ mt: 1.25, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        <Box>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={freeing}
                disabled={keepLocal}
                onChange={(e) => onChange({ freeAsYouGo: e.target.checked })}
              />
            }
            label={
              <Typography sx={{ fontSize: 11.5, color: c.text.primary }}>Free space as it goes</Typography>
            }
            sx={{ ml: -0.5, mr: 0 }}
          />
          {hint(
            keepLocal
              ? 'Off while the working files are kept.'
              : 'Raw files are deleted once converted, the per-file EchoData once combined, and the local copy of the EchoData once Sv is made. The products are unaffected; a run that fails keeps only what was not yet deleted.',
          )}
        </Box>
        <Box>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={keepLocal}
                onChange={(e) => onChange({ keepLocal: e.target.checked })}
              />
            }
            label={
              <Typography sx={{ fontSize: 11.5, color: c.text.primary }}>
                Keep the raw files and per-file EchoData
              </Typography>
            }
            sx={{ ml: -0.5, mr: 0 }}
          />
          {hint(
            'Off: the run’s folder is removed once the products are in the bucket. After a failure it is kept, less anything already freed. On: freeing is off and everything is kept.',
          )}
        </Box>
      </Box>

      {ws && <MemoryLine ws={ws} />}

      {ws?.problem && (
        <Box sx={{ mt: 1 }}>
          <Note tone="error" icon={<ErrorOutlineRounded className="note-icon" />}>
            {ws.problem}
          </Note>
        </Box>
      )}
      {ws?.warnings.map((w) => (
        <Box key={w} sx={{ mt: 1 }}>
          <Note tone="warning" icon={<WarningAmberRounded className="note-icon" />}>
            {w}
          </Note>
        </Box>
      ))}
    </Box>
  );
}

function MemoryLine({ ws }: { ws: Workspace }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const text =
    ws.streaming === true
      ? `About ${formatSize(ws.memoryNeedBytes)} for any length of range: the tools stream it through this folder instead of holding it in memory.`
      : ws.streaming === false
        ? `The installed tools hold the whole range in memory: about ${formatSize(ws.memoryNeedBytes)} here.`
        : 'Could not ask the installed aalibrary how it uses memory.';
  return (
    <Box
      sx={{
        mt: 1.25,
        display: 'flex',
        gap: 0.75,
        alignItems: 'flex-start',
        px: 1,
        py: 0.75,
        borderRadius: `${theme.aa.radius.md}px`,
        border: `1px solid ${c.border.subtle}`,
        backgroundColor: c.bg.editor,
      }}
    >
      <MemoryRounded
        sx={{
          fontSize: 15,
          mt: '1px',
          color: ws.streaming === false ? c.status.warning : c.syntax.string,
        }}
      />
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: c.text.primary }}>
          Memory
          {ws.memoryBytes > 0 && (
            <Box component="span" sx={{ fontWeight: 400, color: c.text.muted, ml: 0.75, fontSize: 10.5 }}>
              {formatSize(ws.memoryBytes)} on this machine
            </Box>
          )}
        </Typography>
        <Typography sx={{ fontSize: 10.5, color: c.text.secondary, lineHeight: 1.45 }}>{text}</Typography>
      </Box>
    </Box>
  );
}
