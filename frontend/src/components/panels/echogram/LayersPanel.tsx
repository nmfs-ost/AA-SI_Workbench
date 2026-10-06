import { useMemo, useState } from 'react';
import {
  Autocomplete,
  Box,
  Button,
  CircularProgress,
  IconButton,
  MenuItem,
  TextField,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  AddOutlined,
  CloudDownloadOutlined,
  DeleteOutline,
  RadioButtonChecked,
  RadioButtonUnchecked,
  SaveOutlined,
  UndoOutlined,
  VisibilityOffOutlined,
  VisibilityOutlined,
} from '@mui/icons-material';

import {
  deleteRegion,
  isDirty,
  newLayer,
  removeLayer,
  renameLayer,
  revertLayer,
  saveLayer,
  setActiveLayer,
  setLayerVisible,
  setLinePoints,
  setTool,
  showAnnotation,
  updateRegion,
  useEchogram,
  type Layer,
} from '../../../state/echogram';
import { compactFieldSx, compactPopupSx } from '../panelStyles';
import { HashTag } from '../products/ProductBits';
import { formatRelativeTime } from '../rowFormat';
import { REGION_KINDS, lineColor, offsetLine, regionColor } from './shapes';

/**
 * Lines and regions on the open echogram: what is drawn, which one the tools
 * draw on, what is unsaved, and the selected region's class and type. Saving
 * writes an Echoview file beside the product (aa-annotate); each save is a new
 * product with its own hash, so a NASC made with last week's bottom line is
 * never confused with one made with today's.
 */
