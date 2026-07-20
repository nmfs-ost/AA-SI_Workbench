import { useState } from 'react';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Snackbar,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import CallMergeOutlined from '@mui/icons-material/CallMergeOutlined';

import type { NceiActionKind } from './nceiTypes';
import { formatBytes } from './nceiService';
import type { NceiSearchController } from './useNceiSearch';

interface Props {
  controller: NceiSearchController;
}

const MIN_COMBINE_FILES = 2; // echopype.combine_echodata requires at least two

function ncName(rawName: string): string {
  return rawName.replace(/\.raw$/i, '.nc');
}

function prettyDate(value: string): string {
  return value.replace('T', ' ');
}

function rangeDescription(from: string, to: string): string {
  if (from && to) return ` between ${prettyDate(from)} and ${prettyDate(to)}`;
  if (from) return ` from ${prettyDate(from)}`;
  if (to) return ` up to ${prettyDate(to)}`;
  return '';
}

function CommandPreview({ lines }: { lines: string[] }) {
  const theme = useTheme();
  return (
    <Box
      sx={{
        mt: 1,
        p: 1,
        borderRadius: `${theme.aa.radius.sm}px`,
        backgroundColor: theme.aa.color.bg.base,
        border: `1px solid ${theme.aa.color.border.subtle}`,
        fontFamily: theme.aa.font.mono,
        fontSize: 11.5,
        color: theme.aa.color.text.secondary,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-all',
      }}
    >
      {lines.join('\n')}
    </Box>
  );
}

/**
 * Bottom action bar + confirmation dialog. Actions run on the current target set
 * — the checked files, or (the common case for huge surveys) every file in the
 * chosen datetime range. Download the raws (aa-fetch) or fetch -> convert ->
 * combine them into a single .nc derived asset (aa-combine) and upload it.
 * Execution is deferred to the backend; staging previews the submitted job.
 */
