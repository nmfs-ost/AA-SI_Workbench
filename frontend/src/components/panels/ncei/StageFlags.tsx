import { useMemo, useState } from 'react';
import {
  Box,
  Checkbox,
  Chip,
  FormControlLabel,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import LockOutlined from '@mui/icons-material/LockOutlined';

import { compactFieldSx } from '../panelStyles';
import type { DiscoveredParam, ResolvedStage } from './sequence';

/**
 * The flags for one stage, as controls.
 *
 * Every control here is generated from what discovery read out of the tool —
 * flag spellings, type, default, and the choices for an enum. Nothing on this
 * screen is a hand-written guess about what a tool accepts, which is the whole
 * difference from the option list this replaces: that one had `aa-fetch`
 * taking `--ship_name`, `--survey_name`, `--sonar_model` and `--file_name`,
 * none of which exist on `aa-fetch`. It takes a YAML path and two flags.
 *
 * Three rules, all of them about not lying to the user:
 *
 * **Owned flags are shown, not hidden.** The sequence sets `--workdir`,
 * `-o` and friends from the selection and from the stage before. Hiding them
 * would make the command preview contain flags with no visible origin; making
 * them editable would let you break the chain that connects one stage to the
 * next without being told. So they render disabled, with their value and a
 * lock — visible, explained, not editable.
 *
 * **Defaults are placeholders, not values.** A field showing the tool's default
 * as its content would send that value explicitly on every run, which is a
 * different thing from leaving it unset — and it means a later change to the
 * tool's default silently stops taking effect. Empty field, default as
 * placeholder, flag omitted.
 *
 * **Sections come from the tool's own help.** The grouping is whatever the tool
 * writes in its `--help` (Input, Output, Quality control, Machine interfaces).
 * When a tool has no sections, everything lands in one group rather than an
 * order this panel invented.
 */

export type FlagValue = string | number | boolean;
export type FlagValues = Record<string, FlagValue>;

/** Flags every tool has, that nobody configures from a panel. */
const HIDDEN = new Set(['json', 'progress', 'describe', 'help', 'quiet', 'debug']);

function Control({
  param,
  value,
  owned,
  ownedValue,
  onChange,
}: {
  param: DiscoveredParam;
  value: FlagValue | undefined;
  owned: boolean;
  ownedValue: string;
  onChange: (next: FlagValue | undefined) => void;
}) {
  const theme = useTheme();
  const label = param.flags[0] ?? param.id;

  if (owned) {
    return (
      <Tooltip title="Set by the sequence, from your selection or from the previous step.">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, cursor: 'help' }}>
          <LockOutlined sx={{ fontSize: 12, color: theme.aa.color.text.muted }} />
          <Typography
            sx={{
              fontSize: 10.5,
              fontFamily: theme.aa.font.mono,
              color: theme.aa.color.text.muted,
            }}
          >
            {label}
          </Typography>
          <Typography
            sx={{
              fontSize: 10.5,
              fontFamily: theme.aa.font.mono,
              color: theme.aa.color.text.secondary,
              wordBreak: 'break-all',
            }}
          >
            {ownedValue || '—'}
          </Typography>
        </Box>
      </Tooltip>
    );
  }

  if (param.type === 'boolean') {
    return (
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked ? true : undefined)}
            sx={{ py: 0.25 }}
          />
        }
        label={
          <Tooltip title={param.help}>
            <Typography
              component="span"
              sx={{ fontSize: 11, fontFamily: theme.aa.font.mono, cursor: 'help' }}
            >
              {label}
            </Typography>
          </Tooltip>
        }
        sx={{ ml: 0 }}
      />
    );
  }

  if (param.type === 'enum') {
    return (
      <TextField
        select
        size="small"
        fullWidth
        label={label}
        value={value === undefined ? '' : String(value)}
        helperText={param.help}
        onChange={(e) => onChange(e.target.value || undefined)}
        InputLabelProps={{ shrink: true }}
        FormHelperTextProps={{ sx: { fontSize: 9.5, mt: 0.25 } }}
        sx={compactFieldSx}
      >
        {/* Explicitly leaving it unset is a choice the tool understands and the
            form must therefore offer — otherwise the default becomes
            unreachable the moment anything is picked. */}
        <MenuItem value="" sx={{ fontSize: 12 }}>
          <em>default{param.default != null ? ` — ${param.default}` : ''}</em>
        </MenuItem>
        {param.choices.map((choice) => (
          <MenuItem key={choice} value={choice} sx={{ fontSize: 12 }}>
            {choice}
          </MenuItem>
        ))}
      </TextField>
    );
  }

  return (
    <TextField
      size="small"
      fullWidth
      type={param.type === 'number' ? 'number' : 'text'}
      label={label}
      value={value === undefined ? '' : String(value)}
      placeholder={param.default != null ? String(param.default) : ''}
      helperText={param.help}
      onChange={(e) => {
        const text = e.target.value;
        if (!text) return onChange(undefined);
        onChange(param.type === 'number' ? Number(text) : text);
      }}
      InputLabelProps={{ shrink: true }}
      FormHelperTextProps={{ sx: { fontSize: 9.5, mt: 0.25 } }}
      sx={compactFieldSx}
    />
  );
}

