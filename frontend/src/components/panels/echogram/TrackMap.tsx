import { useMemo } from 'react';
import { Box, Typography, useTheme } from '@mui/material';


/**
 * The ship's track for the open echogram: the whole track faint, the stretch
 * on screen bright, the ping under the cursor marked. Drawn from the pings'
 * own positions (aa-location, or the EchoData's track), on a local
 * equal-distance projection, with a scale bar. No map tiles: nothing is
 * fetched from outside the workstation.
 */
export function TrackMap({
  latitude,
  longitude,
  x0,
  x1,
  cursorPing,
  onPick,
  height = 150,
}: {
  latitude: Float64Array;
  longitude: Float64Array;
  x0: number;
  x1: number;
  cursorPing: number | null;
  /** A click on the track: the ping nearest it. */
  onPick?: (ping: number) => void;
  height?: number;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const width = 240;
  const geo = useMemo(() => project(latitude, longitude, width, height), [latitude, longitude, height]);

  if (!geo) {
    return (
      <Typography sx={{ fontSize: 11, color: c.text.muted, px: 1, py: 1 }}>
        No positions in this product. Add them with aa-location (the NASC pipeline does), and the
        track shows here.
      </Typography>
    );
  }
  const step = Math.max(1, Math.floor(latitude.length / 1500));
  const path = (from: number, to: number) => {
    let d = '';
    for (let i = Math.max(0, from); i < Math.min(latitude.length, to); i += step) {
      const p = geo.at(i);
      if (!p) continue;
      d += `${d ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }
    return d;
  };
  const visible = path(Math.floor(x0), Math.ceil(x1) + step);
  const cur = cursorPing !== null ? geo.at(Math.round(cursorPing)) : null;
  const start = geo.at(0);
  const scale = scaleBar(geo.metresPerPx, width * 0.35);

  return (
    <Box sx={{ position: 'relative' }}>
      <svg
        width="100%"
        viewBox={`0 0 ${width} ${height}`}
        style={{ display: 'block', cursor: onPick ? 'pointer' : 'default' }}
        role="img"
        aria-label="Ship's track"
        onClick={(e) => {
          if (!onPick) return;
          const rect = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const px = ((e.clientX - rect.left) / rect.width) * width;
          const py = ((e.clientY - rect.top) / rect.height) * height;
          onPick(geo.nearest(px, py));
        }}
      >
        <rect x={0} y={0} width={width} height={height} fill={c.bg.editor} />
        <path d={path(0, latitude.length)} fill="none" stroke={c.text.disabled} strokeWidth={1.2} />
        <path d={visible} fill="none" stroke={c.accent.main} strokeWidth={2.4} strokeLinecap="round" />
        {start && <circle cx={start.x} cy={start.y} r={2.5} fill={c.text.secondary} />}
        {cur && (
          <g>
            <circle cx={cur.x} cy={cur.y} r={5} fill="none" stroke="#ffffff" strokeWidth={1.4} />
            <circle cx={cur.x} cy={cur.y} r={1.8} fill="#ffffff" />
          </g>
        )}
        <g transform={`translate(8, ${height - 10})`}>
          <rect x={0} y={-3} width={scale.px} height={3} fill={c.text.secondary} />
          <text x={scale.px + 5} y={0} fontSize={9.5} fill={c.text.secondary} fontFamily={theme.aa.font.ui}>
            {scale.label}
          </text>
        </g>
        <text x={width - 6} y={12} fontSize={9.5} textAnchor="end" fill={c.text.muted} fontFamily={theme.aa.font.ui}>
          N ↑
        </text>
      </svg>
    </Box>
  );
}

/** Lat/lon to an equal-distance local plane fitted into width x height. */
export function project(lat: Float64Array, lon: Float64Array, width: number, height: number) {
  const n = Math.min(lat.length, lon.length);
  let la0 = Infinity;
  let la1 = -Infinity;
  let lo0 = Infinity;
  let lo1 = -Infinity;
  let count = 0;
  for (let i = 0; i < n; i++) {
    const a = lat[i];
    const o = lon[i];
    if (!Number.isFinite(a) || !Number.isFinite(o) || Math.abs(a) > 90) continue;
    la0 = Math.min(la0, a);
    la1 = Math.max(la1, a);
    lo0 = Math.min(lo0, o);
    lo1 = Math.max(lo1, o);
    count++;
  }
  if (count < 2) return null;
  const midLat = (la0 + la1) / 2;
  const kx = Math.cos((midLat * Math.PI) / 180) * 111_320;
  const ky = 110_540;
  const spanX = Math.max((lo1 - lo0) * kx, 50);
  const spanY = Math.max((la1 - la0) * ky, 50);
  const pad = 14;
  const s = Math.min((width - 2 * pad) / spanX, (height - 2 * pad - 10) / spanY);
  const ox = pad + (width - 2 * pad - spanX * s) / 2;
  const oy = pad + (height - 2 * pad - 10 - spanY * s) / 2;
  const at = (i: number) => {
    if (i < 0 || i >= n) return null;
    const a = lat[i];
    const o = lon[i];
    if (!Number.isFinite(a) || !Number.isFinite(o)) return null;
    return { x: ox + (o - lo0) * kx * s, y: oy + (la1 - a) * ky * s };
  };
  const nearest = (px: number, py: number) => {
    let best = 0;
    let dist = Infinity;
    const step = Math.max(1, Math.floor(n / 4000));
    for (let i = 0; i < n; i += step) {
      const p = at(i);
      if (!p) continue;
      const d = (p.x - px) ** 2 + (p.y - py) ** 2;
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    return best;
  };
  return { at, nearest, metresPerPx: 1 / s };
}

/** A round length (m, km or nmi) about `maxPx` long at this scale. */
export function scaleBar(metresPerPx: number, maxPx: number): { px: number; label: string } {
  const max = metresPerPx * maxPx;
  const nmiSteps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
  const nmi = [...nmiSteps].reverse().find((v) => v * 1852 <= max);
  if (nmi !== undefined && max >= 185) return { px: (nmi * 1852) / metresPerPx, label: `${nmi} nmi` };
  const mSteps = [10, 20, 50, 100, 200, 500, 1000];
  const m = [...mSteps].reverse().find((v) => v <= max) ?? 10;
  return { px: m / metresPerPx, label: m >= 1000 ? `${m / 1000} km` : `${m} m` };
}

