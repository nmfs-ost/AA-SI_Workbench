import { Autocomplete, Box, CircularProgress, TextField, Typography, useTheme } from '@mui/material';

import type { SonarModel, Survey, Vessel } from '../../../services/ncei/nceiTypes';
import { fuzzyFilterOptions } from '../../../services/ncei/fuzzy';
import { NCEI_BUCKET } from '../../../services/ncei/nceiService';
import { compactFieldSx, compactPopupSx } from '../panelStyles';
import type { PrepareState } from '../../../state/prepare';
import { selectSonar, selectSurvey, selectVessel } from '../../../state/prepare';
import { extentOf, formatUtc } from './plan';

/**
 * Step 1: where the data comes from.
 *
 * The drill-down aa-find does (vessel → survey → echosounder), with fuzzy
 * search, because NCEI holds far too many surveys to scroll.
 * An echosounder that is the survey's only one is chosen for you.
 */
export function SourceStep({ s }: { s: PrepareState }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const extent = extentOf(s.files);

  const spinner = (on: boolean) =>
    on ? <CircularProgress size={11} sx={{ mr: 3.5 }} /> : null;

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.1 }}>
      <Autocomplete
        size="small"
        sx={compactFieldSx}
        options={s.vessels}
        value={s.vessel}
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
            placeholder="Search NCEI vessels…"
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
          title={`s3://${NCEI_BUCKET}/data/raw/${s.vessel.id}/${s.survey.id}/${s.sonar.id}/`}
        >
          {s.loading.files
            ? 'Listing raw files…'
            : extent
              ? `${s.files.length.toLocaleString()} files · ${formatUtc(extent.from, false).slice(0, 10)} → ${formatUtc(extent.to, false).slice(0, 10)}`
              : 'No raw files in this folder.'}
        </Typography>
      )}
    </Box>
  );
}
