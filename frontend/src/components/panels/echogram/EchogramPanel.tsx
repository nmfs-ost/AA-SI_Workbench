import { useEffect, useState } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputBase,
  MenuItem,
  Select,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  CropSquareOutlined,
  FitScreenOutlined,
  NearMeOutlined,
  PanToolOutlined,
  PolylineOutlined,
  RefreshOutlined,
  ShowChartOutlined,
  WavesOutlined,
  ZoomInOutlined,
} from '@mui/icons-material';

import {
  deleteRegion,
  fitAll,
  getEchogram,
  openEchogram,
  reloadPack,
  setColours,
  setTool,
  setView,
  toggleChannel,
  useEchogram,
  type Tool,
} from '../../../state/echogram';
import { PanelBar, PanelHeader } from '../PanelHeader';
import { HashTag } from '../products/ProductBits';
import { LevelChip } from '../prepare/ui';
import { COLORMAPS, cssGradient, resolveColormap, type ColormapId } from './colormaps';
import { colormapOf } from '../../../theme/tokens';
import { useThemeMode } from '../../../state/theme';
import { EchogramView, type Hover } from './EchogramView';
import { LayersPanel, SectionTitle } from './LayersPanel';
import { TrackMap } from './TrackMap';
import { clampView, defaultRange, formatDateTime } from './tiles';

const TOOLS: { id: Tool; label: string; key: string; icon: typeof PanToolOutlined }[] = [
  { id: 'pan', label: 'Pan (P). Wheel zooms; Shift+wheel: time only; Alt+wheel: depth only. Double-click: all.', key: 'p', icon: PanToolOutlined },
  { id: 'zoom', label: 'Zoom to a box (Z). Click: zoom in; Alt+click: out.', key: 'z', icon: ZoomInOutlined },
  { id: 'line', label: 'Line pick (L): draw a line, or draw over a stretch of one to replace it.', key: 'l', icon: ShowChartOutlined },
  { id: 'region', label: 'Rectangle region (R)', key: 'r', icon: CropSquareOutlined },
  { id: 'polygon', label: 'Polygon region (G): click the corners; double-click or Enter to close.', key: 'g', icon: PolylineOutlined },
  { id: 'select', label: 'Select and edit (S): click a region; drag its corners or a line\'s points. Delete removes.', key: 's', icon: NearMeOutlined },
];

/**
 * The Echogram panel: a product as Echoview shows it. Every channel stacked
 * and in step, zoomed from the whole leg down to single samples, coloured
 * with the familiar schemes and thresholds, with the value under the cursor,
 * the ship's track, and the lines and regions drawn on it (saved as Echoview
 * files that the tools read).
 *
 * The data come as tiles from a pack aa-tiles makes the first time a product
 * is opened (beside the product in the bucket); after that, opening it is
 * immediate, for anyone.
 */
