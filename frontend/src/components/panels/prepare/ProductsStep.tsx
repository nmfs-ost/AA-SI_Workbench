import type { ReactNode } from 'react';
import { Box, ButtonBase, Checkbox, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import { LockOutlined } from '@mui/icons-material';

import { LevelChip } from './ui';

interface Props {
  sv: boolean;
  echogram: boolean;
  format: 'nc' | 'zarr';
  /** One file: nothing to merge, so the asset is always NetCDF. */
  single: boolean;
  onChange: (patch: { sv?: boolean; echogram?: boolean; format?: 'nc' | 'zarr' }) => void;
}

/**
 * Step 3: what to make.
 *
 * EchoData is the asset — the bookmark in the data lifecycle — so it cannot be
 * turned off; the lock says so rather than a disabled box that looks broken.
 * Sv and its echogram are the usual next step and on by default, and each row
 * says which tool makes it and at which level it sits.
 */
export function ProductsStep({ sv, echogram, format, single, onChange }: Props) {
  const theme = useTheme();
  const c = theme.aa.color;

  return (
    <Box
      sx={{
        borderRadius: `${theme.aa.radius.md}px`,
        border: `1px solid ${c.border.subtle}`,
        overflow: 'hidden',
      }}
    >
      <Row
        control={
          <Tooltip title="The asset this card makes; always produced" placement="left">
            <Box sx={{ width: 26, display: 'flex', justifyContent: 'center' }}>
              <LockOutlined sx={{ fontSize: 13, color: c.accent.main }} />
            </Box>
          </Tooltip>
        }
        title="EchoData"
        level="L1"
        tool="aa-ed + aa-combine"
        text={single
          ? 'The one raw file, converted to echopype EchoData.'
          : 'The raw files merged in time order into one echopype EchoData, with a QC report.'}
        extra={
          <FormatToggle
            value={single ? 'nc' : format}
            disabled={single}
            onChange={(f) => onChange({ format: f })}
          />
        }
        emphasis
      />
      <Row
        control={
          <Checkbox
            size="small"
            checked={sv}
            onChange={(e) => onChange({ sv: e.target.checked })}
            inputProps={{ 'aria-label': 'Also compute Sv' }}
            sx={{ p: 0.5 }}
          />
        }
        title="Sv"
        level="L2A"
        tool="aa-sv"
        text="Calibrated volume backscattering strength, beside the EchoData."
      />
      <Row
        control={
          <Tooltip title={sv ? '' : 'An echogram is drawn from Sv: turn Sv on first'} placement="left">
            <span>
              <Checkbox
                size="small"
                checked={sv && echogram}
                disabled={!sv}
                onChange={(e) => onChange({ echogram: e.target.checked })}
                inputProps={{ 'aria-label': 'Also draw an echogram' }}
                sx={{ p: 0.5 }}
              />
            </span>
          </Tooltip>
        }
        title="Echogram"
        level="L2A"
        tool="aa-graph"
        text="A PNG of the Sv for a first look, named after it."
        dim={!sv}
      />
    </Box>
  );
}

function Row({
  control,
  title,
  level,
  tool,
  text,
  extra,
  emphasis = false,
  dim = false,
}: {
  control: ReactNode;
  title: string;
  level: string;
  tool: string;
  text: string;
  extra?: ReactNode;
  emphasis?: boolean;
  dim?: boolean;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  return (
    <Box
      sx={{
        display: 'flex',
        gap: 0.5,
        px: 0.5,
        py: 0.75,
        alignItems: 'flex-start',
        opacity: dim ? 0.55 : 1,
        backgroundColor: emphasis ? alpha(c.accent.main, 0.05) : 'transparent',
        '& + &': { borderTop: `1px solid ${c.border.subtle}` },
      }}
    >
      <Box sx={{ pt: emphasis ? 0.4 : 0, flexShrink: 0 }}>{control}</Box>
      <Box sx={{ minWidth: 0, flex: 1, pr: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minHeight: 24 }}>
          <Typography sx={{ fontSize: 12, fontWeight: 600, color: c.text.primary }}>{title}</Typography>
          <LevelChip level={level} />
          <Typography
            sx={{ fontSize: 10, fontFamily: theme.aa.font.mono, color: c.text.muted, whiteSpace: 'nowrap' }}
          >
            {tool}
          </Typography>
          {extra && <Box sx={{ ml: 'auto' }}>{extra}</Box>}
        </Box>
        <Typography sx={{ fontSize: 11, color: c.text.secondary, lineHeight: 1.45 }}>{text}</Typography>
      </Box>
    </Box>
  );
}

function FormatToggle({
  value,
  disabled,
  onChange,
}: {
  value: 'nc' | 'zarr';
  disabled: boolean;
  onChange: (value: 'nc' | 'zarr') => void;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const options: { id: 'nc' | 'zarr'; label: string; tip: string }[] = [
    { id: 'nc', label: '.nc', tip: 'NetCDF: one file, readable anywhere' },
    { id: 'zarr', label: '.zarr', tip: 'Zarr: a chunked store, for large ranges read in parts' },
  ];
  return (
    <Tooltip title={disabled ? 'One file is converted straight to NetCDF' : ''}>
      <Box
        role="radiogroup"
        aria-label="Storage format"
        sx={{
          display: 'inline-flex',
          border: `1px solid ${c.border.subtle}`,
          borderRadius: `${theme.aa.radius.sm}px`,
          overflow: 'hidden',
          opacity: disabled ? 0.6 : 1,
        }}
      >
        {options.map((o) => {
          const on = value === o.id;
          return (
            <Tooltip key={o.id} title={disabled ? '' : o.tip}>
              <ButtonBase
                role="radio"
                aria-checked={on}
                disabled={disabled}
                onClick={() => onChange(o.id)}
                sx={{
                  px: 0.75,
                  height: 18,
                  fontSize: 10,
                  fontFamily: theme.aa.font.mono,
                  fontWeight: 600,
                  color: on ? c.accent.main : c.text.muted,
                  backgroundColor: on ? c.accent.soft : 'transparent',
                }}
              >
                {o.label}
              </ButtonBase>
            </Tooltip>
          );
        })}
      </Box>
    </Tooltip>
  );
}
