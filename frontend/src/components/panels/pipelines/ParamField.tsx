import { useEffect, useState } from 'react';
import {
  Box,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import { FingerprintOutlined, RestartAltRounded } from '@mui/icons-material';

import type { ParamValue, ToolParam } from '../../../services/pipelinesApi';
import { compactFieldSx } from '../panelStyles';
import { sameValue } from './chain';
import { ProductPicker } from './ProductPicker';

function show(value: ParamValue | undefined): string {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.join('\n');
  return String(value);
}

/**
 * One setting of one console tool, edited as its type says: a switch, a list
 * of choices, a number, text, or one value per line. The tool's own default
 * shows as the placeholder; a value equal to it is not sent. Settings that
 * change the product (and so its hash) carry a fingerprint.
 */
export function ParamField({
  param,
  value,
  near = '',
  onChange,
}: {
  param: ToolParam;
  /** The chosen value; undefined: the tool's default. */
  value: ParamValue | undefined;
  /** The product the pipeline runs on, for options that take a product. */
  near?: string;
  onChange: (value: ParamValue | undefined) => void;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const changed = value !== undefined && !sameValue(value, param.default);
  const [draft, setDraft] = useState(show(value));
  useEffect(() => setDraft(show(value)), [value]);

  const numeric = param.type === 'number' || param.type === 'integer';
  const bad =
    numeric && draft.trim() !== '' && (Number.isNaN(Number(draft)) || (param.type === 'integer' && !Number.isInteger(Number(draft))));

  const commit = () => {
    const text = draft.trim();
    if (param.type === 'list') {
      const items = draft
        .split('\n')
        .map((t) => t.trim())
        .filter(Boolean);
      onChange(items.length ? items : undefined);
    } else if (numeric) {
      if (bad) return;
      onChange(text === '' ? undefined : Number(text));
    } else {
      onChange(text === '' ? undefined : text);
    }
  };

  const label = (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
      <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: changed ? c.text.primary : c.text.secondary, flexShrink: 0 }}>
        {param.label}
        {param.required && (
          <Box component="span" sx={{ color: c.status.error }}>
            {' '}
            *
          </Box>
        )}
      </Typography>
      {param.science && (
        <Tooltip disableInteractive title="Changes the product, so its hash and the _xxxxxxxx in its name.">
          <FingerprintOutlined sx={{ fontSize: 12, color: c.syntax.entity }} />
        </Tooltip>
      )}
      <Typography sx={{ fontSize: 10.5, color: c.text.muted, flex: 1, minWidth: 0, textAlign: 'right' }} noWrap>
        {param.type === 'bool' ? (param.trueFlag && param.falseFlag ? `${param.trueFlag} / ${param.falseFlag}` : param.trueFlag || param.falseFlag) : param.flag}
      </Typography>
      <Box sx={{ width: 24, flexShrink: 0, display: 'flex', justifyContent: 'flex-end' }}>
        {changed && (
          <Tooltip title="Back to the tool's default">
            <IconButton size="small" onClick={() => onChange(undefined)} sx={{ p: 0.25 }}>
              <RestartAltRounded sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
    </Box>
  );

  const help = param.help ? (
    <Typography sx={{ fontSize: 10.5, color: c.text.muted, lineHeight: 1.45, mt: 0.25 }}>{param.help}</Typography>
  ) : null;

  if (param.type === 'bool') {
    const on = value === undefined ? Boolean(param.default) : Boolean(value);
    return (
      <Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Switch
            size="small"
            checked={on}
            onChange={(e) => onChange(e.target.checked)}
            inputProps={{ 'aria-label': param.label }}
            sx={{ ml: -0.75 }}
          />
          <Box sx={{ flex: 1, minWidth: 0 }}>{label}</Box>
        </Box>
        <Box sx={{ pl: 4.25 }}>{help}</Box>
      </Box>
    );
  }

  if (param.productKinds?.length) {
    return (
      <Box>
        {label}
        <ProductPicker param={param} value={value} near={near} onChange={onChange} />
        {help}
      </Box>
    );
  }

  return (
    <Box>
      {label}
      {param.type === 'choice' ? (
        <TextField
          select
          size="small"
          fullWidth
          value={value === undefined || value === null ? '' : String(value)}
          onChange={(e) => onChange(e.target.value === '' ? undefined : e.target.value)}
          SelectProps={{ displayEmpty: true, inputProps: { 'aria-label': param.label } }}
          sx={{ ...compactFieldSx, mt: 0.4 }}
        >
          <MenuItem value="" dense>
            <Typography sx={{ fontSize: 12, color: c.text.muted }}>
              {param.default === null || param.default === undefined || param.default === ''
                ? 'Not given (the tool decides)'
                : `${String(param.default)} (default)`}
            </Typography>
          </MenuItem>
          {param.choices.map((choice) => (
            <MenuItem key={choice} value={choice} dense sx={{ fontSize: 12 }}>
              {choice}
            </MenuItem>
          ))}
        </TextField>
      ) : (
        <TextField
          size="small"
          fullWidth
          multiline={param.type === 'list'}
          minRows={param.type === 'list' ? 2 : undefined}
          value={draft}
          error={bad}
          placeholder={
            param.type === 'list'
              ? 'One value per line'
              : param.default === null || param.default === undefined || param.default === ''
                ? 'Not given'
                : String(param.default)
          }
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && param.type !== 'list') commit();
          }}
          inputProps={{ spellCheck: false, inputMode: numeric ? 'decimal' : undefined, 'aria-label': param.label }}
          helperText={bad ? (param.type === 'integer' ? 'A whole number.' : 'A number.') : undefined}
          sx={{ ...compactFieldSx, mt: 0.4 }}
        />
      )}
      {help}
    </Box>
  );
}