export function LayersPanel() {
  const theme = useTheme();
  const c = theme.aa.color;
  const s = useEchogram();
  const [offset, setOffset] = useState('');

  const shown = new Set(s.layers.map((l) => l.key));
  const notShown = s.available.filter((a) => !shown.has(a.uri));
  const classes = useMemo(
    () =>
      [...new Set(s.layers.flatMap((l) => l.regions.map((r) => r.class)).filter(Boolean))].sort(),
    [s.layers],
  );
  const selectedLayer = s.layers.find((l) => l.key === s.selected?.layer);
  const region = selectedLayer?.regions.find((r) => r.id === s.selected?.region);
  const active = s.layers.find((l) => l.key === s.activeLayer);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, p: 1, minHeight: 0 }}>
      <SectionTitle
        title="Lines and regions"
        actions={
          <>
            <Tooltip title="New line (draw it with the line tool)">
              <Button
                size="small"
                startIcon={<AddOutlined sx={{ fontSize: 14 }} />}
                onClick={() => {
                  newLayer('line', s.layers.some((l) => l.label === 'bottom') ? 'line' : 'bottom');
                  setTool('line');
                }}
                sx={smallButton}
              >
                Line
              </Button>
            </Tooltip>
            <Tooltip title="New region layer (draw with the rectangle or polygon tool)">
              <Button
                size="small"
                startIcon={<AddOutlined sx={{ fontSize: 14 }} />}
                onClick={() => {
                  newLayer('regions', 'regions');
                  setTool('region');
                }}
                sx={smallButton}
              >
                Regions
              </Button>
            </Tooltip>
          </>
        }
      />

      {s.layers.length === 0 && (
        <Typography sx={{ fontSize: 11, color: c.text.muted, lineHeight: 1.5 }}>
          None yet. Draw a line (a bottom, a surface exclusion line) with the line tool, or regions
          with the rectangle and polygon tools. They are saved as Echoview .evl and .evr files that
          aa-evl, aa-evr and aa-integrate read.
        </Typography>
      )}

      {s.layers.map((layer) => (
        <LayerRow key={layer.key} layer={layer} active={layer.key === s.activeLayer} />
      ))}

      {active?.type === 'line' && active.points.length > 0 && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <TextField
            size="small"
            label="Shift line (m)"
            value={offset}
            onChange={(e) => setOffset(e.target.value)}
            placeholder="-0.5"
            InputLabelProps={{ shrink: true }}
            sx={{ ...compactFieldSx, width: 110 }}
          />
          <Button
            size="small"
            disabled={!Number.isFinite(Number(offset)) || offset.trim() === ''}
            onClick={() => {
              setLinePoints(active.key, offsetLine(active.points, Number(offset)));
              setOffset('');
            }}
            sx={smallButton}
          >
            Apply
          </Button>
          <Typography sx={{ fontSize: 10.5, color: c.text.muted, lineHeight: 1.3 }}>
            Negative: shallower.
          </Typography>
        </Box>
      )}

      {region && selectedLayer && (
        <Box
          sx={{
            border: `1px solid ${alpha(regionColor(region), 0.5)}`,
            borderRadius: `${theme.aa.radius.md}px`,
            p: 1,
            display: 'flex',
            flexDirection: 'column',
            gap: 1,
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: c.text.primary, flex: 1 }}>
              Region {region.id}
            </Typography>
            <Tooltip title="Delete this region (Delete key)">
              <IconButton size="small" onClick={() => deleteRegion(selectedLayer.key, region.id)}>
                <DeleteOutline sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          </Box>
          <TextField
            size="small"
            label="Name"
            value={region.name}
            onChange={(e) => updateRegion(selectedLayer.key, region.id, { name: e.target.value.slice(0, 60) })}
            InputLabelProps={{ shrink: true }}
            sx={compactFieldSx}
          />
          <Autocomplete
            freeSolo
            size="small"
            options={classes}
            value={region.class}
            onInputChange={(_, value) => updateRegion(selectedLayer.key, region.id, { class: value.slice(0, 40) })}
            slotProps={{ paper: { sx: compactPopupSx } }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Class"
                placeholder="Hake, krill, plankton…"
                InputLabelProps={{ shrink: true }}
                sx={compactFieldSx}
              />
            )}
          />
          <TextField
            select
            size="small"
            label="Type"
            value={region.kind}
            onChange={(e) =>
              updateRegion(selectedLayer.key, region.id, { kind: e.target.value as typeof region.kind })
            }
            InputLabelProps={{ shrink: true }}
            sx={compactFieldSx}
            helperText={REGION_KINDS.find((k) => k.id === region.kind)?.help}
            FormHelperTextProps={{ sx: { fontSize: 10.5, mx: 0 } }}
          >
            {REGION_KINDS.map((k) => (
              <MenuItem key={k.id} value={k.id} dense sx={{ fontSize: 12 }}>
                {k.label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            size="small"
            label="Notes"
            multiline
            minRows={1}
            value={(region.notes ?? []).join('\n')}
            onChange={(e) =>
              updateRegion(selectedLayer.key, region.id, { notes: e.target.value.split('\n').slice(0, 20) })
            }
            InputLabelProps={{ shrink: true }}
            sx={compactFieldSx}
          />
        </Box>
      )}

      {notShown.length > 0 && (
        <>
          <SectionTitle title="In the bucket" />
          {notShown.map((a) => (
            <Box
              key={a.uri}
              onClick={() => void showAnnotation(a)}
              title={a.uri}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.75,
                px: 0.5,
                minHeight: 26,
                borderRadius: `${theme.aa.radius.sm}px`,
                cursor: 'pointer',
                '&:hover': { backgroundColor: c.bg.hover },
              }}
            >
              <CloudDownloadOutlined sx={{ fontSize: 14, color: c.text.muted }} />
              <Typography sx={{ fontSize: 11.5, color: c.text.primary, flex: 1, minWidth: 0 }} noWrap>
                {a.label}
                <Box component="span" sx={{ color: c.text.muted, ml: 0.75 }}>
                  {a.kind === 'seafloor' ? 'detected bottom' : a.kind === 'lines' ? 'line' : 'regions'}
                  {!a.latest && ' · older'}
                </Box>
              </Typography>
              <Typography sx={{ fontSize: 10, color: c.text.muted, flexShrink: 0 }}>
                {formatRelativeTime(a.createdAt)}
              </Typography>
            </Box>
          ))}
        </>
      )}
      {s.availableError && (
        <Typography sx={{ fontSize: 11, color: c.status.warning }}>{s.availableError}</Typography>
      )}
    </Box>
  );
}