export interface StageFlagsProps {
  resolved: ResolvedStage;
  values: FlagValues;
  onChange: (paramId: string, next: FlagValue | undefined) => void;
  /** paramId -> the value the sequence will pass, for the locked rows. */
  ownedValues: Record<string, string>;
}

export function StageFlags({
  resolved,
  values,
  onChange,
  ownedValues,
}: StageFlagsProps) {
  const theme = useTheme();
  const [showAll, setShowAll] = useState(false);
  const owns = useMemo(
    () => new Set(resolved.stage.owns ?? []),
    [resolved.stage.owns],
  );

  const visible = useMemo(
    () => resolved.params.filter((param) => !HIDDEN.has(param.id) && !param.positional),
    [resolved.params],
  );

  /* Grouped by the section the tool's own help puts them in. A tool with no
     sections gets one unnamed group rather than an ordering invented here. */
  const grouped = useMemo(() => {
    const groups = new Map<string, DiscoveredParam[]>();
    for (const param of visible) {
      const key = param.section || '';
      const list = groups.get(key) ?? [];
      list.push(param);
      groups.set(key, list);
    }
    return [...groups.entries()];
  }, [visible]);

  if (resolved.params.length === 0) {
    return (
      <Typography sx={{ fontSize: 10, color: theme.aa.color.text.muted }}>
        No flags discovered for {resolved.resolvedTool}.
      </Typography>
    );
  }

  const set = visible.filter((p) => !owns.has(p.id) && values[p.id] !== undefined);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexWrap: 'wrap' }}>
        <Typography sx={{ fontSize: 9.5, color: theme.aa.color.text.muted }}>
          {visible.length} flags, read from {resolved.resolvedTool}
        </Typography>
        {set.length > 0 && (
          <Chip
            size="small"
            label={`${set.length} set`}
            sx={{
              height: 14,
              fontSize: 9,
              backgroundColor: theme.aa.color.accent.soft,
              color: theme.aa.color.accent.main,
            }}
          />
        )}
        <Box sx={{ flex: 1 }} />
        <Typography
          onClick={() => setShowAll((v) => !v)}
          sx={{
            fontSize: 9.5,
            cursor: 'pointer',
            color: theme.aa.color.accent.main,
            userSelect: 'none',
          }}
        >
          {showAll ? 'Show fewer' : 'All flags'}
        </Typography>
      </Box>

      {grouped.map(([section, params]) => {
        /* Collapsed, a stage shows what the sequence is passing plus anything
           already set — the two things that answer "what will this run".
           Everything else is behind the disclosure. */
        const shown = showAll
          ? params
          : params.filter((p) => owns.has(p.id) || values[p.id] !== undefined);
        if (shown.length === 0) return null;
        return (
          <Box key={section || 'general'}>
            {section && showAll && (
              <Typography
                sx={{
                  fontSize: 9.5,
                  color: theme.aa.color.text.muted,
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                  mb: 0.4,
                }}
              >
                {section}
              </Typography>
            )}
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              {shown.map((param) => (
                <Control
                  key={param.id}
                  param={param}
                  value={values[param.id]}
                  owned={owns.has(param.id)}
                  ownedValue={ownedValues[param.id] ?? ''}
                  onChange={(next) => onChange(param.id, next)}
                />
              ))}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
