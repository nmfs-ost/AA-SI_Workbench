import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { Box, alpha, useTheme } from '@mui/material';

import type { Bin, PlanFile, RangePlan } from './plan';
import { coverage, formatUtc, gapsOf, tickLabel, ticks, timeline } from './plan';

/**
 * The time range, drawn: the survey as a whole above, the chosen stretch up
 * close below.
 *
 * The overview is the survey's shape — when the ship was logging, where the
 * transits are — so a range can be chosen by eye. Drag across it to choose a
 * new range; drag the highlighted range to move it.
 *
 * The close-up shows the files themselves, because the file edges are where
 * the data actually starts and stops: the first file usually begins before the
 * range does, and that is visible here rather than a surprise later. Its ends
 * are handles. Its window follows the range, but only between drags — a view
 * that re-centred under the pointer would be impossible to drag in.
 */

interface Props {
  files: readonly PlanFile[];
  from: number | null;
  to: number | null;
  plan: RangePlan | null;
  gapSeconds: number;
  gapFactor: number;
  onChange: (from: number, to: number) => void;
}

type Drag =
  | { mode: 'new'; anchor: number; strip: 'overview' | 'detail' }
  | { mode: 'from' | 'to'; strip: 'detail' }
  | { mode: 'move'; grab: number; from: number; to: number; strip: 'overview' | 'detail' };

const OVERVIEW_H = 26;
const DETAIL_H = 46;
const AXIS_H = 15;
const MIN_SPAN = 60e3;

/** A step to round to, fine enough for the zoom: ~4 px of the strip. */
function snapStep(span: number, width: number): number {
  const raw = (span / Math.max(width, 1)) * 4;
  const steps = [1e3, 10e3, 60e3, 5 * 60e3, 15 * 60e3, 3600e3, 6 * 3600e3];
  return steps.find((s) => s >= raw) ?? steps[steps.length - 1];
}

/** Adjacent covered bins as one bar, so logging reads as a band and gaps as holes. */
function runs(bins: readonly Bin[]): { from: number; to: number; cover: number }[] {
  const out: { from: number; to: number; cover: number; n: number }[] = [];
  for (const bin of bins) {
    if (bin.cover <= 0.05) continue;
    const last = out[out.length - 1];
    if (last && Math.abs(last.to - bin.from) < 1) {
      last.to = bin.to;
      last.cover += bin.cover;
      last.n += 1;
    } else {
      out.push({ from: bin.from, to: bin.to, cover: bin.cover, n: 1 });
    }
  }
  return out.map(({ from, to, cover, n }) => ({ from, to, cover: cover / n }));
}

function useWidth() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(300);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(Math.max(120, Math.floor(entry.contentRect.width)));
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return { ref, width };
}

