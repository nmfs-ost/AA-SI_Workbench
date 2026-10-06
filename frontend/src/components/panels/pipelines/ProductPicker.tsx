import { useEffect, useState } from 'react';
import { Autocomplete, Box, TextField, Typography, useTheme } from '@mui/material';

import { pipelinesApi, type NearbyProduct, type ParamValue, type ToolParam } from '../../../services/pipelinesApi';
import { compactFieldSx } from '../panelStyles';
import { kindLabel } from './chain';

/**
 * The value of an option that takes a product (aa-sv --ecs, aa-integrate
 * --bottom, aa-mask --remove): chosen from the products of the right kind
 * beside the pipeline's input, or any gs:// URI typed in. A repeatable option
 * takes several. The product's content goes into the hash of what is made.
 */
export function ProductPicker({
  param,
  value,
  near,
  onChange,
}: {
  param: ToolParam;
  value: ParamValue | undefined;
  /** The product the pipeline runs on: where to look. */
  near: string;
  onChange: (value: ParamValue | undefined) => void;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const kinds = param.productKinds ?? [];
  const [options, setOptions] = useState<NearbyProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState('');
  const multiple = param.type === 'list' || param.repeat;

  useEffect(() => {
    if (!near.startsWith('gs://')) {
      setOptions([]);
      return;
    }
    let live = true;
    setLoading(true);
    pipelinesApi
      .nearby(near, kinds)
      .then((list) => live && (setOptions(list), setProblem('')))
      .catch((e) => live && setProblem(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [near, kinds.join(',')]);

  const byUri = new Map(options.map((o) => [o.uri, o]));
  const labelOf = (uri: string) => byUri.get(uri)?.name ?? uri;
  const what = kinds.map((k) => kindLabel(k)).join(' or ');
  const placeholder = near ? (loading ? 'Looking beside the input…' : `A ${what} product (gs://…)`) : 'Choose an input first, or type gs://…';

  const renderOption = (props: React.HTMLAttributes<HTMLLIElement> & { key?: string }, uri: string) => {
    const o = byUri.get(uri);
    const { key, ...rest } = props;
    return (
      <Box component="li" key={key} {...rest} sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start !important' }}>
        <Typography sx={{ fontSize: 12 }}>{o?.name ?? uri}</Typography>
        {o && (
          <Typography sx={{ fontSize: 10.5, color: c.text.muted }}>
            {kindLabel(o.kind)}
            {o.updatedAt ? ` · ${o.updatedAt.slice(0, 16).replace('T', ' ')}` : ''}
            {o.productHash ? ` · aa:${o.productHash.slice(0, 8)}` : ''}
          </Typography>
        )}
      </Box>
    );
  };

  const help = problem ? (
    <Typography sx={{ fontSize: 10.5, color: c.status.warning, mt: 0.25 }}>{problem}</Typography>
  ) : near && !loading && options.length === 0 ? (
    <Typography sx={{ fontSize: 10.5, color: c.text.muted, mt: 0.25 }}>
      No {what} beside the input yet; type a gs:// URI.
    </Typography>
  ) : null;

  if (multiple) {
    const list = Array.isArray(value) ? value.map(String) : value ? [String(value)] : [];
    return (
      <>
        <Autocomplete
          multiple
          freeSolo
          size="small"
          options={options.map((o) => o.uri)}
          value={list}
          loading={loading}
          getOptionLabel={labelOf}
          renderOption={renderOption}
          onChange={(_, next) => {
            const items = (next as string[]).map((s) => s.trim()).filter(Boolean);
            onChange(items.length ? items : undefined);
          }}
          renderInput={(params) => (
            <TextField {...params} placeholder={list.length ? '' : placeholder} inputProps={{ ...params.inputProps, 'aria-label': param.label, spellCheck: false }} />
          )}
          sx={{ ...compactFieldSx, mt: 0.4 }}
          ChipProps={{ size: 'small', sx: { fontSize: 11, height: 20 } }}
        />
        {help}
      </>
    );
  }

  const one = value === undefined || value === null ? '' : String(value);
  return (
    <>
      <Autocomplete
        freeSolo
        size="small"
        options={options.map((o) => o.uri)}
        value={one || null}
        loading={loading}
        getOptionLabel={labelOf}
        renderOption={renderOption}
        onChange={(_, next) => onChange(next ? String(next).trim() || undefined : undefined)}
        onInputChange={(_, text, reason) => {
          // A typed URI counts once it looks like one; picking fills it in.
          if (reason === 'input' && text.startsWith('gs://') && text.includes('/', 5)) onChange(text.trim());
          if (reason === 'clear') onChange(undefined);
        }}
        renderInput={(params) => (
          <TextField {...params} placeholder={placeholder} inputProps={{ ...params.inputProps, 'aria-label': param.label, spellCheck: false }} />
        )}
        sx={{ ...compactFieldSx, mt: 0.4 }}
      />
      {help}
    </>
  );
}
