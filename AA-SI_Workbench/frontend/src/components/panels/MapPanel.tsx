import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { MapOutlined } from '@mui/icons-material';
import { Box, Chip, Typography, useTheme } from '@mui/material';

import { useMapTrack } from '../../state/mapTrack';

const W = 400;
const H = 240;
const PAD = 30;

function niceStep(range: number): number {
  const steps = [0.02, 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 20];
  const target = (range || 0.1) / 4;
  return steps.find((s) => s >= target) ?? 20;
}

function fmtLat(v: number): string {
  const a = Math.abs(v);
  const s = a % 1 === 0 ? a.toFixed(0) : a.toFixed(a < 10 ? 2 : 1);
  return `${s}°${v >= 0 ? 'N' : 'S'}`;
}

function fmtLon(v: number): string {
  const a = Math.abs(v);
  const s = a % 1 === 0 ? a.toFixed(0) : a.toFixed(a < 100 ? 2 : 1);
  return `${s}°${v >= 0 ? 'E' : 'W'}`;
}

/**
 * GPS panel — plots the positions of the files currently in view in NCEI as dots
 * on a simple projected map (a track line joins them chronologically, and the
 * identified file is highlighted). Coordinates come from the shared map-track
 * store; today they are mock positions attached to each file, and the same store
 * is the seam for real GPS once the backend extracts it from the raw/NetCDF.
 */
