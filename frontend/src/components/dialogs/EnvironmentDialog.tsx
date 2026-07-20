import { useEffect, useRef } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  useTheme,
} from '@mui/material';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import SystemUpdateAltOutlined from '@mui/icons-material/SystemUpdateAltOutlined';
import StopOutlined from '@mui/icons-material/StopOutlined';

import { repo } from '../../config/repo';
import {
  cancelUpdate,
  loadEnvironment,
  startUpdate,
  syncUpdateJob,
  useEnvironment,
  versionChanges,
} from '../../state/environment';

interface Props {
  open: boolean;
  onClose: () => void;
}

const STATE_COLOR = {
  idle: 'default',
  running: 'info',
  succeeded: 'success',
  failed: 'error',
  cancelled: 'warning',
} as const;

/**
 * The Python environment the Workbench orchestrates, and the update mechanism
 * for it.
 *
 * The Workbench runs `aa-*` console tools out of a virtualenv (`venv313` on a
 * GCP workstation); `aa-setup` is what reinstalls that toolset. This dialog
 * shows what is installed, runs the update, and streams its output. The job is
 * owned by `state/environment.ts`, so closing this window does not stop it.
 */
export function EnvironmentDialog({ open, onClose }: Props) {
  const theme = useTheme();
  const environment = useEnvironment();
  const logRef = useRef<HTMLDivElement | null>(null);

  const { info, infoLoading, infoError, job, lines, jobError } = environment;
  const running = job?.state === 'running';
  const action = info?.actions.find((item) => item.id === 'environment');
  const changes = job?.state === 'succeeded' ? versionChanges(environment) : [];

  useEffect(() => {
    if (!open) return;
    if (!info && !infoLoading) void loadEnvironment();
    void syncUpdateJob(); // adopt a run that is already in flight
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  const monoSx = {
    fontFamily: theme.aa.font.mono,
    fontSize: 11.5,
    color: theme.aa.color.text.secondary,
  } as const;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle sx={{ fontSize: 15, fontWeight: 600, pb: 1 }}>
        Python environment
        <Typography
          component="div"
          sx={{ fontSize: 12, color: theme.aa.color.text.muted, mt: 0.25 }}
        >
          The Workbench orchestrates the aa-* console tools installed here.
        </Typography>
      </DialogTitle>

      <DialogContent dividers sx={{ borderColor: theme.aa.color.border.subtle }}>
        {infoError && (
          <Alert severity="error" sx={{ fontSize: 12.5, mb: 1.5 }}>
            {infoError}
          </Alert>
        )}

        {infoLoading && !info && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2 }}>
            <CircularProgress size={16} />
            <Typography sx={{ fontSize: 12.5 }}>Reading the environment…</Typography>
          </Box>
        )}

        {info && (
          <>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                columnGap: 2,
                rowGap: 0.5,
                mb: 1.5,
              }}
            >
              {[
                ['Virtualenv', `${info.venvName}${info.isVirtualEnv ? '' : ' (not a virtualenv)'}`],
                ['Location', info.prefix],
                ['Python', `${info.pythonVersion} — ${info.pythonExecutable}`],
                ['Workbench', info.workbenchVersion],
              ].map(([label, value]) => (
                <Box key={label} sx={{ display: 'contents' }}>
                  <Typography sx={{ fontSize: 12, color: theme.aa.color.text.muted }}>
                    {label}
                  </Typography>
                  <Typography sx={monoSx}>{value}</Typography>
                </Box>
              ))}
            </Box>

            {!info.matchesExpected && (
              <Alert severity="warning" sx={{ fontSize: 12.5, mb: 1.5 }}>
                This process is not running in <code>{info.expectedVenvName}</code>.
                Updating here changes <code>{info.venvName}</code>, not the AA-SI
                environment. Activate it first
                (<code>source ~/{info.expectedVenvName}/bin/activate</code>) and
                restart <code>aa-workbench</code>.
              </Alert>
            )}

            {!info.updateEnabled && (
              <Alert severity="error" sx={{ fontSize: 12.5, mb: 1.5 }}>
                {info.updateDisabledReason}
              </Alert>
            )}

            {action && !action.available && (
              <Alert severity="warning" sx={{ fontSize: 12.5, mb: 1.5 }}>
                <code>{action.command[0]}</code> was not found in this environment,
                so the update cannot run from here. Install the AA-SI toolset per
                the{' '}
                <Link href={repo.setupGuideUrl} target="_blank" rel="noopener noreferrer">
                  setup guide
                </Link>
                , or point <code>AASI_UPDATE_COMMAND</code> at the right command.
              </Alert>
            )}

            {/* ---------------- Update action ---------------- */}
            <Divider sx={{ my: 1.5 }} />
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
              <Typography sx={{ fontSize: 13, fontWeight: 600 }}>
                {action?.label ?? 'Update Python environment'}
              </Typography>
              {job && job.state !== 'idle' && (
                <Chip
                  size="small"
                  label={job.state}
                  color={STATE_COLOR[job.state]}
                  variant="outlined"
                  sx={{ height: 18, fontSize: 11 }}
                />
              )}
            </Box>
            <Typography sx={{ fontSize: 12, color: theme.aa.color.text.muted, mb: 1 }}>
              {action?.description ??
                'Reinstalls the AA-SI toolset into this virtual environment.'}{' '}
              Console tools are replaced in place, so restart{' '}
              <code>aa-workbench</code> once it finishes.
            </Typography>

            <Box
              sx={{
                p: 1,
                borderRadius: `${theme.aa.radius.sm}px`,
                backgroundColor: theme.aa.color.bg.base,
                border: `1px solid ${theme.aa.color.border.subtle}`,
                ...monoSx,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {(job?.command.length ? job.command : (action?.command ?? [])).join(' ') ||
                'aa-setup'}
            </Box>

            {jobError && (
              <Alert severity="error" sx={{ fontSize: 12.5, mt: 1.5 }}>
                {jobError}
              </Alert>
            )}

            {/* ---------------- Live output ---------------- */}
            {lines.length > 0 && (
              <Box
                ref={logRef}
                sx={{
                  mt: 1.5,
                  p: 1,
                  height: 200,
                  overflowY: 'auto',
                  borderRadius: `${theme.aa.radius.sm}px`,
                  backgroundColor: theme.aa.color.bg.base,
                  border: `1px solid ${theme.aa.color.border.subtle}`,
                  ...monoSx,
                  color: theme.aa.color.text.primary,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {job?.truncated && (
                  <Box sx={{ color: theme.aa.color.text.muted }}>
                    … earlier output trimmed …
                  </Box>
                )}
                {lines.map((line, index) => (
                  <Box key={`${index}-${line.slice(0, 24)}`}>{line || '\u00a0'}</Box>
                ))}
              </Box>
            )}

            {job?.state === 'succeeded' && (
              <Alert severity="success" sx={{ fontSize: 12.5, mt: 1.5 }}>
                {changes.length === 0
                  ? 'Finished. No package versions changed.'
                  : `Finished. ${changes.length} package version(s) changed:`}
                {changes.length > 0 && (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 0.75 }}>
                    {changes.map((change) => (
                      <Chip
                        key={change.name}
                        size="small"
                        variant="outlined"
                        sx={{ height: 20, fontSize: 11, fontFamily: theme.aa.font.mono }}
                        label={`${change.name} ${change.from || '—'} → ${change.to || '—'}`}
                      />
                    ))}
                  </Box>
                )}
              </Alert>
            )}

            {job?.state === 'failed' && job.error && (
              <Alert severity="error" sx={{ fontSize: 12.5, mt: 1.5 }}>
                {job.error}
              </Alert>
            )}

            {/* ---------------- Installed tools ---------------- */}
            <Divider sx={{ my: 1.5 }} />
            <Typography sx={{ fontSize: 13, fontWeight: 600, mb: 0.5 }}>
              Installed AA-SI tools
            </Typography>
            {info.tools.length === 0 ? (
              <Typography sx={{ fontSize: 12, color: theme.aa.color.text.muted }}>
                No <code>aa-*</code> console tools found in {info.prefix}. The
                Workbench can still serve the UI, but the tools it drives are
                missing.
              </Typography>
            ) : (
              <Table size="small" sx={{ '& td, & th': { borderColor: theme.aa.color.border.subtle } }}>
                <TableHead>
                  <TableRow>
                    {['Tool', 'Package', 'Version'].map((heading) => (
                      <TableCell
                        key={heading}
                        sx={{ fontSize: 11.5, color: theme.aa.color.text.muted, py: 0.5 }}
                      >
                        {heading}
                      </TableCell>
                    ))}
                  </TableRow>
                </TableHead>
                <TableBody>
                  {info.tools.map((tool) => (
                    <TableRow key={tool.name} hover>
                      <TableCell sx={{ ...monoSx, py: 0.4 }}>{tool.name}</TableCell>
                      <TableCell sx={{ ...monoSx, py: 0.4 }}>
                        {tool.distribution || '—'}
                      </TableCell>
                      <TableCell sx={{ ...monoSx, py: 0.4 }}>
                        {tool.version || '—'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}

            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
              {info.packages.map((pkg) => (
                <Chip
                  key={pkg.name}
                  size="small"
                  variant="outlined"
                  sx={{ height: 20, fontSize: 11, fontFamily: theme.aa.font.mono }}
                  label={`${pkg.name} ${pkg.version || 'not installed'}`}
                />
              ))}
            </Box>
          </>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 2, py: 1.25, gap: 0.5 }}>
        <Button
          size="small"
          variant="text"
          startIcon={<RefreshOutlined sx={{ fontSize: 16 }} />}
          disabled={infoLoading}
          onClick={() => void loadEnvironment()}
        >
          Refresh
        </Button>
        <Box sx={{ flex: 1 }} />
        {running ? (
          <Button
            size="small"
            color="warning"
            variant="outlined"
            startIcon={<StopOutlined sx={{ fontSize: 16 }} />}
            onClick={() => void cancelUpdate()}
          >
            Cancel update
          </Button>
        ) : (
          <Button
            size="small"
            variant="contained"
            disabled={!info?.updateEnabled || !action?.available}
            startIcon={<SystemUpdateAltOutlined sx={{ fontSize: 16 }} />}
            onClick={() => void startUpdate('environment')}
          >
            {job && job.state !== 'idle' ? 'Run again' : 'Run update'}
          </Button>
        )}
        <Button size="small" variant="text" onClick={onClose}>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
