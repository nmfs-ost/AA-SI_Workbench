import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Box, useTheme } from '@mui/material';

import type { LinePoint, PackChannel } from '../../../services/echoviewApi';
import {
  getEchogram,
  newLayer,
  selectRegion,
  setLinePoints,
  setRegions,
  setView,
  fitAll,
  useEchogram,
  type Layer,
} from '../../../state/echogram';
import type { Paint } from './colormaps';
import {
  drawOver,
  lineColor,
  nearPolyline,
  nearestVertex,
  nextRegionId,
  pointInPolygon,
  rectangle,
  regionColor,
  simplify,
} from './shapes';
import {
  cellAt,
  chooseLevel,
  formatTime,
  niceTicks,
  panBy,
  pingAt,
  tileExtent,
  timeAt,
  timeTicks,
  visibleTiles,
  zoomAbout,
  type TileKey,
  type View,
} from './tiles';

/** What is under the cursor, for the readout. */
export interface Hover {
  channel: PackChannel;
  x: number;
  y: number;
  ping: number;
  time: number;
  value: number;
  level: number;
  regions: string[];
  lines: { label: string; depth: number }[];
}

const GUTTER_LEFT = 46;
const AXIS_BOTTOM = 22;
const ROW_GAP = 6;
const LABEL_H = 16;

interface Row {
  channel: PackChannel;
  x: number;
  y: number;
  w: number;
  h: number;
}

type Drag =
  | { kind: 'pan'; start: View; px: number; py: number; row: Row }
  | { kind: 'zoom'; row: Row; px: number; py: number; cx: number; cy: number }
  | { kind: 'stroke'; row: Row; points: { px: number; py: number; t: number; depth: number }[] }
  | { kind: 'rect'; row: Row; a: { t: number; depth: number }; px: number; py: number; cx: number; cy: number }
  | { kind: 'vertex'; row: Row; layer: string; region: number; index: number }
  | { kind: 'linepoint'; row: Row; layer: string; index: number };

/**
 * The echogram itself: one canvas, a row per channel (stacked, sharing the
 * view), the tiles at the level the zoom needs, the lines and regions on top,
 * and the axes. Drawing is the tools' (pan, zoom box, line pick, rectangle and
 * polygon regions, select and edit).
 */
