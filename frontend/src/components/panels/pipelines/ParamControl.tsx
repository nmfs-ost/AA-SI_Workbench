import {
  Autocomplete,
  Box,
  Checkbox,
  FormControlLabel,
  InputAdornment,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import FolderOpenOutlined from '@mui/icons-material/FolderOpenOutlined';
import InputOutlined from '@mui/icons-material/InputOutlined';

import type { ParamDef, ParamValue } from './pipelineTypes';

interface Props {
  param: ParamDef;
  value: ParamValue;
  onChange: (value: ParamValue) => void;
  /** The file injected from the left window, if any. */
  injectedInput?: string | null;
}

/**
 * Renders a single parameter as the control its declared `type` calls for:
 *
 *   enum    → dropdown          number  → numeric field
 *   multi   → tag multi-select  boolean → checkbox
 *   string  → text field        path    → text field with a browse affordance
 *   file    → file selector (auto-filled from the left-window selection)
 *
 * Every pipeline gets consistent, type-appropriate controls with no
 * per-pipeline UI code. Used by the Configuration panel, which is the single
 * place a setting is edited.
 */
export function ParamControl({ param, value, onChange, injectedInput }: Props) {
  const theme = useTheme();
  const fieldSx = { '& .MuiInputBase-root': { fontSize: 12.5 } };
  const monoInputSx = {
    '& .MuiInputBase-input': { fontFamily: theme.aa.font.mono, fontSize: 12 },
  };

  /* ---------------- file (injectable input) ---------------- */
  if (param.type === 'file' || param.role === 'input') {
    const injected = Boolean(injectedInput);
    const shown = injectedInput ?? (typeof value === 'string' ? value : '');
    return (
      <TextField
        size="small"
        fullWidth
        label={param.label}
        value={shown}
        placeholder="Select a file in the NCEI panel"
        onChange={(e) => onChange(e.target.value)}
        InputProps={{
          readOnly: injected,
          startAdornment: (
            <InputAdornment position="start">
              <InputOutlined
                sx={{
                  fontSize: 15,
                  color: injected
                    ? theme.aa.color.accent.main
                    : theme.aa.color.text.muted,
                }}
              />
            </InputAdornment>
          ),
        }}
        helperText={injected ? 'Injected from the NCEI selection' : param.help}
        sx={{
          ...fieldSx,
          '& .MuiInputBase-input': {
            fontFamily: theme.aa.font.mono,
            fontSize: 12,
            color: injected ? theme.aa.color.accent.main : theme.aa.color.text.primary,
          },
        }}
      />
    );
  }

  /* ---------------- boolean ---------------- */
  if (param.type === 'boolean') {
    return (
      <Tooltip title={param.help ?? ''}>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={value === true}
              onChange={(e) => onChange(e.target.checked)}
              sx={{ p: 0.6 }}
            />
          }
          label={<Typography sx={{ fontSize: 12.5 }}>{param.label}</Typography>}
          sx={{ ml: 0 }}
        />
      </Tooltip>
    );
  }

  /* ---------------- enum ---------------- */
  if (param.type === 'enum') {
    return (
      <TextField
        select
        size="small"
        fullWidth
        label={param.label}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        helperText={param.help}
        sx={fieldSx}
      >
        {(param.options ?? []).map((option) => (
          <MenuItem key={option} value={option} sx={{ fontSize: 12.5 }}>
            {option}
          </MenuItem>
        ))}
      </TextField>
    );
  }

  /* ---------------- multi ---------------- */
  if (param.type === 'multi') {
    const list = Array.isArray(value) ? value : [];
    return (
      <Autocomplete
        multiple
        size="small"
        options={[...(param.options ?? [])]}
        value={list}
        onChange={(_, next) => onChange(next)}
        ChipProps={{ size: 'small', sx: { height: 18, fontSize: 10 } }}
        renderInput={(params) => (
          <TextField
            {...params}
            label={param.label}
            placeholder={list.length === 0 ? 'All' : ''}
            helperText={param.help}
            sx={fieldSx}
          />
        )}
      />
    );
  }

  /* ---------------- number ---------------- */
  if (param.type === 'number') {
    return (
      <TextField
        type="number"
        size="small"
        fullWidth
        label={param.label}
        value={value === '' || value === undefined ? '' : Number(value)}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === '' ? '' : Number(raw));
        }}
        inputProps={{ min: param.min, max: param.max, step: param.step ?? 1 }}
        helperText={param.help}
        sx={fieldSx}
      />
    );
  }

  /* ---------------- path & string ---------------- */
  const isPath = param.type === 'path';
  return (
    <Box>
      <TextField
        size="small"
        fullWidth
        label={param.label}
        value={String(value ?? '')}
        placeholder={param.placeholder}
        onChange={(e) => onChange(e.target.value)}
        helperText={param.help}
        InputProps={
          isPath
            ? {
                startAdornment: (
                  <InputAdornment position="start">
                    <FolderOpenOutlined
                      sx={{ fontSize: 15, color: theme.aa.color.text.muted }}
                    />
                  </InputAdornment>
                ),
              }
            : undefined
        }
        sx={{ ...fieldSx, ...(isPath ? monoInputSx : {}) }}
      />
    </Box>
  );
}
