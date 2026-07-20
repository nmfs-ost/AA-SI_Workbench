import {
  Autocomplete,
  Box,
  InputAdornment,
  TextField,
  useTheme,
} from '@mui/material';
import SearchOutlined from '@mui/icons-material/SearchOutlined';

import type { SonarModel, Survey, Vessel } from './nceiTypes';
import { fuzzyFilterOptions } from './fuzzy';
import type { NceiSearchController } from './useNceiSearch';

interface Props {
  controller: NceiSearchController;
}

/**
 * The drill-down controls: vessel -> survey -> sonar model, each a searchable
 * (fuzzy) dropdown that unlocks the next, followed by a fuzzy filter box over
 * the resulting .raw files. This is the graphical form of aa-find's keyboard
 * drill-down.
 */
export function NceiFilters({ controller }: Props) {
  const theme = useTheme();
  const { loading } = controller;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1.25,
        p: 1.25,
        borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
      }}
    >
      <Autocomplete
        size="small"
        options={controller.vessels}
        value={controller.vessel}
        loading={loading.vessels}
        onChange={(_, value) => controller.selectVessel(value)}
        getOptionLabel={(option) => option.name}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        filterOptions={fuzzyFilterOptions<Vessel>((o) => o.name)}
        renderInput={(params) => (
          <TextField {...params} label="Vessel" placeholder="Search vessels…" />
        )}
      />

      <Autocomplete
        size="small"
        options={controller.surveys}
        value={controller.survey}
        loading={loading.surveys}
        disabled={!controller.vessel}
        onChange={(_, value) => controller.selectSurvey(value)}
        getOptionLabel={(option) => option.name}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        filterOptions={fuzzyFilterOptions<Survey>((o) => o.name)}
        renderInput={(params) => (
          <TextField {...params} label="Survey" placeholder="Search surveys…" />
        )}
      />

      <Autocomplete
        size="small"
        options={controller.sonars}
        value={controller.sonar}
        loading={loading.sonars}
        disabled={!controller.survey}
        onChange={(_, value) => controller.selectSonar(value)}
        getOptionLabel={(option) => option.name}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        filterOptions={fuzzyFilterOptions<SonarModel>((o) => o.name)}
        renderInput={(params) => (
          <TextField {...params} label="Sonar model" placeholder="EK60, EK80…" />
        )}
      />

      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          size="small"
          type="datetime-local"
          label="From"
          value={controller.dateFrom}
          disabled={controller.files.length === 0}
          onChange={(e) => controller.setDateFrom(e.target.value)}
          InputLabelProps={{ shrink: true }}
          inputProps={{
            min: controller.dateBounds?.min,
            max: controller.dateBounds?.max,
          }}
          sx={{ flex: 1 }}
        />
        <TextField
          size="small"
          type="datetime-local"
          label="To"
          value={controller.dateTo}
          disabled={controller.files.length === 0}
          onChange={(e) => controller.setDateTo(e.target.value)}
          InputLabelProps={{ shrink: true }}
          inputProps={{
            min: controller.dateBounds?.min,
            max: controller.dateBounds?.max,
          }}
          sx={{ flex: 1 }}
        />
      </Box>

      <TextField
        size="small"
        value={controller.fileQuery}
        disabled={controller.files.length === 0}
        onChange={(e) => controller.setFileQuery(e.target.value)}
        placeholder="Filter .raw files…"
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchOutlined sx={{ fontSize: 18, color: theme.aa.color.text.muted }} />
            </InputAdornment>
          ),
        }}
      />
    </Box>
  );
}
