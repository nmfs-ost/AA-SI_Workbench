import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Box, IconButton, Tooltip, Typography, useTheme } from '@mui/material';
import { OpenInFullRounded } from '@mui/icons-material';

import { TrackCanvas } from './TrackCanvas';
import { TrackMapDialog } from './TrackMapDialog';
import { formatDistance, formatDuration, formatSpeed, trackContext, trackStats } from './geo';
import { formatDateTime } from './tiles';

export { scaleBar } from './geo';

/**
 * Where the open echogram was collected: the ship's track on a map (land,
 * grid, scale), the stretch on screen marked, the ping under the pointer
 * shown; the ship and survey, when, how far and how fast underneath; and a
 * larger map (zoom, pan, the whole world) a click away. Drawn from the pings'
 * own positions (aa-location, or the EchoData's track). The map is drawn here,
 * from outlines the Workbench serves: nothing is fetched from outside.
 */
export function TrackMap({
  latitude,
  longitude,
  times,
  x0,
  x1,
  cursorPing,
  onPick,
  uri,
  productName = '',
  channels = [],
  colormap = 'viridis',
  height = 170,
}: {
  latitude: Float64Array;
  longitude: Float64Array;
  times?: Float64Array;
  x0: number;
  x1: number;
  cursorPing: number | null;
  /** A click on the track: the ping nearest it. */
  onPick?: (ping: number) => void;
  /** The product, for its ship and survey. */
  uri: string;
  productName?: string;
  /** The echogram's channels ("38 kHz" …), for the larger map's notes. */
  channels?: string[];
  /** The colormap the track is coloured by time in (the larger map). */
  colormap?: string;
  height?: number;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const [open, setOpen] = useState(false);
  const stats = useMemo(() => trackStats(latitude, longitude, times), [latitude, longitude, times]);
  const context = trackContext(uri, productName);

  if (!stats) {
    return (
      <Typography sx={{ fontSize: 11, color: c.text.muted, px: 1, py: 1 }}>
        No positions in this product. Add them with aa-location (the NASC pipeline does), and the
        track shows here.
      </Typography>
    );
  }
  const start = times?.[stats.first];
  const end = times?.[stats.last];

  return (
    <Box>
      <Box
        sx={{
          position: 'relative',
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
          cursorPing={cursorPing}
          onPick={onPick}
          height={height}
        />
        <Tooltip title="A larger map: zoom, pan, the whole world">
          <IconButton
            size="small"
            onClick={() => setOpen(true)}
            aria-label="Open the track map"
            sx={{
              position: 'absolute',
              right: 4,
              bottom: 4,
              p: 0.4,
              backgroundColor: c.bg.elevated,
              border: `1px solid ${c.border.subtle}`,
              '&:hover': { backgroundColor: c.bg.hover },
            }}
          >
            <OpenInFullRounded sx={{ fontSize: 13 }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', columnGap: 1, rowGap: 0.25, mt: 0.75 }}>
        {(context.vessel || context.survey) && (
          <Fact label="Ship">
            {[context.vessel, context.survey].filter(Boolean).join(' · ')}
          </Fact>
        )}
        {Number.isFinite(start) && (
          <Fact label="When" title={`${formatDateTime(start!)} → ${formatDateTime(end!)}`}>
            {formatDateTime(start!).slice(0, 16)} · {formatDuration(stats.durationMs)}
          </Fact>
        )}
        <Fact label="Sailed">
          {formatDistance(stats.metres)}
          {Number.isFinite(stats.speed) ? ` · ${formatSpeed(stats.speed)}` : ''}
        </Fact>
      </Box>
      <TrackMapDialog
        open={open}
        onClose={() => setOpen(false)}
        latitude={latitude}
        longitude={longitude}
        times={times}
        x0={x0}
        x1={x1}
        onPick={onPick}
        context={context}
        channels={channels}
        colormap={colormap}
      />
    </Box>
  );
}

function Fact({ label, title, children }: { label: string; title?: string; children: ReactNode }) {
  const theme = useTheme();
  const c = theme.aa.color;
  return (
    <>
      <Typography sx={{ fontSize: 10.5, color: c.text.muted }}>{label}</Typography>
      <Typography
        title={title}
        sx={{ fontSize: 11, color: c.text.secondary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
      >
        {children}
      </Typography>
    </>
  );
}
