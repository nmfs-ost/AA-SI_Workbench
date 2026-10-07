import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  IconButton,
  Switch,
  Typography,
  useTheme,
} from '@mui/material';
import { CloseRounded, MapOutlined } from '@mui/icons-material';

import { cssGradient } from './colormaps';
import { TrackCanvas } from './TrackCanvas';
import {
  formatDistance,
  formatDuration,
  formatLat,
  formatLon,
  formatSpeed,
  trackStats,
  type TrackContext,
} from './geo';
import { formatDateTime } from './tiles';

/**
 * The track map, large: zoom and pan from the whole world down to the ship's
 * wake, the track coloured by time (in the theme's colormap) or with the
 * stretch on screen marked, and everything known about where the data were
 * collected beside it.
 */
export function TrackMapDialog({
  open,
  onClose,
  latitude,
  longitude,
  times,
  x0,
  x1,
  onPick,
  context,
  channels,
  colormap,
}: {
  open: boolean;
  onClose: () => void;
  latitude: Float64Array;
  longitude: Float64Array;
  times?: Float64Array;
  x0: number;
  x1: number;
  onPick?: (ping: number) => void;
  context: TrackContext;
  channels: string[];
  colormap: string;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const [byTime, setByTime] = useState(true);
  const [hover, setHover] = useState<number | null>(null);
  const stats = useMemo(() => trackStats(latitude, longitude, times), [latitude, longitude, times]);
  if (!stats) return null;
  const at = (i: number) => ({
    time: times?.[i],
    lat: latitude[i],
    lon: longitude[i],
  });
  const first = at(stats.first);
  const last = at(stats.last);
  const shown = [Math.max(0, Math.floor(x0)), Math.min(latitude.length - 1, Math.ceil(x1))];
  const shownMetres =
    Number.isFinite(stats.along[shown[1]]) && Number.isFinite(stats.along[shown[0]])
      ? stats.along[shown[1]] - stats.along[shown[0]]
      : NaN;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="lg" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.25 }}>
        <MapOutlined sx={{ fontSize: 20, color: c.accent.main }} />
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 15, fontWeight: 600 }} noWrap>
            {[context.vessel, context.survey].filter(Boolean).join(' · ') || 'Ship’s track'}
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: c.text.muted }} noWrap>
            {context.product}
          </Typography>
        </Box>
        <IconButton onClick={onClose} aria-label="Close" size="small">
          <CloseRounded sx={{ fontSize: 18 }} />
        </IconButton>
      </DialogTitle>
      <DialogContent sx={{ display: 'flex', gap: 2, pb: 2, minHeight: 0 }}>
        <Box
          sx={{
            flex: 1,
            minWidth: 0,
            height: 'min(62vh, 620px)',
            borderRadius: `${theme.aa.radius.md}px`,
            border: `1px solid ${c.border.subtle}`,
            overflow: 'hidden',
          }}
        >
          <TrackCanvas
            latitude={latitude}
            longitude={longitude}
            times={times}
            x0={x0}
            x1={x1}
            cursorPing={hover}
            onHover={setHover}
            onPick={onPick}
            interactive
            inset
            colorBy={byTime ? 'time' : 'view'}
            colormap={colormap}
          />
        </Box>
        <Box sx={{ width: 270, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 1.5, overflowY: 'auto' }}>
          <Section title="Collected">
            {context.vessel && <Row label="Ship">{context.vessel}</Row>}
            {context.survey && <Row label="Survey">{context.survey}</Row>}
            {channels.length > 0 && <Row label="Channels">{channels.join(', ')}</Row>}
            <Row label="Pings">
              {stats.fixes.toLocaleString()} with a position{stats.fixes < latitude.length ? ` of ${latitude.length.toLocaleString()}` : ''}
            </Row>
          </Section>
          <Section title="Track">
            <Row label="Start">
              {Number.isFinite(first.time) ? formatDateTime(first.time!) : '—'}
              <Mono>
                {formatLat(first.lat)} {formatLon(first.lon)}
              </Mono>
            </Row>
            <Row label="End">
              {Number.isFinite(last.time) ? formatDateTime(last.time!) : '—'}
              <Mono>
                {formatLat(last.lat)} {formatLon(last.lon)}
              </Mono>
            </Row>
            <Row label="Duration">{formatDuration(stats.durationMs)}</Row>
            <Row label="Sailed">{formatDistance(stats.metres)}</Row>
            <Row label="Mean speed">{formatSpeed(stats.speed)}</Row>
            <Row label="Extent">
              <Mono>
                {formatLat(stats.lat0)} – {formatLat(stats.lat1)}
              </Mono>
              <Mono>
                {formatLon(stats.lon0)} – {formatLon(stats.lon1)}
              </Mono>
            </Row>
          </Section>
          <Section title="On screen in the echogram">
            <Row label="Pings">
              {shown[0].toLocaleString()} – {shown[1].toLocaleString()}
            </Row>
            <Row label="Sailed">{formatDistance(shownMetres)}</Row>
          </Section>
          <Section title="Under the pointer">
            {hover === null ? (
              <Typography sx={{ fontSize: 11, color: c.text.muted }}>Point at the track.</Typography>
            ) : (
              <>
                <Row label="Ping">{hover.toLocaleString()}</Row>
                {times && <Row label="Time">{formatDateTime(times[hover])}</Row>}
                <Row label="Position">
                  <Mono>
                    {formatLat(latitude[hover])} {formatLon(longitude[hover])}
                  </Mono>
                </Row>
                <Row label="Along">{formatDistance(stats.along[hover])}</Row>
              </>
            )}
          </Section>
          <Box>
            <FormControlLabel
              control={<Switch size="small" checked={byTime} onChange={(e) => setByTime(e.target.checked)} />}
              label={<Typography sx={{ fontSize: 12 }}>Colour the track by time</Typography>}
            />
            {byTime && (
              <Box sx={{ pl: 1 }}>
                <Box sx={{ height: 8, borderRadius: 1, background: cssGradient(colormap) }} />
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.25 }}>
                  <Typography sx={{ fontSize: 10, color: c.text.muted }}>start</Typography>
                  <Typography sx={{ fontSize: 10, color: c.text.muted }}>{colormap}</Typography>
                  <Typography sx={{ fontSize: 10, color: c.text.muted }}>end</Typography>
                </Box>
                <Typography sx={{ fontSize: 10.5, color: c.text.muted, mt: 0.5 }}>
                  The dashed line is the stretch on screen in the echogram.
                </Typography>
              </Box>
            )}
          </Box>
          <Typography sx={{ fontSize: 10.5, color: c.text.muted, lineHeight: 1.5 }}>
            Wheel or the buttons to zoom, drag to pan, click the track to show that ping in the echogram.
          </Typography>
          <Box sx={{ mt: 'auto' }}>
            <Button size="small" onClick={onClose} sx={{ textTransform: 'none' }}>
              Close
            </Button>
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <Box>
      <Typography
        sx={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: theme.aa.color.text.muted,
          mb: 0.5,
        }}
      >
        {title}
      </Typography>
      <Box sx={{ display: 'grid', gridTemplateColumns: '78px minmax(0, 1fr)', rowGap: 0.4, columnGap: 1 }}>{children}</Box>
    </Box>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  const theme = useTheme();
  return (
    <>
      <Typography sx={{ fontSize: 11, color: theme.aa.color.text.muted }}>{label}</Typography>
      <Box sx={{ fontSize: 11.5, color: theme.aa.color.text.primary, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {children}
      </Box>
    </>
  );
}

function Mono({ children }: { children: ReactNode }) {
  const theme = useTheme();
  return (
    <Box component="span" sx={{ fontFamily: theme.aa.font.mono, fontSize: 10.5, color: theme.aa.color.text.secondary }}>
      {children}
    </Box>
  );
}