export const MapPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const { points, activeName, label } = useMapTrack();

  const accent = theme.aa.color.accent.main;
  const grid = theme.aa.color.border.subtle;
  const axis = theme.aa.color.border.strong;

  let map: React.ReactNode = null;

  if (points.length > 0) {
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    for (const p of points) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    const latSpan = Math.max(maxLat - minLat, 0.05);
    const lonSpan = Math.max(maxLon - minLon, 0.05);
    minLat -= latSpan * 0.18;
    maxLat += latSpan * 0.18;
    minLon -= lonSpan * 0.18;
    maxLon += lonSpan * 0.18;

    const midLat = (minLat + maxLat) / 2;
    const cosLat = Math.max(Math.cos((midLat * Math.PI) / 180), 0.2);
    const px = (lon: number) => lon * cosLat;
    const pxMin = px(minLon);
    const pxMax = px(maxLon);
    const dataW = Math.max(pxMax - pxMin, 1e-6);
    const dataH = Math.max(maxLat - minLat, 1e-6);
    const scale = Math.min((W - 2 * PAD) / dataW, (H - 2 * PAD) / dataH);
    const drawW = dataW * scale;
    const drawH = dataH * scale;
    const offX = (W - drawW) / 2;
    const offY = (H - drawH) / 2;
    const sx = (lon: number) => offX + (px(lon) - pxMin) * scale;
    const sy = (lat: number) => offY + (maxLat - lat) * scale;

    const latStep = niceStep(maxLat - minLat);
    const lonStep = niceStep(maxLon - minLon);
    const latTicks: number[] = [];
    for (let a = Math.ceil(minLat / latStep) * latStep; a <= maxLat; a += latStep) {
      latTicks.push(Number(a.toFixed(6)));
    }
    const lonTicks: number[] = [];
    for (let o = Math.ceil(minLon / lonStep) * lonStep; o <= maxLon; o += lonStep) {
      lonTicks.push(Number(o.toFixed(6)));
    }

    const ordered = [...points].sort((a, b) => a.name.localeCompare(b.name));
    const poly = ordered.map((p) => `${sx(p.lon).toFixed(1)},${sy(p.lat).toFixed(1)}`).join(' ');
    const active = points.find((p) => p.name === activeName) ?? null;
    const labelRight = active ? sx(active.lon) < W - 96 : false;

    map = (
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" width="100%" height="100%" style={{ display: 'block' }}>
        {/* ocean */}
        <rect x={0} y={0} width={W} height={H} fill={theme.aa.color.bg.base} />
        <rect x={offX} y={offY} width={drawW} height={drawH} fill={accent} opacity={0.05} />
        <rect x={offX} y={offY} width={drawW} height={drawH} fill="none" stroke={axis} strokeWidth={0.8} />

        {/* graticule */}
        {latTicks.map((a) => (
          <g key={`lat${a}`}>
            <line x1={offX} y1={sy(a)} x2={offX + drawW} y2={sy(a)} stroke={grid} strokeWidth={0.4} />
            <text x={offX + 3} y={sy(a) - 2} fontSize={6} fill={theme.aa.color.text.muted}>{fmtLat(a)}</text>
          </g>
        ))}
        {lonTicks.map((o) => (
          <g key={`lon${o}`}>
            <line x1={sx(o)} y1={offY} x2={sx(o)} y2={offY + drawH} stroke={grid} strokeWidth={0.4} />
            <text x={sx(o)} y={offY + drawH - 3} fontSize={6} textAnchor="middle" fill={theme.aa.color.text.muted}>{fmtLon(o)}</text>
          </g>
        ))}

        {/* track */}
        {ordered.length > 1 && (
          <polyline points={poly} fill="none" stroke={accent} strokeWidth={0.9} opacity={0.5} />
        )}

        {/* dots for every file in view */}
        {points.map((p) => (
          <circle key={p.name} cx={sx(p.lon)} cy={sy(p.lat)} r={2.2} fill={accent} fillOpacity={0.55} />
        ))}

        {/* highlighted (identified) file */}
        {active && (
          <g>
            <circle cx={sx(active.lon)} cy={sy(active.lat)} r={6} fill="none" stroke={accent} strokeWidth={1} opacity={0.5} />
            <circle cx={sx(active.lon)} cy={sy(active.lat)} r={3.4} fill={accent} stroke={theme.aa.color.bg.base} strokeWidth={1} />
            <text
              x={labelRight ? sx(active.lon) + 7 : sx(active.lon) - 7}
              y={sy(active.lat) + 2.5}
              fontSize={7}
              textAnchor={labelRight ? 'start' : 'end'}
              fill={theme.aa.color.text.primary}
              style={{ fontFamily: theme.aa.font.mono }}
            >
              {active.name}
            </text>
          </g>
        )}

        {/* north arrow */}
        <g transform={`translate(${W - 16}, 16)`}>
          <line x1={0} y1={6} x2={0} y2={-6} stroke={theme.aa.color.text.muted} strokeWidth={0.8} />
          <path d="M0,-8 L2.4,-4 L-2.4,-4 Z" fill={theme.aa.color.text.muted} />
          <text x={0} y={13} fontSize={5.5} textAnchor="middle" fill={theme.aa.color.text.muted}>N</text>
        </g>
      </svg>
    );
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', backgroundColor: theme.aa.color.bg.panel }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          minHeight: 28,
          borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
          color: theme.aa.color.text.secondary,
        }}
      >
        <MapOutlined sx={{ fontSize: 15 }} />
        <Typography sx={{ fontSize: 12, fontWeight: 600 }}>GPS track</Typography>
        {label && (
          <Chip
            label={label}
            size="small"
            sx={{ height: 18, fontSize: 10.5, backgroundColor: theme.aa.color.bg.elevated, color: theme.aa.color.text.secondary, maxWidth: 260 }}
          />
        )}
        {points.length > 0 && (
          <Typography sx={{ fontSize: 11, color: theme.aa.color.text.muted, ml: 'auto' }}>
            {points.length} position{points.length === 1 ? '' : 's'}
          </Typography>
        )}
      </Box>

      <Box sx={{ flex: 1, position: 'relative', minHeight: 0, p: 1 }}>
        {map}
        {points.length === 0 && (
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 0.5,
              textAlign: 'center',
              px: 3,
              pointerEvents: 'none',
            }}
          >
            <MapOutlined sx={{ fontSize: 26, color: theme.aa.color.text.muted, opacity: 0.7 }} />
            <Typography sx={{ fontSize: 12.5, color: theme.aa.color.text.muted, maxWidth: 340, lineHeight: 1.5 }}>
              {label
                ? `No positions available for ${label}.`
                : 'Drill down to a sonar in the NCEI panel to plot file positions on the map.'}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
};