export function Timeline({ files, from, to, plan, gapSeconds, gapFactor, onChange }: Props) {
  const theme = useTheme();
  const c = theme.aa.color;
  const { ref, width } = useWidth();

  const { timed, cadence } = useMemo(() => timeline(files), [files]);
  const extent = useMemo(
    () => (timed.length ? { from: timed[0].start, to: timed[timed.length - 1].end } : null),
    [timed],
  );
  const surveyGaps = useMemo(
    () => gapsOf(timed, cadence, gapSeconds, gapFactor),
    [timed, cadence, gapSeconds, gapFactor],
  );

  const [drag, setDrag] = useState<Drag | null>(null);

  /* The close-up's window: the range plus a margin, fixed while dragging. */
  const wanted = useMemo(() => {
    if (from === null || to === null || !(to > from)) return extent;
    const span = to - from;
    const margin = Math.max(span * 0.3, 10 * 60e3);
    return { from: from - margin, to: to + margin };
  }, [from, to, extent]);
  const [detail, setDetail] = useState(wanted);
  useEffect(() => {
    if (!drag) setDetail(wanted);
  }, [wanted, drag]);

  if (!extent || !detail) return <Box ref={ref} />;

  const overviewX = (t: number) => ((t - extent.from) / (extent.to - extent.from)) * width;
  const detailX = (t: number) => ((t - detail.from) / (detail.to - detail.from)) * width;
  const timeAt = (strip: 'overview' | 'detail', clientX: number, box: DOMRect): number => {
    const d = strip === 'overview' ? extent : detail;
    const frac = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
    const t = d.from + frac * (d.to - d.from);
    const step = snapStep(d.to - d.from, width);
    return Math.round(t / step) * step;
  };

  const commit = (a: number, b: number) => {
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    onChange(lo, Math.max(hi, lo + MIN_SPAN));
  };

  const down = (strip: 'overview' | 'detail') => (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const box = e.currentTarget.getBoundingClientRect();
    const t = timeAt(strip, e.clientX, box);
    const target = (e.target as Element).getAttribute('data-handle');
    e.currentTarget.setPointerCapture(e.pointerId);
    if (strip === 'detail' && (target === 'from' || target === 'to')) {
      setDrag({ mode: target, strip });
    } else if (from !== null && to !== null && t > from && t < to && target === 'range') {
      setDrag({ mode: 'move', grab: t, from, to, strip });
    } else {
      setDrag({ mode: 'new', anchor: t, strip });
    }
  };

  const move = (strip: 'overview' | 'detail') => (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag || drag.strip !== strip) return;
    const t = timeAt(strip, e.clientX, e.currentTarget.getBoundingClientRect());
    if (drag.mode === 'new') {
      if (Math.abs(t - drag.anchor) >= MIN_SPAN) commit(drag.anchor, t);
    } else if (drag.mode === 'move') {
      const shift = t - drag.grab;
      onChange(drag.from + shift, drag.to + shift);
    } else if (drag.mode === 'from' && to !== null) {
      onChange(Math.min(t, to - MIN_SPAN), to);
    } else if (drag.mode === 'to' && from !== null) {
      onChange(from, Math.max(t, from + MIN_SPAN));
    }
  };

  const up = (strip: 'overview' | 'detail') => (e: ReactPointerEvent<SVGSVGElement>) => {
    if (!drag || drag.strip !== strip) return;
    const t = timeAt(strip, e.clientX, e.currentTarget.getBoundingClientRect());
    // A click on the overview, not a drag: move the range there, same length.
    if (drag.mode === 'new' && Math.abs(t - drag.anchor) < MIN_SPAN && strip === 'overview'
      && from !== null && to !== null) {
      const span = to - from;
      onChange(t - span / 2, t + span / 2);
    }
    setDrag(null);
  };

  const chosen = new Set(plan?.files.map((f) => f.name) ?? []);
  const bins = coverage(files, extent.from, extent.to, Math.max(20, Math.floor(width / 3)));
  const selA = from ?? 0;
  const selB = to ?? 0;
  const hasSel = from !== null && to !== null && to > from;
  const accent = c.accent.main;
  const hatch = `aa-gap-hatch-${theme.palette.mode}`;

  const axis = (d: { from: number; to: number }, x: (t: number) => number, y: number) =>
    ticks(d.from, d.to, Math.max(2, Math.floor(width / 70))).map((t) => (
      <g key={t}>
        <line x1={x(t)} x2={x(t)} y1={y - 3} y2={y} stroke={c.border.strong} strokeWidth={1} />
        <text
          x={Math.min(Math.max(x(t), 14), width - 14)}
          y={y + 10}
          textAnchor="middle"
          fontSize={9.5}
          fill={c.text.muted}
          style={{ fontVariantNumeric: 'tabular-nums' }}
        >
          {tickLabel(t, d.to - d.from)}
        </text>
      </g>
    ));

  const svgSx = {
    display: 'block',
    width: '100%',
    touchAction: 'none',
    userSelect: 'none' as const,
    cursor: drag ? (drag.mode === 'move' ? 'grabbing' : 'ew-resize') : 'crosshair',
  };

  return (
    <Box ref={ref} sx={{ width: '100%' }}>
      {/* Overview: the whole survey */}
      <Box
        component="svg"
        width={width}
        height={OVERVIEW_H + AXIS_H}
        onPointerDown={down('overview')}
        onPointerMove={move('overview')}
        onPointerUp={up('overview')}
        onPointerCancel={() => setDrag(null)}
        onLostPointerCapture={() => setDrag(null)}
        sx={svgSx}
        aria-label="Survey overview: drag to choose a time range"
      >
        <rect x={0} y={0} width={width} height={OVERVIEW_H} rx={3}
          fill={alpha(c.text.primary, 0.035)} />
        {runs(bins).map((run) => (
          <rect
            key={run.from}
            x={overviewX(run.from)}
            y={OVERVIEW_H * 0.3}
            width={Math.max(1.5, overviewX(run.to) - overviewX(run.from))}
            height={OVERVIEW_H * 0.4}
            rx={1.5}
            fill={alpha(c.text.secondary, 0.2 + 0.3 * run.cover)}
          />
        ))}
        {hasSel &&
          runs(bins.filter((bin) => bin.to > selA && bin.from < selB)).map((run) => (
            <rect
              key={`sel-${run.from}`}
              x={overviewX(Math.max(run.from, selA))}
              y={OVERVIEW_H * 0.3}
              width={Math.max(1.5, overviewX(Math.min(run.to, selB)) - overviewX(Math.max(run.from, selA)))}
              height={OVERVIEW_H * 0.4}
              rx={1.5}
              fill={accent}
            />
          ))}
        {/* the close-up's window, as a bracket */}
        <rect
          x={Math.max(0, overviewX(detail.from))}
          y={1}
          width={Math.max(2, Math.min(width, overviewX(detail.to)) - Math.max(0, overviewX(detail.from)))}
          height={OVERVIEW_H - 2}
          rx={2}
          fill="none"
          stroke={alpha(c.text.secondary, 0.45)}
          strokeDasharray="2 2"
        />
        {hasSel && (
          <rect
            data-handle="range"
            x={overviewX(selA)}
            y={0}
            width={Math.max(3, overviewX(selB) - overviewX(selA))}
            height={OVERVIEW_H}
            rx={2}
            fill={alpha(accent, 0.18)}
            stroke={accent}
            strokeWidth={1}
            style={{ cursor: 'grab' }}
          />
        )}
        {axis(extent, overviewX, OVERVIEW_H + 3)}
      </Box>

      {/* Close-up: the files around the range */}
      <Box
        component="svg"
        width={width}
        height={DETAIL_H + AXIS_H + 4}
        onPointerDown={down('detail')}
        onPointerMove={move('detail')}
        onPointerUp={up('detail')}
        onPointerCancel={() => setDrag(null)}
        onLostPointerCapture={() => setDrag(null)}
        sx={{ ...svgSx, mt: 0.75 }}
        aria-label="Files around the range: drag the edges to adjust"
      >
        <defs>
          <pattern id={hatch} width={5} height={5} patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)">
            <line x1={0} y1={0} x2={0} y2={5} stroke={alpha(c.status.warning, 0.55)} strokeWidth={1.5} />
          </pattern>
          <clipPath id="aa-detail-clip">
            <rect x={0} y={0} width={width} height={DETAIL_H + 4} />
          </clipPath>
        </defs>
        <g clipPath="url(#aa-detail-clip)">
          <rect x={0} y={4} width={width} height={DETAIL_H} rx={3}
            fill={alpha(c.text.primary, 0.035)} />
          {surveyGaps
            .filter((g) => g.to > detail.from && g.from < detail.to)
            .map((g) => {
              const x0 = detailX(g.from);
              const w = detailX(g.to) - x0;
              return (
                <g key={g.before}>
                  <rect x={x0} y={4} width={w} height={DETAIL_H} fill={`url(#${hatch})`} opacity={0.6}>
                    <title>{`Gap: nothing logged between ${g.before} and ${g.after}`}</title>
                  </rect>
                </g>
              );
            })}
          {timed
            .filter((f) => f.end > detail.from && f.start < detail.to)
            .map((f) => {
              const x0 = detailX(f.start);
              const w = Math.max(1, detailX(f.end) - x0 - (detailX(f.end) - x0 > 4 ? 1.5 : 0));
              const inPlan = chosen.has(f.file.name);
              return (
                <rect
                  key={f.file.name}
                  x={x0}
                  y={12}
                  width={w}
                  height={DETAIL_H - 16}
                  rx={w > 4 ? 2 : 0}
                  fill={inPlan ? alpha(accent, 0.75) : alpha(c.text.secondary, 0.28)}
                >
                  <title>{`${f.file.name}\nstarts ${formatUtc(f.start)} UTC`}</title>
                </rect>
              );
            })}
          {hasSel && (
            <>
              {/* outside the range, dimmed */}
              <rect x={0} y={4} width={Math.max(0, detailX(selA))} height={DETAIL_H}
                fill={alpha(c.bg.panel, 0.55)} />
              <rect x={detailX(selB)} y={4} width={Math.max(0, width - detailX(selB))}
                height={DETAIL_H} fill={alpha(c.bg.panel, 0.55)} />
              <rect data-handle="range" x={detailX(selA)} y={4}
                width={Math.max(1, detailX(selB) - detailX(selA))} height={DETAIL_H}
                fill={alpha(accent, 0.07)} style={{ cursor: 'grab' }} />
              {(['from', 'to'] as const).map((edge) => {
                const x = detailX(edge === 'from' ? selA : selB);
                return (
                  <g key={edge}>
                    <line x1={x} x2={x} y1={2} y2={DETAIL_H + 4} stroke={accent} strokeWidth={1.5} />
                    <rect
                      data-handle={edge}
                      x={x - 4}
                      y={DETAIL_H / 2 - 6}
                      width={8}
                      height={16}
                      rx={2.5}
                      fill={c.bg.panel}
                      stroke={accent}
                      strokeWidth={1.5}
                      style={{ cursor: 'ew-resize' }}
                    />
                    {/* a wide, invisible grab area around the edge */}
                    <rect data-handle={edge} x={x - 7} y={0} width={14} height={DETAIL_H + 4}
                      fill="transparent" style={{ cursor: 'ew-resize' }} />
                  </g>
                );
              })}
            </>
          )}
        </g>
        {axis(detail, detailX, DETAIL_H + 7)}
      </Box>
    </Box>
  );
}
