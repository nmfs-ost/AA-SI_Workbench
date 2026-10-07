import { useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  MenuItem,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';
import { InfoOutlined, SettingsOutlined } from '@mui/icons-material';

import type { SonarModel, Survey, Vessel } from '../../../services/ncei/nceiTypes';
import { fuzzyFilterOptions } from '../../../services/ncei/fuzzy';
import { whereFiles } from '../../../services/sources/sourcesApi';
import { compactFieldSx, compactPopupSx } from '../panelStyles';
import type { PrepareState } from '../../../state/prepare';
import { currentSource, selectSonar, selectSource, selectSurvey, selectVessel } from '../../../state/prepare';
import { SourcesDialog } from './SourcesDialog';
import { extentOf, formatUtc } from './plan';
import { Note } from './ui';

/**
 * Step 1: where the data comes from.
 *
 * First the source (NCEI, OMAO, an archive added later), then the drill-down
 * aa-find does (vessel → survey → echosounder), with fuzzy search, because a
 * source holds far too many surveys to scroll. An echosounder that is the
 * survey's only one is chosen for you.
 */
export function SourceStep({ s }: { s: PrepareState }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const extent = extentOf(s.files);
  const source = currentSource(s);
  const [managing, setManaging] = useState<string | null>(null);
  const offline = Boolean(source && !source.ready);
  const where = s.vessel && s.survey && s.sonar ? whereFiles(source, s.vessel.id, s.survey.id, s.sonar.id) : '';

  const spinner = (on: boolean) =>
    on ? <CircularProgress size={11} sx={{ mr: 3.5 }} /> : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1 }}>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
        <TextField
          select
          size="small"
          label="Source"
          value={s.sources.some((x) => x.id === s.source) ? s.source : ''}
          onChange={(e) => void selectSource(e.target.value)}
          InputLabelProps={{ shrink: true }}
          sx={{ ...compactFieldSx, flex: 1, minWidth: 0 }}
          SelectProps={{
            renderValue: () => source?.name ?? s.source,
            MenuProps: { slotProps: { paper: { sx: compactPopupSx } } },
          }}
          helperText={s.sourcesError || undefined}
          error={Boolean(s.sourcesError)}
        >
          {s.sources.map((x) => (
            <MenuItem key={x.id} value={x.id} dense sx={{ alignItems: 'flex-start', gap: 1 }}>
              <Box
                component="span"
                sx={{
                  mt: '6px',
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  flexShrink: 0,
                  backgroundColor: x.ready ? c.status.success : c.text.disabled,
                }}
              />
              <Box sx={{ minWidth: 0 }}>
                <Typography sx={{ fontSize: 12.5 }}>{x.name}</Typography>
                <Typography sx={{ fontSize: 10.5, color: c.text.muted, whiteSpace: 'normal', maxWidth: 300 }}>
                  {x.ready ? x.description : 'Not connected yet'}
                </Typography>
              </Box>
            </MenuItem>
          ))}
        </TextField>
        <Button
          size="small"
          startIcon={<SettingsOutlined sx={{ fontSize: 15 }} />}
          onClick={() => setManaging(s.source)}
          sx={{ textTransform: 'none', fontSize: 11.5, flexShrink: 0 }}
        >
          Sources…
        </Button>
      </Box>
      {offline && source && (
        <Note tone="info" icon={<InfoOutlined className="note-icon" />}>
          {source.detail}{' '}
          <Box
            component="button"
            type="button"
            onClick={() => setManaging(source.id)}
            sx={{
              p: 0,
              border: 0,
              background: 'none',
              color: c.accent.main,
              font: 'inherit',
              cursor: 'pointer',
              textDecoration: 'underline',
            }}
          >
            Connect {source.name}…
          </Box>
        </Note>
      )}
      <Autocomplete
        size="small"
        sx={compactFieldSx}
        options={s.vessels}
        value={s.vessel}
        disabled={offline}
        loading={s.loading.vessels}
        onChange={(_, v) => void selectVessel(v)}
        getOptionLabel={(o) => o.name}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        filterOptions={fuzzyFilterOptions<Vessel>((o) => o.name)}
        slotProps={{ paper: { sx: compactPopupSx } }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Vessel"
            placeholder={`Search ${source?.name ?? 'NCEI'} vessels…`}
            InputLabelProps={{ shrink: true }}
          />
        )}
      />
      <Box sx={{ display: 'flex', gap: 1 }}>
        <Autocomplete
          size="small"
          sx={{ ...compactFieldSx, flex: 1.35, minWidth: 0 }}
          options={s.surveys}
          value={s.survey}
          disabled={!s.vessel}
          loading={s.loading.surveys}
          onChange={(_, v) => void selectSurvey(v)}
          getOptionLabel={(o) => o.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          filterOptions={fuzzyFilterOptions<Survey>((o) => o.name)}
          slotProps={{ paper: { sx: compactPopupSx } }}
          renderInput={(params) => (
            <TextField {...params} label="Survey" placeholder="HB1603…" InputLabelProps={{ shrink: true }} />
          )}
        />
        <Autocomplete
          size="small"
          sx={{ ...compactFieldSx, flex: 1, minWidth: 0 }}
          options={s.sonars}
          value={s.sonar}
          disabled={!s.survey}
          loading={s.loading.sonars}
          onChange={(_, v) => void selectSonar(v)}
          getOptionLabel={(o) => o.name}
          isOptionEqualToValue={(a, b) => a.id === b.id}
          filterOptions={fuzzyFilterOptions<SonarModel>((o) => o.name)}
          slotProps={{ paper: { sx: compactPopupSx } }}
          renderInput={(params) => (
            <TextField
              {...params}
              label="Echosounder"
              placeholder="EK60…"
              InputLabelProps={{ shrink: true }}
              InputProps={{
                ...params.InputProps,
                endAdornment: (
                  <>
                    {spinner(s.loading.files)}
                    {params.InputProps.endAdornment}
                  </>
                ),
              }}
            />
          )}
        />
      </Box>
      {s.vessel && s.survey && s.sonar && (
        <Typography
          sx={{
            fontSize: 10.5,
            color: c.text.muted,
            fontFamily: theme.aa.font.mono,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
          title={where}
        >
          {s.loading.files
            ? 'Listing raw files…'
            : extent
              ? `${s.files.length.toLocaleString()} files · ${formatUtc(extent.from, false).slice(0, 10)} → ${formatUtc(extent.to, false).slice(0, 10)}`
              : 'No raw files in this folder.'}
        </Typography>
      )}
      <SourcesDialog open={managing !== null} focus={managing ?? ''} sources={s.sources} onClose={() => setManaging(null)} />
    </Box>
  );
}
