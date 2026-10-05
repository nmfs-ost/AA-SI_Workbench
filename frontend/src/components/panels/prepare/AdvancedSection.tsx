import type { ReactNode } from 'react';
import {
  Box,
  Button,
  FormControlLabel,
  MenuItem,
  Switch,
  TextField,
  Typography,
  useTheme,
} from '@mui/material';

import { compactFieldSx, compactPopupSx } from '../panelStyles';
import type { PrepareState } from '../../../state/prepare';
import { resetOptions, update } from '../../../state/prepare';
import { Caption } from './ui';

const COLORMAPS = ['viridis', 'magma', 'inferno', 'plasma', 'cividis', 'jet'];

/**
 * The settings most runs never touch, each named for what it does rather than
 * for its flag. The flag is in the tooltip-free caption line under each group
 * so that someone reading the console commands can map one to the other.
 */
export function AdvancedSection({ s, bucketDefault }: { s: PrepareState; bucketDefault: string }) {
  const theme = useTheme();
  const c = theme.aa.color;

  const num = (
    label: string,
    value: number,
    onValue: (v: number) => void,
    props: { min?: number; step?: number } = {},
  ) => (
    <TextField
      size="small"
      type="number"
      label={label}
      value={Number.isFinite(value) ? value : ''}
      onChange={(e) => {
        const v = Number(e.target.value);
        if (e.target.value !== '' && Number.isFinite(v)) onValue(v);
      }}
      InputLabelProps={{ shrink: true }}
      inputProps={props}
      sx={{ ...compactFieldSx, flex: 1, minWidth: 0 }}
    />
  );

  const toggle = (label: ReactNode, checked: boolean, onValue: (v: boolean) => void) => (
    <FormControlLabel
      control={<Switch size="small" checked={checked} onChange={(e) => onValue(e.target.checked)} />}
      label={<Typography sx={{ fontSize: 11.5, color: c.text.primary }}>{label}</Typography>}
      sx={{ ml: -0.5, mr: 0, alignItems: 'flex-start', '& .MuiSwitch-root': { mt: -0.4 } }}
    />
  );

  const hint = (text: ReactNode) => (
    <Typography sx={{ fontSize: 10.5, color: c.text.muted, lineHeight: 1.45, mt: 0.4 }}>{text}</Typography>
  );
  const flag = (text: string) => (
    <Box component="code" sx={{ fontFamily: theme.aa.font.mono, fontSize: 10, color: c.text.secondary }}>
      {text}
    </Box>
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.75, pt: 0.5 }}>
      <Box>
        <Caption>Quality control</Caption>
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          {num('Gap floor (s)', s.gapSeconds, (v) => update({ gapSeconds: v }), { min: 0, step: 60 })}
          {num('Gap factor (×cadence)', s.gapFactor, (v) => update({ gapFactor: v }), { min: 1, step: 1 })}
        </Box>
        {hint(<>A pause counts as a gap when it lasts at least the floor and the factor times the file cadence. {flag('--gap_seconds --gap_factor')}</>)}
        <Box sx={{ mt: 1 }}>
          {toggle('Stop at gaps, overlaps and duplicate pings', s.strict, (v) => update({ strict: v }))}
          {hint(<>Off: they are recorded in the QC report and the combine goes ahead. {flag('--strict')}</>)}
        </Box>
      </Box>

      {s.sonar?.id.toUpperCase().includes('EK80') && (
        <Box sx={{ opacity: s.sv ? 1 : 0.5 }}>
          <Caption>EK80 calibration</Caption>
          <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
            <TextField
              select
              size="small"
              label="Waveform"
              value={s.waveformMode}
              onChange={(e) => update({ waveformMode: e.target.value as 'CW' | 'BB' })}
              InputLabelProps={{ shrink: true }}
              SelectProps={{ MenuProps: { PaperProps: { sx: compactPopupSx } } }}
              sx={{ ...compactFieldSx, flex: 1, minWidth: 0 }}
            >
              <MenuItem value="CW" sx={{ fontSize: 12, minHeight: 28 }}>CW (narrowband)</MenuItem>
              <MenuItem value="BB" sx={{ fontSize: 12, minHeight: 28 }}>BB / FM (broadband)</MenuItem>
            </TextField>
            <TextField
              select
              size="small"
              label="Samples"
              value={s.encodeMode}
              onChange={(e) => update({ encodeMode: e.target.value as 'complex' | 'power' })}
              InputLabelProps={{ shrink: true }}
              SelectProps={{ MenuProps: { PaperProps: { sx: compactPopupSx } } }}
              sx={{ ...compactFieldSx, flex: 1, minWidth: 0 }}
            >
              <MenuItem value="complex" sx={{ fontSize: 12, minHeight: 28 }}>complex</MenuItem>
              <MenuItem value="power" sx={{ fontSize: 12, minHeight: 28 }}>power</MenuItem>
            </TextField>
          </Box>
          {hint(<>echopype needs both to calibrate EK80 data: how it was transmitted, and how it was recorded (power for reduced-power files). {flag('aa-sv --waveform_mode --encode_mode')}</>)}
        </Box>
      )}

      <Box sx={{ opacity: s.sv && s.echogram ? 1 : 0.5 }}>
        <Caption>Echogram</Caption>
        <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
          {num('Min (dB)', s.echogramOptions.vmin, (v) => update({ echogramOptions: { ...s.echogramOptions, vmin: v } }))}
          {num('Max (dB)', s.echogramOptions.vmax, (v) => update({ echogramOptions: { ...s.echogramOptions, vmax: v } }))}
        </Box>
        <Box sx={{ display: 'flex', gap: 1, mt: 1.25 }}>
          {num('Every nth ping', s.echogramOptions.decimate, (v) => update({ echogramOptions: { ...s.echogramOptions, decimate: Math.max(1, Math.round(v)) } }), { min: 1 })}
          <TextField
            select
            size="small"
            label="Colour map"
            value={s.echogramOptions.cmap}
            onChange={(e) => update({ echogramOptions: { ...s.echogramOptions, cmap: e.target.value } })}
            InputLabelProps={{ shrink: true }}
            SelectProps={{ MenuProps: { PaperProps: { sx: compactPopupSx } } }}
            sx={{ ...compactFieldSx, flex: 1, minWidth: 0 }}
          >
            {COLORMAPS.map((m) => (
              <MenuItem key={m} value={m} sx={{ fontSize: 12, minHeight: 28 }}>
                {m}
              </MenuItem>
            ))}
          </TextField>
        </Box>
        {hint(<>How the picture is drawn; the Sv is not affected. {flag('aa-graph --vmin --vmax --decimate --cmap')}</>)}
      </Box>

      <Box>
        <Caption>Bucket</Caption>
        <TextField
          size="small"
          fullWidth
          label="Bucket"
          value={s.bucket}
          placeholder={bucketDefault || 'the Workbench bucket'}
          onChange={(e) => update({ bucket: e.target.value.replace(/^gs:\/\//, '').replace(/\/.*$/, '') })}
          InputLabelProps={{ shrink: true }}
          inputProps={{ spellCheck: false }}
          sx={{ ...compactFieldSx, mt: 1, '& .MuiInputBase-input': { fontFamily: theme.aa.font.mono, fontSize: 11.5 } }}
        />
        {hint('Leave empty for the bucket the Derived panel shows. Working files: see Working space.')}
      </Box>

      <Box>
        <Button
          size="small"
          onClick={resetOptions}
          sx={{ textTransform: 'none', fontSize: 11.5, px: 1, ml: -1 }}
        >
          Reset to defaults
        </Button>
      </Box>
    </Box>
  );
}