export const EchogramPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const c = theme.aa.color;
  const s = useEchogram();
  const themeColormap = colormapOf(useThemeMode());
  const resolved = resolveColormap(s.colormap, themeColormap);
  const [hover, setHover] = useState<Hover | null>(null);
  const [typed, setTyped] = useState('');
  const [side, setSide] = useState(true);

  /* Shortcuts, when the echogram (not a text field) has the keyboard. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!getEchogram().manifest || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"], .xterm')) return;
      const tool = TOOLS.find((t) => t.key === e.key.toLowerCase());
      if (tool) {
        setTool(tool.id);
        return;
      }
      if (e.key.toLowerCase() === 'f') fitAll();
      const sel = getEchogram().selected;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) {
        deleteRegion(sel.layer, sel.region);
        e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const m = s.manifest;
  const making = s.status?.state === 'making' || (!m && !s.error && Boolean(s.uri));
  const unit = m?.nature === 'db' ? 'dB' : m?.unit ?? '';

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, backgroundColor: c.bg.panel }}>
      <PanelHeader
        icon={<WavesOutlined className="panel-header-icon" />}
        title="Echogram"
        subtitle={
          s.uri ? (
            <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }} title={s.uri}>
              <span>{s.uri.split('/').pop()}</span>
              {m?.product?.kind && <LevelChip level={kindLevel(m.product.kind)} />}
              {m?.product?.hash && <HashTag hash={m.product.hash} quiet />}
            </Box>
          ) : (
            'Open a product from Products (⋮ → Open as echogram)'
          )
        }
        actions={
          s.uri ? (
            <>
              <Tooltip title="Remake the tiles (after the product was rewritten)">
                <IconButton size="small" onClick={() => void openEchogram(s.uri, true)}>
                  <RefreshOutlined sx={{ fontSize: 15 }} />
                </IconButton>
              </Tooltip>
              <Button
                size="small"
                onClick={() => setSide((v) => !v)}
                sx={{ fontSize: 11, textTransform: 'none', minWidth: 0, px: 1 }}
              >
                {side ? 'Hide side' : 'Lines & track'}
              </Button>
            </>
          ) : undefined
        }
      />

      {m && s.view && (
        <PanelBar sx={{ gap: 0.5, px: 0.75, overflowX: 'auto', overflowY: 'hidden' }}>
          {TOOLS.map((t) => {
            const Icon = t.icon;
            const on = s.tool === t.id;
            return (
              <Tooltip key={t.id} title={t.label}>
                <IconButton
                  size="small"
                  aria-label={t.label}
                  aria-pressed={on}
                  onClick={() => setTool(t.id)}
                  sx={{
                    borderRadius: `${theme.aa.radius.sm}px`,
                    color: on ? c.accent.main : c.text.secondary,
                    backgroundColor: on ? alpha(c.accent.main, 0.16) : 'transparent',
                    p: 0.5,
                  }}
                >
                  <Icon sx={{ fontSize: 16 }} />
                </IconButton>
              </Tooltip>
            );
          })}
          <Tooltip title="Show all (F)">
            <IconButton size="small" onClick={fitAll} sx={{ p: 0.5 }}>
              <FitScreenOutlined sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Divider />
          {m.channels.map((ch, i) => (
            <Box
              key={ch.id}
              component="button"
              type="button"
              onClick={() => toggleChannel(i)}
              aria-pressed={s.channelsOn[i] !== false}
              title={ch.id}
              sx={{
                border: `1px solid ${s.channelsOn[i] !== false ? alpha(c.accent.main, 0.5) : c.border.subtle}`,
                backgroundColor: s.channelsOn[i] !== false ? alpha(c.accent.main, 0.12) : 'transparent',
                color: s.channelsOn[i] !== false ? c.text.primary : c.text.muted,
                borderRadius: `${theme.aa.radius.sm}px`,
                font: 'inherit',
                fontSize: 11,
                fontWeight: 600,
                height: 22,
                px: 0.75,
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              {ch.label}
            </Box>
          ))}
          <Divider />
          <Select
            size="small"
            value={s.colormap === 'grey' ? 'gray' : s.colormap}
            onChange={(e) => setColours({ colormap: e.target.value as ColormapId })}
            variant="standard"
            disableUnderline
            inputProps={{ 'aria-label': 'Colour scheme' }}
            renderValue={(v) =>
              v === 'theme' ? `Theme (${labelOf(resolved)})` : labelOf(String(v))
            }
            sx={{ fontSize: 11.5, minWidth: 74, flexShrink: 0 }}
          >
            <MenuItem value="theme" dense sx={{ fontSize: 12 }}>
              The theme’s ({labelOf(resolveColormap('theme', themeColormap))})
            </MenuItem>
            {COLORMAPS.map((cm) => (
              <MenuItem key={cm.id} value={cm.id} dense sx={{ fontSize: 12 }}>
                {cm.label}
              </MenuItem>
            ))}
          </Select>
          <Threshold label="Min" value={s.vmin} onChange={(v) => v < s.vmax && setColours({ vmin: v })} />
          <Box
            title={`${s.vmin} to ${s.vmax} ${unit}`}
            sx={{
              width: 90,
              height: 10,
              flexShrink: 0,
              borderRadius: 2,
              border: `1px solid ${c.border.subtle}`,
              background: cssGradient(resolved),
            }}
          />
          <Threshold label="Max" value={s.vmax} onChange={(v) => v > s.vmin && setColours({ vmax: v })} />
          <Typography sx={{ fontSize: 10.5, color: c.text.muted, flexShrink: 0 }}>{unit}</Typography>
          <Tooltip title="Thresholds from the data (2nd and 98th percentile), or Echoview's -70 to -34 dB for Sv">
            <Button
              size="small"
              onClick={() => {
                const [vmin, vmax] = defaultRange(m);
                setColours({ vmin, vmax });
              }}
              sx={{ fontSize: 11, textTransform: 'none', minWidth: 0, px: 0.75, flexShrink: 0 }}
            >
              Auto
            </Button>
          </Tooltip>
          <Tooltip title="Below the minimum: the background (as Echoview), or the weakest colour">
            <Button
              size="small"
              onClick={() => setColours({ belowMin: s.belowMin === 'background' ? 'lowest' : 'background' })}
              sx={{ fontSize: 11, textTransform: 'none', minWidth: 0, px: 0.75, flexShrink: 0, color: c.text.secondary }}
            >
              {s.belowMin === 'background' ? 'Below min: clear' : 'Below min: colour'}
            </Button>
          </Tooltip>
        </PanelBar>
      )}

      <Box sx={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', p: m ? 0.75 : 0 }}>
          {m && s.error && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                mb: 0.75,
                px: 1,
                py: 0.5,
                borderRadius: `${theme.aa.radius.sm}px`,
                backgroundColor: alpha(c.status.warning, 0.12),
              }}
            >
              <Typography sx={{ fontSize: 11.5, color: c.text.primary, flex: 1 }}>{s.error}</Typography>
              <Button size="small" onClick={() => void reloadPack()} sx={{ fontSize: 11, textTransform: 'none' }}>
                Load them
              </Button>
            </Box>
          )}
          {m && s.view ? (
            <EchogramView onHover={setHover} />
          ) : (
            <Empty
              uri={s.uri}
              making={making}
              error={s.error}
              status={s.status?.detail || ''}
              log={s.status?.log ?? []}
              typed={typed}
              setTyped={setTyped}
            />
          )}
        </Box>
        {m && side && (
          <Box
            sx={{
              width: 268,
              flexShrink: 0,
              borderLeft: `1px solid ${c.border.subtle}`,
              display: 'flex',
              flexDirection: 'column',
              minHeight: 0,
              overflowY: 'auto',
            }}
          >
            <Box sx={{ p: 1, pb: 0 }}>
              <SectionTitle title="Track" />
              <TrackMap
                latitude={s.latitude}
                longitude={s.longitude}
                times={s.times}
                uri={s.uri}
                productName={m.product?.name}
                channels={m.channels.map((ch) => ch.label)}
                colormap={resolved === 'ek500' ? themeColormap || 'viridis' : resolved}
                x0={s.view?.x0 ?? 0}
                x1={s.view?.x1 ?? 0}
                cursorPing={hover?.ping ?? null}
                onPick={(ping) => {
                  const st = getEchogram();
                  if (!st.view || !st.bounds) return;
                  const half = (st.view.x1 - st.view.x0) / 2;
                  setView(clampView({ ...st.view, x0: ping - half, x1: ping + half }, st.bounds));
                }}
              />
            </Box>
            <LayersPanel />
          </Box>
        )}
      </Box>

      {m && <Readout hover={hover} unit={unit} />}
    </Box>
  );
};

function labelOf(id: string): string {
  return COLORMAPS.find((cm) => cm.id === id)?.label ?? id;
}

function kindLevel(kind: string): string {
  return { sv: 'L2A', ts: 'L2A', mask: 'L2B', noise: 'L2B', mvbs: 'L3' }[kind] ?? '';
}

function Divider() {
  const theme = useTheme();
  return <Box sx={{ width: '1px', height: 18, mx: 0.5, flexShrink: 0, backgroundColor: theme.aa.color.border.subtle }} />;
}

function Threshold({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  const theme = useTheme();
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  const commit = () => {
    const v = Number(draft);
    if (draft.trim() !== '' && Number.isFinite(v)) onChange(v);
    else setDraft(String(value));
  };
  return (
    <InputBase
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          onChange(value + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 5 : 1));
        }
      }}
      inputProps={{ 'aria-label': `${label}imum display threshold`, inputMode: 'decimal' }}
      sx={{
        width: 46,
        flexShrink: 0,
        fontSize: 11.5,
        fontVariantNumeric: 'tabular-nums',
        border: `1px solid ${theme.aa.color.border.subtle}`,
        borderRadius: `${theme.aa.radius.sm}px`,
        px: 0.5,
        height: 22,
        '& input': { textAlign: 'right', p: 0 },
      }}
    />
  );
}

function Readout({ hover, unit }: { hover: Hover | null; unit: string }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const s = useEchogram();
  const i = hover ? Math.max(0, Math.min(s.latitude.length - 1, hover.ping)) : -1;
  const lat = i >= 0 ? s.latitude[i] : NaN;
  const lon = i >= 0 ? s.longitude[i] : NaN;
  const lv = hover ? hover.channel.levels[hover.level] : null;
  const item = (label: string, value: string, width?: number, key?: string) => (
    <Box key={key} component="span" sx={{ display: 'inline-flex', gap: 0.5, minWidth: width, flexShrink: 0 }}>
      <Box component="span" sx={{ color: c.text.muted }}>
        {label}
      </Box>
      <Box component="span" sx={{ color: c.text.primary, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Box>
    </Box>
  );
  const yLabel = hover?.channel.y.name === 'depth' ? 'Depth' : hover?.channel.y.unit ? 'Range' : 'Sample';
  return (
    <Box
      sx={{
        height: 26,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        gap: 2,
        px: 1.25,
        borderTop: `1px solid ${c.border.subtle}`,
        fontSize: 11,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
      }}
    >
      {hover ? (
        <>
          {item('', hover.channel.label, 52)}
          {item('', formatDateTime(hover.time), 200)}
          {item('Ping', String(hover.ping), 70)}
          {item(yLabel, `${hover.y.toFixed(2)} ${hover.channel.y.unit}`, 92)}
          {item(
            s.manifest?.variable ?? 'Value',
            Number.isFinite(hover.value) ? `${hover.value.toFixed(2)} ${unit}` : 'no data',
            110,
          )}
          {Number.isFinite(lat) && item('', `${lat.toFixed(5)}°, ${lon.toFixed(5)}°`, 150)}
          {hover.lines.map((l, n) => item(l.label, `${l.depth.toFixed(1)} m`, undefined, `${l.label}-${n}`))}
          {hover.regions.length > 0 && item('In', hover.regions.join(', '))}
          <Box sx={{ flex: 1 }} />
          {lv && (
            <Box component="span" sx={{ color: c.text.muted }}>
              {lv.fx === 1 && lv.fy === 1 ? 'every sample' : `${lv.fx} pings × ${lv.fy} samples per cell`}
            </Box>
          )}
        </>
      ) : (
        <Box component="span" sx={{ color: c.text.muted }}>
          {s.manifest
            ? `${s.manifest.x.count.toLocaleString()} pings · ${s.manifest.channels.length} channels · ${s.manifest.longName}`
            : ''}
          {s.store && s.store.pending() > 0 ? ' · loading tiles…' : ''}
        </Box>
      )}
    </Box>
  );
}

function Empty({
  uri,
  making,
  error,
  status,
  log,
  typed,
  setTyped,
}: {
  uri: string;
  making: boolean;
  error: string;
  status: string;
  log: string[];
  typed: string;
  setTyped: (v: string) => void;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  return (
    <Box sx={{ m: 'auto', maxWidth: 520, p: 3, display: 'flex', flexDirection: 'column', gap: 1.25 }}>
      {making ? (
        <>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <CircularProgress size={16} />
            <Typography sx={{ fontSize: 12.5, color: c.text.primary }}>Making the echogram tiles…</Typography>
          </Box>
          <Typography sx={{ fontSize: 11.5, color: c.text.secondary, lineHeight: 1.6 }}>
            The first time a product is opened, aa-tiles reads it once and writes its tile pack beside it
            in the bucket (it is in the Processing Queue). After that it opens at once, for anyone.
          </Typography>
          {log.length > 0 && (
            <Box
              component="pre"
              sx={{ m: 0, fontSize: 10.5, color: c.text.muted, fontFamily: theme.aa.font.mono, whiteSpace: 'pre-wrap' }}
            >
              {log.slice(-4).join('\n')}
            </Box>
          )}
        </>
      ) : error ? (
        <>
          <Typography sx={{ fontSize: 12.5, color: c.status.error, whiteSpace: 'pre-wrap' }}>{error}</Typography>
          {status && status !== error && (
            <Typography sx={{ fontSize: 11.5, color: c.text.secondary }}>{status}</Typography>
          )}
        </>
      ) : (
        <>
          <Typography sx={{ fontSize: 13, color: c.text.primary, fontWeight: 600 }}>No echogram open</Typography>
          <Typography sx={{ fontSize: 11.5, color: c.text.secondary, lineHeight: 1.6 }}>
            In Products, open a product's menu (⋮) and choose <b>Open as echogram</b>: an Sv, an MVBS, a
            mask, or anything a pipeline made from them. Or paste its gs:// URI:
          </Typography>
        </>
      )}
      {!making && (
        <Box
          component="form"
          onSubmit={(e: React.FormEvent) => {
            e.preventDefault();
            if (typed.trim().startsWith('gs://')) void openEchogram(typed.trim());
          }}
          sx={{ display: 'flex', gap: 0.75 }}
        >
          <InputBase
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={uri || "gs://bucket/…/product.nc"}
            inputProps={{ 'aria-label': 'Product to open', spellCheck: false }}
            sx={{
              flex: 1,
              fontSize: 12,
              border: `1px solid ${c.border.subtle}`,
              borderRadius: `${theme.aa.radius.sm}px`,
              px: 1,
              height: 28,
            }}
          />
          <Button type="submit" size="small" variant="outlined" sx={{ fontSize: 11.5, textTransform: 'none' }}>
            Open
          </Button>
        </Box>
      )}
    </Box>
  );
}