export function NceiActions({ controller }: Props) {
  const theme = useTheme();
  const { targetFiles, totalTargetBytes, context, channels, dateFrom, dateTo, selected } =
    controller;
  const count = targetFiles.length;

  const [mode, setMode] = useState<NceiActionKind | null>(null);
  const [outputName, setOutputName] = useState('');
  const [destination, setDestination] = useState('');
  const [selectedChannels, setSelectedChannels] = useState<string[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const surveyName = context.survey?.name ?? 'survey';
  const sonarName = context.sonar?.name ?? 'sonar';
  const vesselId = context.vessel?.id ?? 'vessel';

  const usingSelection = selected.size > 0;
  const scopeLabel = usingSelection ? 'selected' : dateFrom || dateTo ? 'in range' : 'in view';
  const rangeText = usingSelection ? '' : rangeDescription(dateFrom, dateTo);

  const openDialog = (kind: NceiActionKind) => {
    if (kind === 'combine-nc') {
      setOutputName(`combined_${surveyName}_${sonarName}.nc`);
      setDestination(`gs://<derived-assets-bucket>/${surveyName}/`);
      setSelectedChannels([]);
    } else {
      setDestination(`./${vesselId}_${surveyName}_${sonarName}_NCEI`);
    }
    setMode(kind);
  };

  const stageJob = () => {
    const label = mode === 'combine-nc' ? 'Combine -> .nc' : 'Download raw';
    setToast(`Staged "${label}" job for ${count} file(s) - preview only (backend not connected).`);
    setMode(null);
  };

  const previewNames = targetFiles.slice(0, 3).map((f) => ncName(f.name));
  const extra = targetFiles.length - previewNames.length;
  const channelFlag =
    selectedChannels.length > 0 ? ` --channels "${selectedChannels.join(',')}"` : '';

  return (
    <Box
      sx={{
        borderTop: `1px solid ${theme.aa.color.border.subtle}`,
        p: 1.25,
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        backgroundColor: theme.aa.color.bg.chrome,
      }}
    >
      <Typography sx={{ fontSize: 12, color: theme.aa.color.text.secondary }}>
        {count > 0
          ? `${count} file${count === 1 ? '' : 's'} ${scopeLabel} · ${formatBytes(totalTargetBytes)}`
          : 'No files to act on'}
      </Typography>

      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
        <Button
          variant="outlined"
          size="small"
          startIcon={<DownloadOutlined />}
          disabled={count === 0}
          onClick={() => openDialog('download-raw')}
          sx={{ flex: '1 1 auto', minWidth: 128 }}
        >
          Download raw
        </Button>

        <Tooltip
          title={
            count < MIN_COMBINE_FILES
              ? `Combine needs at least ${MIN_COMBINE_FILES} files - widen the range or selection`
              : ''
          }
        >
          <span style={{ flex: '1 1 auto', minWidth: 128, display: 'flex' }}>
            <Button
              variant="contained"
              size="small"
              startIcon={<CallMergeOutlined />}
              disabled={count < MIN_COMBINE_FILES}
              onClick={() => openDialog('combine-nc')}
              sx={{ flex: 1 }}
            >
              Combine → .nc
            </Button>
          </span>
        </Tooltip>
      </Box>

      {/* ---- Job dialog ---- */}
      <Dialog open={mode !== null} onClose={() => setMode(null)} maxWidth="sm" fullWidth>
        {mode === 'combine-nc' ? (
          <>
            <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>
              Create combined NetCDF (.nc)
            </DialogTitle>
            <DialogContent dividers>
              <Typography sx={{ fontSize: 13, mb: 1.5 }}>
                {count} raw files{rangeText} from{' '}
                <b>
                  {context.vessel?.name} › {surveyName} › {sonarName}
                </b>{' '}
                will be fetched from NCEI, converted to EchoData, combined into a
                single <code>.nc</code>, and uploaded as a derived asset.
              </Typography>

              <Typography
                sx={{ fontSize: 11.5, color: theme.aa.color.text.muted, mb: 2 }}
              >
                Pipeline: fetch (aa-fetch) → convert (aa-raw) → combine
                (aa-combine, echopype.combine_echodata) → upload. Files are ordered
                chronologically by name, as combine requires.
              </Typography>

              <TextField
                fullWidth
                size="small"
                label="Output file name"
                value={outputName}
                onChange={(e) => setOutputName(e.target.value)}
                sx={{ mb: 1.5 }}
              />
              <TextField
                fullWidth
                size="small"
                label="Upload destination (derived asset)"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                sx={{ mb: 1.5 }}
              />
              {channels.length > 0 && (
                <Autocomplete
                  multiple
                  size="small"
                  options={channels}
                  value={selectedChannels}
                  onChange={(_, value) => setSelectedChannels(value)}
                  renderInput={(params) => (
                    <TextField
                      {...params}
                      label="Channels (optional subset)"
                      placeholder="All channels"
                    />
                  )}
                />
              )}

              <Divider sx={{ my: 2 }} />
              <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
                Equivalent command
              </Typography>
              <CommandPreview
                lines={[
                  `aa-combine ${previewNames.join(' ')}${extra > 0 ? ` … (+${extra} more)` : ''} \\`,
                  `  -o ${outputName || 'combined.nc'}${channelFlag}`,
                ]}
              />

              <Alert severity="info" sx={{ mt: 2, fontSize: 12 }}>
                Preview only - the backend API isn't connected yet. Staging shows
                the job that will be submitted; nothing is fetched, combined, or
                uploaded locally.
              </Alert>
            </DialogContent>
          </>
        ) : (
          <>
            <DialogTitle sx={{ fontSize: 15, fontWeight: 600 }}>
              Download raw files
            </DialogTitle>
            <DialogContent dividers>
              <Typography sx={{ fontSize: 13, mb: 1.5 }}>
                {count} raw files{rangeText} ({formatBytes(totalTargetBytes)}) from{' '}
                <b>
                  {context.vessel?.name} › {surveyName} › {sonarName}
                </b>{' '}
                will be downloaded from NCEI.
              </Typography>

              <TextField
                fullWidth
                size="small"
                label="Download directory"
                value={destination}
                onChange={(e) => setDestination(e.target.value)}
                sx={{ mb: 1 }}
              />

              <Divider sx={{ my: 2 }} />
              <Typography sx={{ fontSize: 12, fontWeight: 600, mb: 0.5 }}>
                Equivalent command
              </Typography>
              <CommandPreview
                lines={[`aa-get | aa-fetch -o ${destination || './downloads'}`]}
              />

              <Alert severity="info" sx={{ mt: 2, fontSize: 12 }}>
                Preview only - the backend API isn't connected yet. Staging shows
                the job that will be submitted; nothing is downloaded locally.
              </Alert>
            </DialogContent>
          </>
        )}

        <DialogActions>
          <Button size="small" onClick={() => setMode(null)}>
            Cancel
          </Button>
          <Button size="small" variant="contained" onClick={stageJob}>
            Stage job (preview)
          </Button>
        </DialogActions>
      </Dialog>

      <Snackbar
        open={toast !== null}
        autoHideDuration={4000}
        onClose={() => setToast(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          severity="success"
          variant="filled"
          onClose={() => setToast(null)}
          sx={{ fontSize: 12.5 }}
        >
          {toast}
        </Alert>
      </Snackbar>
    </Box>
  );
}