function LayerRow({ layer, active }: { layer: Layer; active: boolean }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const dirty = isDirty(layer);
  const color =
    layer.type === 'line'
      ? lineColor(layer.label, layer.detected)
      : regionColor({ kind: 'analysis', class: layer.regions[0]?.class ?? '' });
  const count =
    layer.type === 'line'
      ? `${layer.points.length.toLocaleString()} points`
      : `${layer.regions.length} region${layer.regions.length === 1 ? '' : 's'}`;
  return (
    <Box
      sx={{
        border: `1px solid ${active ? alpha(c.accent.main, 0.6) : c.border.subtle}`,
        backgroundColor: active ? alpha(c.accent.main, 0.06) : 'transparent',
        borderRadius: `${theme.aa.radius.md}px`,
        px: 0.75,
        py: 0.5,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Tooltip title={active ? 'The tools draw on this one' : 'Draw on this one'}>
          <IconButton size="small" onClick={() => setActiveLayer(layer.key)} sx={{ p: 0.25 }}>
            {active ? (
              <RadioButtonChecked sx={{ fontSize: 14, color: c.accent.main }} />
            ) : (
              <RadioButtonUnchecked sx={{ fontSize: 14, color: c.text.muted }} />
            )}
          </IconButton>
        </Tooltip>
        <Box sx={{ width: 10, height: 3, borderRadius: 2, backgroundColor: color, flexShrink: 0 }} />
        <Box
          component="input"
          value={layer.label}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => renameLayer(layer.key, e.target.value)}
          aria-label="Name"
          sx={{
            flex: 1,
            minWidth: 0,
            border: 'none',
            outline: 'none',
            background: 'transparent',
            color: c.text.primary,
            font: 'inherit',
            fontSize: 12,
            fontWeight: 600,
            p: 0,
            '&:focus': { boxShadow: `inset 0 -1px 0 ${c.accent.main}` },
          }}
        />
        {layer.loading || layer.saving ? (
          <CircularProgress size={12} />
        ) : (
          dirty && (
            <Tooltip title={layer.detected ? 'Detected bottom: save it as a line file to use it' : 'Not saved'}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: c.status.warning }} />
            </Tooltip>
          )
        )}
        <Tooltip title={layer.visible ? 'Hide' : 'Show'}>
          <IconButton size="small" onClick={() => setLayerVisible(layer.key, !layer.visible)} sx={{ p: 0.25 }}>
            {layer.visible ? (
              <VisibilityOutlined sx={{ fontSize: 14 }} />
            ) : (
              <VisibilityOffOutlined sx={{ fontSize: 14 }} />
            )}
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, pl: 3.25, minHeight: 22 }}>
        <Typography sx={{ fontSize: 10.5, color: c.text.muted, flex: 1, minWidth: 0 }} noWrap>
          {layer.type === 'line' ? 'Line' : 'Regions'} · {count}
          {layer.detected ? ' · detected' : ''}
        </Typography>
        {layer.source?.productHash && !dirty && <HashTag hash={layer.source.productHash} quiet />}
        {dirty && !layer.detected && layer.source && (
          <Tooltip title="Back to the saved version">
            <IconButton size="small" onClick={() => revertLayer(layer.key)} sx={{ p: 0.25 }}>
              <UndoOutlined sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
        {dirty && !layer.thinned && (
          <Tooltip title="Save to the bucket as an Echoview file">
            <span>
              <IconButton
                size="small"
                disabled={layer.saving || (layer.type === 'line' ? layer.points.length < 2 : layer.regions.length === 0)}
                onClick={() => void saveLayer(layer.key)}
                sx={{ p: 0.25, color: c.accent.main }}
              >
                <SaveOutlined sx={{ fontSize: 15 }} />
              </IconButton>
            </span>
          </Tooltip>
        )}
        <Tooltip title={dirty && !layer.detected ? 'Remove (unsaved changes are lost)' : 'Remove from the echogram'}>
          <IconButton size="small" onClick={() => removeLayer(layer.key)} sx={{ p: 0.25 }}>
            <DeleteOutline sx={{ fontSize: 14 }} />
          </IconButton>
        </Tooltip>
      </Box>
      {layer.thinned > 0 && (
        <Typography sx={{ fontSize: 10.5, color: c.text.muted, pl: 3.25, lineHeight: 1.4 }}>
          {layer.thinned.toLocaleString()} points: shown thinned, so it cannot be edited here.
        </Typography>
      )}
      {layer.error && (
        <Typography sx={{ fontSize: 10.5, color: c.status.error, pl: 3.25, whiteSpace: 'pre-wrap' }}>
          {layer.error}
        </Typography>
      )}
    </Box>
  );
}

export function SectionTitle({ title, actions }: { title: string; actions?: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minHeight: 24 }}>
      <Typography
        sx={{
          fontSize: 10.5,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: theme.aa.color.text.muted,
          flex: 1,
        }}
      >
        {title}
      </Typography>
      {actions}
    </Box>
  );
}

const smallButton = { fontSize: 11, textTransform: 'none', minWidth: 0, px: 0.75, py: 0.1 } as const;