export function EchogramView({ onHover }: { onHover: (hover: Hover | null) => void }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const s = useEchogram();
  const host = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const size = useRef({ w: 0, h: 0, dpr: 1 });
  const frame = useRef(0);
  const drag = useRef<Drag | null>(null);
  const polygon = useRef<{ row: Row; points: { t: number; depth: number }[] } | null>(null);
  const cursor = useRef<{ px: number; py: number } | null>(null);
  const lastHover = useRef<Hover | null>(null);

  const paintSpec: Paint = useMemo(
    () => ({
      colormap: s.colormap,
      vmin: s.vmin,
      vmax: s.vmax,
      belowMin: s.belowMin,
      mask: s.manifest?.nature === 'mask' ? [242, 204, 96] : undefined,
    }),
    [s.colormap, s.vmin, s.vmax, s.belowMin, s.manifest?.nature],
  );

  /* ---------------------------------------------------------------- */
  /* Geometry                                                          */
  /* ---------------------------------------------------------------- */

  const rows = useCallback((): Row[] => {
    const m = getEchogram().manifest;
    if (!m) return [];
    const on = m.channels.filter((_, i) => getEchogram().channelsOn[i] !== false);
    const { w, h } = size.current;
    const plotW = Math.max(10, w - GUTTER_LEFT - 8);
    const plotH = Math.max(10, h - AXIS_BOTTOM);
    const each = (plotH - ROW_GAP * (on.length - 1)) / Math.max(1, on.length);
    return on.map((channel, i) => ({
      channel,
      x: GUTTER_LEFT,
      y: i * (each + ROW_GAP),
      w: plotW,
      h: each,
    }));
  }, []);

  const toPx = (row: Row, view: View, x: number, y: number) => ({
    px: row.x + ((x - view.x0) / (view.x1 - view.x0)) * row.w,
    py: row.y + ((y - view.y0) / (view.y1 - view.y0)) * row.h,
  });
  const toData = (row: Row, view: View, px: number, py: number) => ({
    x: view.x0 + ((px - row.x) / row.w) * (view.x1 - view.x0),
    y: view.y0 + ((py - row.y) / row.h) * (view.y1 - view.y0),
  });
  const rowAt = (px: number, py: number) =>
    rows().find((r) => px >= r.x && px <= r.x + r.w && py >= r.y && py <= r.y + r.h) ?? null;

  /* ---------------------------------------------------------------- */
  /* Drawing                                                           */
  /* ---------------------------------------------------------------- */

  const draw = useCallback(() => {
    frame.current = 0;
    const el = canvas.current;
    const st = getEchogram();
    if (!el || !st.manifest || !st.view || !st.store) return;
    const ctx = el.getContext('2d');
    if (!ctx) return;
    const { w, h, dpr } = size.current;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const view = st.view;
    const tile = st.manifest.tile;
    const all = rows();
    const wanted: TileKey[] = [];

    for (const row of all) {
      const ch = row.channel;
      ctx.save();
      ctx.beginPath();
      ctx.rect(row.x, row.y, row.w, row.h);
      ctx.clip();
      ctx.fillStyle = c.bg.editor;
      ctx.fillRect(row.x, row.y, row.w, row.h);
      ctx.imageSmoothingEnabled = false;
      const level = chooseLevel(ch, view, row.w, row.h);
      wanted.push(...visibleTiles(ch, level, tile, view));
      // Coarser levels already here fill in while the finer tiles arrive.
      for (let lv = ch.levels.length - 1; lv >= level; lv--) {
        for (const key of visibleTiles(ch, lv, tile, view)) {
          const img = st.store.image(key, paintSpec);
          if (!img) continue;
          const ext = tileExtent(ch, lv, tile, key.tx, key.ty);
          const a = toPx(row, view, ext.x0, ext.y0);
          const b = toPx(row, view, ext.x1, ext.y1);
          ctx.drawImage(img as CanvasImageSource, 0, 0, tile, tile, a.px, a.py, b.px - a.px, b.py - a.py);
        }
      }
      drawLayers(ctx, row, view, st.layers, st.selected, st.times);
      drawInProgress(ctx, row, view, st.times);
      ctx.restore();

      // Frame, depth axis, channel label.
      ctx.strokeStyle = c.border.subtle;
      ctx.lineWidth = 1;
      ctx.strokeRect(row.x + 0.5, row.y + 0.5, row.w - 1, row.h - 1);
      ctx.fillStyle = c.text.muted;
      ctx.font = `10px ${theme.aa.font.ui}`;
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      for (const d of niceTicks(view.y0, view.y1, Math.max(2, Math.floor(row.h / 28)))) {
        const { py } = toPx(row, view, 0, d);
        if (py < row.y + 6 || py > row.y + row.h - 4) continue;
        ctx.fillText(`${Number(d.toFixed(1))}`, row.x - 6, py);
        ctx.fillRect(row.x - 3, py, 3, 1);
      }
      ctx.save();
      ctx.font = `600 10.5px ${theme.aa.font.ui}`;
      const label = `${ch.label}  ${st.manifest.variable}`;
      const tw = ctx.measureText(label).width + 12;
      ctx.fillStyle = 'rgba(14,16,20,0.72)';
      ctx.fillRect(row.x + 6, row.y + 6, tw, LABEL_H);
      ctx.fillStyle = '#e6e9ef';
      ctx.textAlign = 'left';
      ctx.fillText(label, row.x + 12, row.y + 6 + LABEL_H / 2 + 0.5);
      ctx.restore();
    }

    // Depth axis title.
    if (all.length) {
      ctx.save();
      ctx.translate(11, all[0].y + (all[all.length - 1].y + all[all.length - 1].h - all[0].y) / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = c.text.muted;
      ctx.textAlign = 'center';
      ctx.font = `10px ${theme.aa.font.ui}`;
      const yname = all[0].channel.y.name === 'depth' ? 'Depth (m)' : all[0].channel.y.unit ? 'Range (m)' : 'Sample';
      ctx.fillText(yname, 0, 0);
      ctx.restore();
    }

    // Time axis.
    const last = all[all.length - 1];
    if (last && st.times.length) {
      const t0 = timeAt(st.times, view.x0);
      const t1 = timeAt(st.times, view.x1);
      const ticks = timeTicks(t0, t1, Math.max(2, Math.floor(last.w / 110)));
      const y = last.y + last.h;
      ctx.fillStyle = c.text.muted;
      ctx.font = `10px ${theme.aa.font.ui}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      const seconds = ticks.length > 1 && ticks[1] - ticks[0] < 60_000;
      for (const t of ticks) {
        const { px } = toPx(last, view, pingAt(st.times, t), 0);
        if (px < last.x + 10 || px > last.x + last.w - 10) continue;
        ctx.fillRect(px, y, 1, 4);
        ctx.fillText(formatTime(t, seconds), px, y + 6);
      }
    }

    // Cursor.
    const cur = cursor.current;
    if (cur && all.length) {
      const hit = rowAt(cur.px, cur.py);
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      if (cur.px >= GUTTER_LEFT) {
        for (const r of all) {
          ctx.moveTo(cur.px + 0.5, r.y);
          ctx.lineTo(cur.px + 0.5, r.y + r.h);
        }
      }
      if (hit) {
        ctx.moveTo(hit.x, cur.py + 0.5);
        ctx.lineTo(hit.x + hit.w, cur.py + 0.5);
      }
      ctx.stroke();
      ctx.setLineDash([]);
    }

    st.store.want(wanted);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paintSpec, c, theme.aa.font.ui, rows]);

  function drawLayers(
    ctx: CanvasRenderingContext2D,
    row: Row,
    view: View,
    layers: Layer[],
    selected: { layer: string; region: number } | null,
    times: Float64Array,
  ) {
    for (const layer of layers) {
      if (!layer.visible) continue;
      if (layer.type === 'regions') {
        for (const region of layer.regions) {
          const pts = region.points.map((p) => toPx(row, view, pingAt(times, p.t), p.depth));
          if (pts.length < 3) continue;
          const color = regionColor(region);
          const isSel = selected?.layer === layer.key && selected.region === region.id;
          ctx.beginPath();
          pts.forEach((p, i) => (i ? ctx.lineTo(p.px, p.py) : ctx.moveTo(p.px, p.py)));
          ctx.closePath();
          if (region.kind !== 'marker') {
            ctx.fillStyle = hexAlpha(color, region.kind === 'bad' ? 0.28 : 0.16);
            ctx.fill();
          }
          ctx.strokeStyle = color;
          ctx.lineWidth = isSel ? 2 : 1.25;
          ctx.setLineDash(region.kind === 'bad' || region.kind === 'bad_empty' ? [5, 3] : []);
          ctx.stroke();
          ctx.setLineDash([]);
          const top = pts.reduce((a, b) => (b.py < a.py ? b : a), pts[0]);
          const tag = region.class ? `${region.class} · ${region.name}` : region.name;
          ctx.font = `10px ${theme.aa.font.ui}`;
          ctx.fillStyle = color;
          ctx.textAlign = 'left';
          ctx.textBaseline = 'bottom';
          ctx.fillText(tag, top.px + 3, top.py - 2);
          if (isSel) {
            ctx.fillStyle = '#ffffff';
            for (const p of pts) ctx.fillRect(p.px - 3, p.py - 3, 6, 6);
          }
        }
      } else if (layer.points.length) {
        const color = lineColor(layer.label, layer.detected);
        const pts = layer.points.map((p) => ({ ...toPx(row, view, pingAt(times, p.t), p.depth), status: p.status ?? 3 }));
        ctx.lineWidth = layer.key === getEchogram().activeLayer ? 2.25 : 1.6;
        for (let i = 1; i < pts.length; i++) {
          const a = pts[i - 1];
          const b = pts[i];
          if (b.px < row.x - 50 && a.px < row.x - 50) continue;
          if (a.px > row.x + row.w + 50) break;
          ctx.strokeStyle = a.status === 2 || b.status === 2 ? hexAlpha(color, 0.35) : color;
          ctx.setLineDash(a.status === 2 || b.status === 2 ? [4, 4] : []);
          ctx.beginPath();
          ctx.moveTo(a.px, a.py);
          ctx.lineTo(b.px, b.py);
          ctx.stroke();
        }
        ctx.setLineDash([]);
        if (getEchogram().tool === 'select' && layer.key === getEchogram().activeLayer) {
          const visible = pts.filter((p) => p.px >= row.x && p.px <= row.x + row.w);
          if (visible.length < 400) {
            ctx.fillStyle = color;
            for (const p of visible) ctx.fillRect(p.px - 2.5, p.py - 2.5, 5, 5);
          }
        }
      }
    }
  }

  function drawInProgress(ctx: CanvasRenderingContext2D, row: Row, view: View, times: Float64Array) {
    const d = drag.current;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    if (d && d.kind === 'stroke' && d.row.channel.index === row.channel.index) {
      ctx.beginPath();
      d.points.forEach((p, i) => (i ? ctx.lineTo(p.px, p.py) : ctx.moveTo(p.px, p.py)));
      ctx.stroke();
    }
    if (d && (d.kind === 'rect' || d.kind === 'zoom') && d.row.channel.index === row.channel.index) {
      ctx.setLineDash([4, 3]);
      ctx.strokeRect(Math.min(d.px, d.cx), Math.min(d.py, d.cy), Math.abs(d.cx - d.px), Math.abs(d.cy - d.py));
      ctx.setLineDash([]);
    }
    const poly = polygon.current;
    if (poly && poly.row.channel.index === row.channel.index && poly.points.length) {
      ctx.beginPath();
      poly.points.forEach((p, i) => {
        const q = toPx(row, view, pingAt(times, p.t), p.depth);
        if (i) ctx.lineTo(q.px, q.py);
        else ctx.moveTo(q.px, q.py);
      });
      const cur = cursor.current;
      if (cur) ctx.lineTo(cur.px, cur.py);
      ctx.stroke();
    }
  }

  const schedule = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(draw);
  }, [draw]);

  /* Redraw on every change of what is drawn, and when tiles arrive. */
  useEffect(() => {
    schedule();
  }, [s.view, s.layers, s.selected, s.channelsOn, s.tool, s.activeLayer, paintSpec, schedule]);
  useEffect(() => s.store?.onChange(schedule), [s.store, schedule]);
  useEffect(
    () => () => {
      // Forget the cancelled frame too, or a remount (StrictMode does one)
      // would never schedule another.
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    },
    [],
  );

  /* Size: the canvas follows its box, at the screen's pixel density. */
  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const resize = () => {
      const rect = el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      size.current = { w: rect.width, h: rect.height, dpr };
      if (canvas.current) {
        canvas.current.width = Math.max(1, Math.round(rect.width * dpr));
        canvas.current.height = Math.max(1, Math.round(rect.height * dpr));
      }
      schedule();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    resize();
    return () => observer.disconnect();
  }, [schedule]);

  /* ---------------------------------------------------------------- */
  /* The cursor                                                        */
  /* ---------------------------------------------------------------- */

  const hoverAt = (px: number, py: number): Hover | null => {
    const st = getEchogram();
    const row = rowAt(px, py);
    const view = st.view;
    if (!row || !view || !st.manifest || !st.store) return null;
    const { x, y } = toData(row, view, px, py);
    const level = chooseLevel(row.channel, view, row.w, row.h);
    let value = NaN;
    const cell = cellAt(row.channel, level, x, y);
    if (cell) {
      const T = st.manifest.tile;
      const vals = st.store.get({
        channel: row.channel.index,
        level,
        tx: Math.floor(cell.cx / T),
        ty: Math.floor(cell.row / T),
      });
      if (vals) value = vals[(cell.row % T) * T + (cell.cx % T)];
    }
    const time = timeAt(st.times, x);
    const pt = { x: px, y: py };
    const regions: string[] = [];
    const lines: { label: string; depth: number }[] = [];
    for (const layer of st.layers) {
      if (!layer.visible) continue;
      if (layer.type === 'regions') {
        for (const r of layer.regions) {
          const poly = r.points.map((p) => {
            const q = toPx(row, view, pingAt(st.times, p.t), p.depth);
            return { x: q.px, y: q.py };
          });
          if (pointInPolygon(pt, poly)) regions.push(r.class ? `${r.name} (${r.class})` : r.name);
        }
      } else if (layer.points.length) {
        const i = layer.points.findIndex((p) => p.t >= time);
        if (i > 0) {
          const a = layer.points[i - 1];
          const b = layer.points[i];
          lines.push({ label: layer.label, depth: a.depth + ((time - a.t) / (b.t - a.t || 1)) * (b.depth - a.depth) });
        }
      }
    }
    return { channel: row.channel, x, y, ping: Math.floor(x), time, value, level, regions, lines };
  };

  /* ---------------------------------------------------------------- */
  /* Pointer                                                           */
  /* ---------------------------------------------------------------- */

  const local = (e: React.PointerEvent | React.WheelEvent | React.MouseEvent) => {
    const rect = canvas.current!.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top };
  };

  const activeLayerOf = (type: 'line' | 'regions'): Layer => {
    const st = getEchogram();
    const active = st.layers.find((l) => l.key === st.activeLayer && l.type === type);
    if (active) return active;
    const existing = st.layers.find((l) => l.type === type && !l.detected && l.visible);
    if (existing) return existing;
    const key = newLayer(type, type === 'line' ? 'bottom' : 'regions');
    return getEchogram().layers.find((l) => l.key === key)!;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    const st = getEchogram();
    if (!st.view || e.button !== 0) return;
    const { px, py } = local(e);
    const row = rowAt(px, py);
    if (!row) return;
    canvas.current?.setPointerCapture(e.pointerId);
    const { x, y } = toData(row, st.view, px, py);
    const t = timeAt(st.times, x);
    switch (st.tool) {
      case 'pan':
        drag.current = { kind: 'pan', start: st.view, px, py, row };
        break;
      case 'zoom':
        drag.current = { kind: 'zoom', row, px, py, cx: px, cy: py };
        break;
      case 'line':
        drag.current = { kind: 'stroke', row, points: [{ px, py, t, depth: y }] };
        break;
      case 'region':
        drag.current = { kind: 'rect', row, a: { t, depth: y }, px, py, cx: px, cy: py };
        break;
      case 'polygon': {
        const poly = polygon.current ?? { row, points: [] };
        poly.points.push({ t, depth: y });
        polygon.current = poly;
        schedule();
        break;
      }
      case 'select': {
        // A vertex of the selected region, a point of the active line, then a region.
        const sel = st.selected;
        if (sel) {
          const layer = st.layers.find((l) => l.key === sel.layer);
          const region = layer?.regions.find((r) => r.id === sel.region);
          if (region) {
            const pts = region.points.map((p) => {
              const q = toPx(row, st.view!, pingAt(st.times, p.t), p.depth);
              return { x: q.px, y: q.py };
            });
            const i = nearestVertex(pts, { x: px, y: py }, 7);
            if (i >= 0) {
              drag.current = { kind: 'vertex', row, layer: sel.layer, region: sel.region, index: i };
              return;
            }
          }
        }
        const line = st.layers.find((l) => l.key === st.activeLayer && l.type === 'line' && l.visible);
        if (line) {
          const pts = line.points.map((p) => {
            const q = toPx(row, st.view!, pingAt(st.times, p.t), p.depth);
            return { x: q.px, y: q.py };
          });
          const i = nearestVertex(pts, { x: px, y: py }, 6);
          if (i >= 0) {
            drag.current = { kind: 'linepoint', row, layer: line.key, index: i };
            return;
          }
        }
        let hit: { layer: string; region: number } | null = null;
        for (const layer of [...st.layers].reverse()) {
          if (!layer.visible || layer.type !== 'regions') continue;
          for (const r of [...layer.regions].reverse()) {
            const poly = r.points.map((p) => {
              const q = toPx(row, st.view!, pingAt(st.times, p.t), p.depth);
              return { x: q.px, y: q.py };
            });
            if (pointInPolygon({ x: px, y: py }, poly) || nearPolyline([...poly, poly[0]], { x: px, y: py }, 4)) {
              hit = { layer: layer.key, region: r.id };
              break;
            }
          }
          if (hit) break;
        }
        selectRegion(hit);
        break;
      }
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const st = getEchogram();
    const { px, py } = local(e);
    cursor.current = { px, py };
    const hover = hoverAt(px, py);
    if (hover?.ping !== lastHover.current?.ping || hover?.y !== lastHover.current?.y) {
      lastHover.current = hover;
      onHover(hover);
    }
    const d = drag.current;
    if (d && st.view && st.bounds) {
      if (d.kind === 'pan') {
        const dx = ((px - d.px) / d.row.w) * (d.start.x1 - d.start.x0);
        const dy = ((py - d.py) / d.row.h) * (d.start.y1 - d.start.y0);
        setView(panBy(d.start, -dx, -dy, st.bounds));
      } else if (d.kind === 'zoom' || d.kind === 'rect') {
        d.cx = px;
        d.cy = py;
      } else if (d.kind === 'stroke') {
        const { x, y } = toData(d.row, st.view, px, py);
        const last = d.points[d.points.length - 1];
        if (Math.abs(px - last.px) + Math.abs(py - last.py) >= 2) d.points.push({ px, py, t: timeAt(st.times, x), depth: y });
      } else if (d.kind === 'vertex') {
        const { x, y } = toData(d.row, st.view, px, py);
        const layer = st.layers.find((l) => l.key === d.layer);
        if (layer) {
          setRegions(
            layer.key,
            layer.regions.map((r) =>
              r.id === d.region
                ? { ...r, points: r.points.map((p, i) => (i === d.index ? { t: timeAt(st.times, x), depth: y } : p)) }
                : r,
            ),
          );
        }
      } else if (d.kind === 'linepoint') {
        const { y } = toData(d.row, st.view, px, py);
        const layer = st.layers.find((l) => l.key === d.layer);
        if (layer) setLinePoints(layer.key, layer.points.map((p, i) => (i === d.index ? { ...p, depth: y } : p)));
      }
    }
    schedule();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const st = getEchogram();
    const d = drag.current;
    drag.current = null;
    if (!d || !st.view || !st.bounds) return;
    const { px, py } = local(e);
    if (d.kind === 'zoom') {
      const a = toData(d.row, st.view, Math.min(d.px, px), Math.min(d.py, py));
      const b = toData(d.row, st.view, Math.max(d.px, px), Math.max(d.py, py));
      if (Math.abs(px - d.px) > 6 && Math.abs(py - d.py) > 6) {
        setView({ x0: a.x, x1: b.x, y0: a.y, y1: b.y });
      } else {
        const p = toData(d.row, st.view, px, py);
        const f = e.altKey ? 2 : 0.5;
        setView(zoomAbout(st.view, p.x, p.y, f, f, st.bounds));
      }
    } else if (d.kind === 'stroke' && d.points.length > 1) {
      const keep = simplify(
        d.points.map((p) => ({ x: p.px, y: p.py })),
        1.2,
      );
      const drawn: LinePoint[] = keep.map((i) => ({ t: d.points[i].t, depth: d.points[i].depth, status: 3 }));
      const layer = activeLayerOf('line');
      setLinePoints(layer.key, drawOver(layer.points, drawn));
    } else if (d.kind === 'rect') {
      if (Math.abs(px - d.px) > 4 && Math.abs(py - d.py) > 4) {
        const b = toData(d.row, st.view, px, py);
        const layer = activeLayerOf('regions');
        const id = nextRegionId(layer.regions);
        setRegions(layer.key, [...layer.regions, rectangle(id, d.a, { t: timeAt(st.times, b.x), depth: b.y })]);
        selectRegion({ layer: layer.key, region: id });
      }
    }
    schedule();
  };

  const finishPolygon = () => {
    const poly = polygon.current;
    polygon.current = null;
    if (poly) {
      // A double-click to finish also clicked twice: drop repeated vertices.
      poly.points = poly.points.filter(
        (p, i, all) => i === 0 || Math.abs(p.t - all[i - 1].t) > 1 || Math.abs(p.depth - all[i - 1].depth) > 1e-3,
      );
    }
    if (!poly || poly.points.length < 3) {
      schedule();
      return;
    }
    const layer = activeLayerOf('regions');
    const id = nextRegionId(layer.regions);
    setRegions(layer.key, [
      ...layer.regions,
      { id, name: `Region ${id}`, class: '', kind: 'analysis', notes: [], points: poly.points },
    ]);
    selectRegion({ layer: layer.key, region: id });
  };

  const onWheel = (e: React.WheelEvent) => {
    const st = getEchogram();
    if (!st.view || !st.bounds) return;
    const { px, py } = local(e);
    const row = rowAt(px, py) ?? rows()[0];
    if (!row) return;
    const p = toData(row, st.view, px, py);
    const f = Math.exp(Math.max(-0.5, Math.min(0.5, e.deltaY * 0.0015)));
    const fx = e.shiftKey ? 1 : f;
    const fy = e.altKey ? 1 : f;
    setView(zoomAbout(st.view, p.x, p.y, fx, fy, st.bounds));
  };

  /* Wheel without the page scrolling. */
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const stop = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', stop, { passive: false });
    return () => el.removeEventListener('wheel', stop);
  }, []);

  /* Keys: Enter closes a polygon, Escape drops what is being drawn. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea, [contenteditable="true"]')) return;
      if (e.key === 'Enter' && polygon.current) {
        finishPolygon();
        e.preventDefault();
      } else if (e.key === 'Escape') {
        polygon.current = null;
        drag.current = null;
        selectRegion(null);
        schedule();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule]);

  const cursorStyle =
    s.tool === 'pan' ? 'grab' : s.tool === 'select' ? 'default' : s.tool === 'zoom' ? 'zoom-in' : 'crosshair';

  return (
    <Box ref={host} sx={{ position: 'relative', flex: 1, minHeight: 0, minWidth: 0 }}>
      <canvas
        ref={canvas}
        role="img"
        aria-label="Echogram"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', cursor: cursorStyle, touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => {
          cursor.current = null;
          lastHover.current = null;
          onHover(null);
          schedule();
        }}
        onDoubleClick={() => {
          if (getEchogram().tool === 'polygon') finishPolygon();
          else if (getEchogram().tool === 'pan' || getEchogram().tool === 'zoom') fitAll();
        }}
        onWheel={onWheel}
      />
    </Box>
  );
}

function hexAlpha(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

