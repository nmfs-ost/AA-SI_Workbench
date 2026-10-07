import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, IconButton, Tooltip, useTheme } from '@mui/material';
import { AddRounded, CenterFocusStrongOutlined, PublicOutlined, RemoveRounded } from '@mui/icons-material';

import { levelFor, loadLand, type LandLevel, type Ring } from './basemap';
import { lut } from './colormaps';
import {
  bearing,
  clampScale,
  fitView,
  fromPx,
  gridLabel,
  gridStep,
  scaleBar,
  toPx,
  trackStats,
  unwrap,
  type MapView,
} from './geo';

/**
 * The ship's track on a map: land (Natural Earth, from the Workbench itself),
 * a latitude/longitude grid, the whole track, the stretch the echogram shows,
 * the ping under the pointer, where it started and ended, and a scale. Drawn
 * on a canvas, so the 1:10m coastline pans freely.
 *
 * `interactive`: wheel to zoom, drag to pan, buttons to fit the track or see
 * the whole world. Otherwise the map fits the track and a click picks a ping.
 */
export function TrackCanvas({
  latitude,
  longitude,
  times,
  x0,
  x1,
  cursorPing,
  onPick,
  onHover,
  height,
  interactive = false,
  colorBy = 'view',
  colormap = 'viridis',
  inset = false,
}: {
  latitude: Float64Array;
  longitude: Float64Array;
  times?: Float64Array;
  x0: number;
  x1: number;
  cursorPing: number | null;
  onPick?: (ping: number) => void;
  /** The ping nearest the pointer (null: none near). */
  onHover?: (ping: number | null) => void;
  /** Pixels; omitted: the height of the box it is in. */
  height?: number;
  interactive?: boolean;
  /** Colour the track by time (the colormap), or mark the stretch on screen. */
  colorBy?: 'view' | 'time';
  colormap?: string;
  /** A small world map in the corner, with where this is. */
  inset?: boolean;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const host = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: height ?? 0 });
  const lon = useMemo(() => unwrap(longitude), [longitude]);
  const stats = useMemo(() => trackStats(latitude, longitude, times), [latitude, longitude, times]);
  const fitted = useMemo(() => {
    if (!stats || !size.w || !size.h) return null;
    // With the world inset in the bottom corner, the track fits above it.
    const below = inset ? 100 : 0;
    const v = fitView(stats.lat0, stats.lat1, stats.lon0, stats.lon1, size.w, size.h - below, interactive ? 60 : 24);
    return { ...v, lat: v.lat - below / 2 / v.scale };
  }, [stats, size.w, size.h, interactive, inset]);
  const [userView, setUserView] = useState<MapView | null>(null);
  const view = (interactive && userView) || fitted;
  const [land, setLand] = useState<{ level: LandLevel; rings: Ring[] } | null>(null);
  const [world, setWorld] = useState<Ring[] | null>(null);
  const drag = useRef<{ x: number; y: number; view: MapView; moved: boolean } | null>(null);

  // A new track: back to fitting it.
  useEffect(() => setUserView(null), [latitude, longitude]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      setSize({ w: Math.floor(el.clientWidth), h: Math.floor(height ?? el.clientHeight) });
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [height]);

  // The outline for this scale; the coarser one stays until it arrives.
  const level = view && size.h ? levelFor(size.h / view.scale) : null;
  useEffect(() => {
    if (!level || land?.level === level) return;
    let live = true;
    loadLand(level)
      .then((rings) => live && setLand({ level, rings }))
      .catch(() => {
        /* no basemap: the track still draws, on the grid */
      });
    return () => {
      live = false;
    };
  }, [level, land?.level]);
  useEffect(() => {
    if (!inset || world) return;
    loadLand('110m').then(setWorld).catch(() => undefined);
  }, [inset, world]);

  const draw = useCallback(() => {
    const el = canvas.current;
    if (!el || !view || !size.w || !size.h) return;
    const dpr = window.devicePixelRatio || 1;
    const { w, h } = size;
    if (el.width !== Math.round(w * dpr) || el.height !== Math.round(h * dpr)) {
      el.width = Math.round(w * dpr);
      el.height = Math.round(h * dpr);
    }
    const g = el.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    g.fillStyle = c.bg.editor;
    g.fillRect(0, 0, w, h);
    const px = (o: number, a: number) => toPx(view, w, h, o, a);
    const [lonA, latA] = fromPx(view, w, h, 0, h);
    const [lonB, latB] = fromPx(view, w, h, w, 0);

    // Land.
    if (land) {
      g.beginPath();
      for (const ring of land.rings) {
        for (const shift of [-360, 0, 360]) {
          if (ring.lon1 + shift < lonA || ring.lon0 + shift > lonB || ring.lat1 < latA || ring.lat0 > latB) continue;
          const p = ring.pts;
          let [lx, ly] = px(p[0] + shift, p[1]);
          g.moveTo(lx, ly);
          for (let i = 2; i < p.length; i += 2) {
            const [x, y] = px(p[i] + shift, p[i + 1]);
            if (Math.abs(x - lx) + Math.abs(y - ly) < 0.7 && i < p.length - 2) continue;
            g.lineTo(x, y);
            lx = x;
            ly = y;
          }
          g.closePath();
        }
      }
      g.fillStyle = mix(c.text.muted, c.bg.editor, 0.24);
      g.fill('evenodd');
      g.strokeStyle = mix(c.text.muted, c.bg.editor, 0.6);
      g.lineWidth = 0.8;
      g.stroke();
    }

    // Grid.
    const step = gridStep(view.scale, w < 300 ? 70 : 110);
    g.strokeStyle = mix(c.text.muted, c.bg.editor, 0.22);
    g.lineWidth = 1;
    g.font = `9.5px ${theme.aa.font.ui}`;
    g.fillStyle = c.text.muted;
    g.textBaseline = 'middle';
    for (let a = Math.ceil(latA / step) * step; a <= latB; a += step) {
      const [, y] = px(view.lon, a);
      g.beginPath();
      g.moveTo(0, Math.round(y) + 0.5);
      g.lineTo(w, Math.round(y) + 0.5);
      g.stroke();
      if (y > 14 && y < h - 22) g.fillText(gridLabel(a, step, 'lat'), 4, y - 6);
    }
    // Meridians converge: their step is chosen at this latitude's scale.
    const lonStep = gridStep(view.scale * Math.max(0.2, Math.cos((view.lat * Math.PI) / 180)), w < 300 ? 70 : 110);
    g.textBaseline = 'alphabetic';
    let labelEnd = -Infinity;
    for (let o = Math.ceil(lonA / lonStep) * lonStep; o <= lonB; o += lonStep) {
      const [x] = px(o, view.lat);
      g.beginPath();
      g.moveTo(Math.round(x) + 0.5, 0);
      g.lineTo(Math.round(x) + 0.5, h);
      g.stroke();
      // A label only where it does not run into the last one or the N.
      const text = gridLabel(o, lonStep, 'lon');
      const wide = g.measureText(text).width;
      if (x + 3 > labelEnd + 6 && x + 3 + wide < w - 30) {
        g.fillText(text, x + 3, 11);
        labelEnd = x + 3 + wide;
      }
    }

    // The track.
    const n = Math.min(latitude.length, lon.length);
    const stride = Math.max(1, Math.floor(n / 5000));
    const trace = (from: number, to: number) => {
      g.beginPath();
      let pen = false;
      for (let i = Math.max(0, from); i < Math.min(n, to); i += stride) {
        const a = latitude[i];
        const o = lon[i];
        if (!Number.isFinite(a) || !Number.isFinite(o)) {
          pen = false;
          continue;
        }
        const [x, y] = px(o, a);
        if (pen) g.lineTo(x, y);
        else g.moveTo(x, y);
        pen = true;
      }
      g.stroke();
    };
    g.lineJoin = 'round';
    g.lineCap = 'round';
    if (colorBy === 'time') {
      const table = lut(colormap);
      const pieces = 64;
      const span = Math.ceil(n / pieces);
      g.lineWidth = 2.6;
      for (let k = 0; k < pieces; k++) {
        const t = Math.round(((k + 0.5) / pieces) * 255) * 4;
        g.strokeStyle = `rgb(${table[t]},${table[t + 1]},${table[t + 2]})`;
        trace(k * span, (k + 1) * span + stride);
      }
      // The stretch on screen in the echogram, when it is not all of it.
      if (x1 - x0 < n * 0.98) {
        g.strokeStyle = c.text.primary;
        g.lineWidth = 1;
        g.setLineDash([3, 3]);
        trace(Math.floor(x0), Math.ceil(x1) + stride);
        g.setLineDash([]);
      }
    } else {
      g.strokeStyle = c.text.disabled;
      g.lineWidth = 1.4;
      trace(0, n);
      g.strokeStyle = c.accent.main;
      g.lineWidth = 3;
      trace(Math.floor(x0), Math.ceil(x1) + stride);
    }

    // Start, end, and the ship's heading at the end.
    if (stats) {
      const [sx, sy] = px(lon[stats.first], latitude[stats.first]);
      const [ex, ey] = px(lon[stats.last], latitude[stats.last]);
      g.lineWidth = 1.6;
      g.strokeStyle = c.text.primary;
      g.fillStyle = c.bg.editor;
      g.beginPath();
      g.arc(sx, sy, 4, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      const back = Math.max(stats.first, stats.last - Math.max(1, Math.floor(n / 200)));
      const heading = bearing(latitude[back], lon[back], latitude[stats.last], lon[stats.last]);
      ship(g, ex, ey, heading, c.text.primary, c.bg.editor);
    }

    // The ping under the pointer.
    if (cursorPing !== null) {
      const i = Math.max(0, Math.min(n - 1, Math.round(cursorPing)));
      if (Number.isFinite(latitude[i]) && Number.isFinite(lon[i])) {
        const [x, y] = px(lon[i], latitude[i]);
        g.strokeStyle = '#ffffff';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(x, y, 6, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(x, y, 2, 0, Math.PI * 2);
        g.fill();
      }
    }

    // Scale and north.
    const bar = scaleBar(110_540 / view.scale, Math.min(140, w * 0.32));
    g.fillStyle = c.text.secondary;
    g.fillRect(8, h - 12, bar.px, 3);
    g.font = `10px ${theme.aa.font.ui}`;
    g.fillText(bar.label, 12 + bar.px, h - 8);
    g.textAlign = 'right';
    g.fillText('N ↑', w - 8, 13);
    if (interactive) {
      g.fillStyle = c.text.disabled;
      g.font = `9px ${theme.aa.font.ui}`;
      g.fillText('Land: Natural Earth', w - 8, h - 6);
    }
    g.textAlign = 'left';

    // Where in the world.
    if (inset && world && lonB - lonA < 90) {
      const iw = 132;
      const ih = 70;
      const ix = 8;
      const iy = h - ih - 24;
      g.save();
      g.fillStyle = c.bg.panel;
      g.strokeStyle = c.border.strong;
      g.lineWidth = 1;
      g.fillRect(ix, iy, iw, ih);
      g.strokeRect(ix + 0.5, iy + 0.5, iw - 1, ih - 1);
      g.beginPath();
      g.rect(ix, iy, iw, ih);
      g.clip();
      const wp = (o: number, a: number): [number, number] => [ix + ((o + 180) / 360) * iw, iy + ((80 - a) / 140) * ih];
      g.beginPath();
      for (const ring of world) {
        const p = ring.pts;
        let [lx, ly] = wp(p[0], p[1]);
        g.moveTo(lx, ly);
        for (let i = 2; i < p.length; i += 2) {
          const [x, y] = wp(p[i], p[i + 1]);
          if (Math.abs(x - lx) + Math.abs(y - ly) < 0.6) continue;
          g.lineTo(x, y);
          lx = x;
          ly = y;
        }
        g.closePath();
      }
      g.fillStyle = mix(c.text.muted, c.bg.panel, 0.35);
      g.fill('evenodd');
      const centre = ((((view.lon + 180) % 360) + 360) % 360) - 180;
      const [cx, cy] = wp(centre, view.lat);
      const [qx0] = wp(centre - (lonB - lonA) / 2, 0);
      const [qx1] = wp(centre + (lonB - lonA) / 2, 0);
      const [, qy0] = wp(0, latB);
      const [, qy1] = wp(0, latA);
      g.strokeStyle = c.accent.main;
      g.lineWidth = 1.2;
      if (qx1 - qx0 > 6 && qx1 - qx0 < iw * 0.8) g.strokeRect(qx0, qy0, qx1 - qx0, qy1 - qy0);
      g.fillStyle = c.accent.main;
      g.beginPath();
      g.arc(cx, cy, 2.6, 0, Math.PI * 2);
      g.fill();
      g.restore();
    }
  }, [view, size, land, world, latitude, lon, x0, x1, cursorPing, colorBy, colormap, inset, interactive, stats, c, theme]);

  useEffect(() => {
    const frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [draw]);

  const nearest = (mx: number, my: number, within: number): number | null => {
    if (!view) return null;
    const n = Math.min(latitude.length, lon.length);
    const stride = Math.max(1, Math.floor(n / 6000));
    let best = -1;
    let dist = within * within;
    for (let i = 0; i < n; i += stride) {
      if (!Number.isFinite(latitude[i]) || !Number.isFinite(lon[i])) continue;
      const [x, y] = toPx(view, size.w, size.h, lon[i], latitude[i]);
      const d = (x - mx) ** 2 + (y - my) ** 2;
      if (d < dist) {
        dist = d;
        best = i;
      }
    }
    return best >= 0 ? best : null;
  };

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  const zoom = (factor: number, mx = size.w / 2, my = size.h / 2) => {
    if (!view) return;
    const [lo, la] = fromPx(view, size.w, size.h, mx, my);
    const scale = clampScale(view.scale * factor, size.h);
    const next = { ...view, scale };
    // Keep the point under the pointer where it is.
    const [nx, ny] = toPx(next, size.w, size.h, lo, la);
    const [clon, clat] = fromPx(next, size.w, size.h, size.w / 2 + (nx - mx), size.h / 2 + (ny - my));
    setUserView({ lon: clon, lat: Math.max(-85, Math.min(85, clat)), scale });
  };

  useEffect(() => {
    const el = canvas.current;
    if (!el || !interactive) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [mx, my] = local(e);
      zoom(Math.pow(1.0015, -e.deltaY), mx, my);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  });

  if (!stats) return null;

  return (
    <Box ref={host} sx={{ position: 'relative', width: '100%', height: height ?? '100%', minHeight: 0 }}>
      <canvas
        ref={canvas}
        role="img"
        aria-label="Ship's track on a map"
        style={{
          width: '100%',
          height: '100%',
          display: 'block',
          cursor: interactive ? (drag.current?.moved ? 'grabbing' : 'grab') : onPick ? 'pointer' : 'default',
        }}
        onPointerDown={(e) => {
          if (!view) return;
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          drag.current = { x: e.clientX, y: e.clientY, view, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (d && interactive) {
            const dx = e.clientX - d.x;
            const dy = e.clientY - d.y;
            if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
            if (d.moved) {
              const k = Math.max(0.05, Math.cos((d.view.lat * Math.PI) / 180));
              setUserView({
                ...d.view,
                lon: d.view.lon - dx / (k * d.view.scale),
                lat: Math.max(-85, Math.min(85, d.view.lat + dy / d.view.scale)),
              });
            }
            return;
          }
          if (onHover) {
            const [mx, my] = local(e);
            onHover(nearest(mx, my, 14));
          }
        }}
        onPointerUp={(e) => {
          const d = drag.current;
          drag.current = null;
          if (d?.moved || !onPick) return;
          const [mx, my] = local(e);
          const ping = nearest(mx, my, interactive ? 14 : 40);
          if (ping !== null) onPick(ping);
        }}
        onPointerLeave={() => onHover?.(null)}
        onDoubleClick={(e) => {
          if (!interactive) return;
          const [mx, my] = local(e);
          zoom(2, mx, my);
        }}
      />
      {interactive && (
        <Box
          sx={{
            position: 'absolute',
            top: 22,
            right: 8,
            display: 'flex',
            flexDirection: 'column',
            borderRadius: `${theme.aa.radius.md}px`,
            border: `1px solid ${c.border.subtle}`,
            backgroundColor: c.bg.elevated,
            '& .MuiIconButton-root': { borderRadius: 0, p: 0.5 },
          }}
        >
          <Tooltip title="Zoom in" placement="left">
            <IconButton size="small" onClick={() => zoom(2)} aria-label="Zoom in">
              <AddRounded sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Zoom out" placement="left">
            <IconButton size="small" onClick={() => zoom(0.5)} aria-label="Zoom out">
              <RemoveRounded sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="Fit the track" placement="left">
            <IconButton size="small" onClick={() => setUserView(null)} aria-label="Fit the track">
              <CenterFocusStrongOutlined sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
          <Tooltip title="The whole world" placement="left">
            <IconButton
              size="small"
              onClick={() => view && setUserView({ lon: view.lon, lat: 15, scale: clampScale(0, size.h) })}
              aria-label="The whole world"
            >
              <PublicOutlined sx={{ fontSize: 16 }} />
            </IconButton>
          </Tooltip>
        </Box>
      )}
    </Box>
  );
}

/** The ship: a small arrowhead pointing where it was heading. */
function ship(g: CanvasRenderingContext2D, x: number, y: number, heading: number, fill: string, edge: string): void {
  g.save();
  g.translate(x, y);
  g.rotate((heading * Math.PI) / 180);
  g.beginPath();
  g.moveTo(0, -7);
  g.lineTo(5, 5);
  g.lineTo(0, 2.5);
  g.lineTo(-5, 5);
  g.closePath();
  g.fillStyle = fill;
  g.strokeStyle = edge;
  g.lineWidth = 1.2;
  g.fill();
  g.stroke();
  g.restore();
}

/** `a` over `b` at `amount` (hex colours), for map fills that sit in any theme. */
export function mix(a: string, b: string, amount: number): string {
  const p = (hex: string) => {
    const v = hex.replace('#', '');
    return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
  };
  if (!/^#[0-9a-f]{6}$/i.test(a) || !/^#[0-9a-f]{6}$/i.test(b)) return a;
  const [x, y] = [p(a), p(b)];
  return `rgb(${x.map((v, i) => Math.round(v * amount + y[i] * (1 - amount))).join(',')})`;
}
