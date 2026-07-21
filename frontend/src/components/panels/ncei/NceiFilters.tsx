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
import { compactFieldSx, compactPopupSx, panelDensity } from '../panelStyles';
import type { NceiSearchController } from './useNceiSearch';

interface Props {
  controller: NceiSearchController;
}

/**
 * The drill-down controls: vessel -> survey -> sonar model, each a searchable
 * (fuzzy) dropdown that unlocks the next, followed by a fuzzy filter box over
 * the resulting .raw files. This is the graphical form of aa-find's keyboard
 * drill-down.
 *
 * Every control here is a text box you can type into, which is the whole point
 * of the panel — NCEI holds far too many surveys to pick one from a list — so
 * the density work sizes them down to the tree's type scale rather than
 * replacing them with anything simpler. `shrink` is forced on every label: at
 * this height there isn't room for a label to sit inside the field and animate
 * out of the way, and a label that never moves is one less thing to mis-render.
 */
export function NceiFilters({ controller }: Props) {
  const theme = useTheme();
  const { loading } = controller;

  const fieldProps = {
    size: 'small' as const,
    sx: compactFieldSx,
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: 1,
        p: 1,
        borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
      }}
    >
      <Autocomplete
        {...fieldProps}
        options={controller.vessels}
        value={controller.vessel}
        loading={loading.vessels}
        onChange={(_, value) => controller.selectVessel(value)}
        getOptionLabel={(option) => option.name}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        filterOptions={fuzzyFilterOptions<Vessel>((o) => o.name)}
        slotProps={{ paper: { sx: compactPopupSx } }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Vessel"
            placeholder="Search vessels…"
            InputLabelProps={{ shrink: true }}
          />
        )}
      />

      <Autocomplete
        {...fieldProps}
        options={controller.surveys}
        value={controller.survey}
        loading={loading.surveys}
        disabled={!controller.vessel}
        onChange={(_, value) => controller.selectSurvey(value)}
        getOptionLabel={(option) => option.name}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        filterOptions={fuzzyFilterOptions<Survey>((o) => o.name)}
        slotProps={{ paper: { sx: compactPopupSx } }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Survey"
            placeholder="Search surveys…"
            InputLabelProps={{ shrink: true }}
          />
        )}
      />

      <Autocomplete
        {...fieldProps}
        options={controller.sonars}
        value={controller.sonar}
        loading={loading.sonars}
        disabled={!controller.survey}
        onChange={(_, value) => controller.selectSonar(value)}
        getOptionLabel={(option) => option.name}
        isOptionEqualToValue={(a, b) => a.id === b.id}
        filterOptions={fuzzyFilterOptions<SonarModel>((o) => o.name)}
        slotProps={{ paper: { sx: compactPopupSx } }}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Sonar model"
            placeholder="EK60, EK80…"
            InputLabelProps={{ shrink: true }}
          />
        )}
      />

      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          {...fieldProps}
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
          sx={{ ...compactFieldSx, flex: 1 }}
        />
        <TextField
          {...fieldProps}
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
          sx={{ ...compactFieldSx, flex: 1 }}
        />
      </Box>

      <TextField
        {...fieldProps}
        value={controller.fileQuery}
        disabled={controller.files.length === 0}
        onChange={(e) => controller.setFileQuery(e.target.value)}
        placeholder="Filter .raw files…"
        InputProps={{
          startAdornment: (
            <InputAdornment position="start">
              <SearchOutlined
                sx={{
                  fontSize: panelDensity.icon.row,
                  color: theme.aa.color.text.muted,
                }}
              />
            </InputAdornment>
          ),
        }}
      />
    </Box>
  );
}
