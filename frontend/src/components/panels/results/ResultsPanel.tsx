import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import {
  Box,
  CircularProgress,
  IconButton,
  MenuItem,
  Select,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import { ContentCopyOutlined, TableChartOutlined } from '@mui/icons-material';

import { tablesApi, type ProductTable } from '../../../services/echoviewApi';
import { PanelBar, PanelHeader } from '../PanelHeader';

/**
 * Integration results (aa-integrate's CSV, Echoview's columns): NASC along the
 * track for one channel, as bars, and every row of the table, sortable. The
 * CSV itself stays in the bucket, beside the Sv it was made from.
 */

let current = '';
const listeners = new Set<() => void>();

export function openResults(uri: string): void {
  current = uri;
  listeners.forEach((l) => l());
}

function useCurrent(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}

const NUMERIC = /^-?\d+(\.\d+)?(e[-+]?\d+)?$/i;

export const ResultsPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const c = theme.aa.color;
  const uri = useCurrent();
  const [table, setTable] = useState<ProductTable | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [freq, setFreq] = useState('');
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);

  /* What is loaded, as uri|frequency: the server's choice of frequency for a
     new file is adopted without asking for the same rows again. */
  const loaded = useRef('');
  const shownUri = useRef('');
  if (shownUri.current !== uri) {
    shownUri.current = uri;
    if (freq) setFreq('');
    if (sort) setSort(null);
  }

  useEffect(() => {
    if (!uri || loaded.current === `${uri}|${freq}`) return;
    let live = true;
    setLoading(true);
    setError('');
    tablesApi
      .table(uri, freq)
      .then((t) => {
        if (!live) return;
        loaded.current = `${uri}|${t.frequency}`;
        setTable(t);
        if (t.detail) setError(t.detail);
        if (t.frequency !== freq) setFreq(t.frequency);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [uri, freq]);

  const cols = table?.columns ?? [];
  const col = (name: string) => cols.indexOf(name);
  const freqs = table?.frequencies ?? [];

  const rows = useMemo(() => {
    if (!table) return [];
    let out = table.rows;
    if (sort) {
      out = [...out].sort((a, b) => {
        const x = a[sort.col];
        const y = b[sort.col];
        const cmp = NUMERIC.test(x) && NUMERIC.test(y) ? Number(x) - Number(y) : x.localeCompare(y);
        return cmp * sort.dir;
      });
    }
    return out;
  }, [table, sort]);

  /* NASC along the track: per interval, summed over its layers (the server
     sums every row of the frequency, not only the rows shown). */
  const bars = table?.perInterval ?? [];
  const maxBar = Math.max(1e-12, ...bars.map(([, v]) => v));
  const mean = bars.length ? bars.reduce((a, [, v]) => a + v, 0) / bars.length : 0;

  const shownCols = cols.filter((name) => !HIDDEN.has(name));

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, backgroundColor: c.bg.panel }}>
      <PanelHeader
        icon={<TableChartOutlined className="panel-header-icon" />}
        title="Results"
        subtitle={<span title={uri}>{uri ? uri.split('/').pop() : 'Open an integration CSV (a run’s result, or Products ⋮)'}</span>}
        actions={
          uri ? (
            <Tooltip title="Copy gs:// URI">
              <IconButton size="small" onClick={() => void navigator.clipboard?.writeText(uri)}>
                <ContentCopyOutlined sx={{ fontSize: 14 }} />
              </IconButton>
            </Tooltip>
          ) : undefined
        }
      />
      {table && table.columns.length > 0 && (
        <PanelBar sx={{ gap: 1.5 }}>
          {freqs.length > 0 && (
            <Select
              size="small"
              variant="standard"
              disableUnderline
              value={freq}
              onChange={(e) => setFreq(String(e.target.value))}
              inputProps={{ 'aria-label': 'Channel' }}
              sx={{ fontSize: 12 }}
            >
              {freqs.map((f) => (
                <MenuItem key={f} value={f} dense sx={{ fontSize: 12 }}>
                  {f} kHz
                </MenuItem>
              ))}
            </Select>
          )}
          <Typography sx={{ fontSize: 11.5, color: c.text.secondary }}>
            {table.total.toLocaleString()} rows
            {table.truncated ? ` (the first ${table.rows.length.toLocaleString()} shown)` : ''}
          </Typography>
          {bars.length > 0 && (
            <Typography sx={{ fontSize: 11.5, color: c.text.secondary }}>
              Mean {table.nascColumn === 'PRC_NASC' ? 'region NASC (PRC)' : 'NASC'} per interval{' '}
              <Box component="span" sx={{ color: c.text.primary, fontWeight: 600 }}>
                {mean.toFixed(1)}
              </Box>{' '}
              m² nmi⁻²
            </Typography>
          )}
        </PanelBar>
      )}

      {loading && (
        <Box sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center' }}>
          <CircularProgress size={14} />
          <Typography sx={{ fontSize: 12, color: c.text.secondary }}>Reading the table…</Typography>
        </Box>
      )}
      {error && <Typography sx={{ p: 1.5, fontSize: 12, color: c.status.warning }}>{error}</Typography>}
      {!uri && (
        <Typography sx={{ p: 2, fontSize: 12, color: c.text.muted, lineHeight: 1.6, maxWidth: 560 }}>
          Integration results show here: run the Integrate (Echoview) pipeline on an Sv, then choose
          “Open results” on its product. Each row is a cell (interval × layer), a region, or a
          region-cell intersection, with Echoview’s columns.
        </Typography>
      )}

      {bars.length > 1 && (
        <Box sx={{ px: 1.25, pt: 1, flexShrink: 0 }}>
          <Typography sx={{ fontSize: 10.5, color: c.text.muted, mb: 0.5 }}>
            {table?.nascColumn === 'PRC_NASC' ? 'Region NASC (PRC_NASC)' : 'NASC'} per interval (all layers), {freq} kHz
          </Typography>
          <svg width="100%" height="70" viewBox={`0 0 ${bars.length * 10} 70`} preserveAspectRatio="none" role="img" aria-label="NASC per interval">
            {bars.map(([k, v], i) => (
              <rect
                key={k}
                x={i * 10 + 1}
                width={8}
                y={70 - (v / maxBar) * 66}
                height={(v / maxBar) * 66}
                fill={alpha(c.accent.main, 0.75)}
              >
                <title>{`Interval ${k}: ${v.toFixed(2)}`}</title>
              </rect>
            ))}
          </svg>
        </Box>
      )}

      {table && shownCols.length > 0 && (
        <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', mt: 0.5 }}>
          <Box component="table" sx={{ borderCollapse: 'collapse', fontSize: 11, minWidth: '100%' }}>
            <Box component="thead">
              <Box component="tr">
                {shownCols.map((name) => {
                  const i = col(name);
                  const on = sort?.col === i;
                  return (
                    <Box
                      component="th"
                      key={name}
                      onClick={() => setSort(on && sort ? (sort.dir === 1 ? { col: i, dir: -1 } : null) : { col: i, dir: 1 })}
                      sx={{
                        position: 'sticky',
                        top: 0,
                        backgroundColor: c.bg.elevated,
                        color: on ? c.accent.main : c.text.secondary,
                        textAlign: 'right',
                        fontWeight: 600,
                        px: 1,
                        py: 0.5,
                        whiteSpace: 'nowrap',
                        cursor: 'pointer',
                        borderBottom: `1px solid ${c.border.subtle}`,
                      }}
                    >
                      {name}
                      {on ? (sort.dir === 1 ? ' ▲' : ' ▼') : ''}
                    </Box>
                  );
                })}
              </Box>
            </Box>
            <Box component="tbody">
              {rows.slice(0, 3000).map((r, n) => (
                <Box component="tr" key={n} sx={{ '&:hover': { backgroundColor: c.bg.hover } }}>
                  {shownCols.map((name) => {
                    const v = r[col(name)] ?? '';
                    return (
                      <Box
                        component="td"
                        key={name}
                        sx={{
                          textAlign: 'right',
                          px: 1,
                          py: 0.25,
                          whiteSpace: 'nowrap',
                          color: name === 'NASC' || name === 'Sv_mean' ? c.text.primary : c.text.secondary,
                          fontVariantNumeric: 'tabular-nums',
                          borderBottom: `1px solid ${alpha(c.border.subtle, 0.5)}`,
                        }}
                      >
                        {format(name, v)}
                      </Box>
                    );
                  })}
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      )}
    </Box>
  );
};

const HIDDEN = new Set([
  'Channel',
  'Minimum_Sv_threshold_applied',
  'Maximum_Sv_threshold_applied',
  'Maximum_integration_threshold',
  'Date_S',
  'Date_E',
  'VL_start',
  'VL_end',
]);

function format(name: string, v: string): string {
  if (!NUMERIC.test(v)) return v;
  const n = Number(v);
  if (/^(Interval|Layer|Region_ID|Samples|Good_samples|No_data_samples|Num_pings|Ping_[SE])$/.test(name)) return String(n);
  if (/^(Lat|Lon)_/.test(name)) return n.toFixed(5);
  if (name === 'ABC' || name === 'PRC_ABC') return n === 0 ? '0' : n.toExponential(3);
  return Math.abs(n) >= 1000 ? n.toFixed(1) : Math.abs(n) >= 1 ? n.toFixed(3) : n === 0 ? '0' : n.toPrecision(4);
}
