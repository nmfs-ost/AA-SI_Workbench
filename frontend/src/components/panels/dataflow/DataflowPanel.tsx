import { useEffect, useMemo, useRef, useState } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import { Box, Button, CircularProgress, IconButton, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import {
  AccountTreeOutlined,
  RefreshOutlined,
  SchemaOutlined,
  TableChartOutlined,
  WarningAmberRounded,
  WavesOutlined,
} from '@mui/icons-material';

import { lineageApi, type LineageGraph, type LineageNode } from '../../../services/echoviewApi';
import { pipelinesApi } from '../../../services/pipelinesApi';
import { useLayout } from '../../../context/LayoutContext';
import { setActiveArtifact, useActiveSubject } from '../../../state/activeSubject';
import { revealInDerived } from '../../../state/derivedReveal';
import { openAnnotation, openEchogram } from '../../../state/echogram';
import { inputFromProduct } from '../../../state/pipelines';
import { PanelHeader } from '../PanelHeader';
import { PanelPlaceholder } from '../PanelPlaceholder';
import { HashTag } from '../products/ProductBits';
import { LevelChip } from '../prepare/ui';
import { KIND_LABELS } from '../pipelines/chain';
import { openResults } from '../results/ResultsPanel';
import { isAnnotation, opensAsEchogram, opensAsResults } from '../echogram/openers';
import { place } from './layout';

const NODE_H = 46;
/** Products no pipeline stage reads as its input (options take them instead). */
const NOT_AN_INPUT = new Set(['lines', 'regions', 'calibration', 'integration', 'tiles', 'echogram', 'html']);

/**
 * The dataflow around the selected product, read from the bucket: what it was
 * made from (up to the raw files), and what was made from it in its folders.
 * Echoview's Dataflow window, for products: each box is a product with its
 * hash; a product made with a line, region or calibration file that has since
 * been saved again is marked out of date, and so is everything made from it.
 */
export const DataflowPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const c = theme.aa.color;
  const subject = useActiveSubject();
  const { openPanel } = useLayout();
  const [graph, setGraph] = useState<LineageGraph | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [picked, setPicked] = useState<string>('');
  const [actionError, setActionError] = useState('');
  const [nonce, setNonce] = useState(0);
  const box = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(300);

  const uri = subject?.uri.startsWith('gs://') ? subject.uri : '';

  useEffect(() => {
    if (!uri) {
      setGraph(null);
      return;
    }
    let live = true;
    setLoading(true);
    setError('');
    lineageApi
      .graph(uri)
      .then((g) => {
        if (!live) return;
        setGraph(g);
        setPicked(g.uri);
      })
      .catch((e) => live && setError(e instanceof Error ? e.message : String(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [uri, nonce]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(200, el.clientWidth)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const layout = useMemo(
    () => (graph ? place(graph.nodes, graph.edges, width, { nodeH: NODE_H }) : null),
    [graph, width],
  );
  const byId = useMemo(() => new Map((graph?.nodes ?? []).map((n) => [n.id, n])), [graph]);
  const pos = useMemo(() => new Map((layout?.placed ?? []).map((p) => [p.id, p])), [layout]);
  const node = byId.get(picked) ?? null;
  const stale = graph?.nodes.filter((n) => n.stale).length ?? 0;

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, backgroundColor: c.bg.panel }}>
      <PanelHeader
        icon={<SchemaOutlined className="panel-header-icon" />}
        title="Dataflow"
        subtitle={subject?.label}
        actions={
          uri ? (
            <Tooltip title="Read it again">
              <IconButton size="small" onClick={() => setNonce((n) => n + 1)}>
                <RefreshOutlined sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
          ) : undefined
        }
      />
      <Box ref={box} sx={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {!uri ? (
          <PanelPlaceholder
            icon={SchemaOutlined}
            title="Nothing selected"
            description="Select a product in Products to see what it was made from and what was made from it."
          />
        ) : loading && !graph ? (
          <Box sx={{ p: 2, display: 'flex', gap: 1, alignItems: 'center' }}>
            <CircularProgress size={14} />
            <Typography sx={{ fontSize: 12, color: c.text.secondary }}>Reading the records…</Typography>
          </Box>
        ) : error ? (
          <Typography sx={{ p: 1.5, fontSize: 12, color: c.status.warning }}>{error}</Typography>
        ) : graph && layout ? (
          <>
            {stale > 0 && (
              <Box sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-start', m: 1, p: 1, borderRadius: 1, backgroundColor: alpha(c.status.warning, 0.1) }}>
                <WarningAmberRounded sx={{ fontSize: 16, color: c.status.warning, mt: '1px' }} />
                <Typography sx={{ fontSize: 11.5, color: c.text.primary, lineHeight: 1.45 }}>
                  {stale} product{stale === 1 ? ' is' : 's are'} out of date: made with a line, region or
                  calibration file that has been saved again since. Run their pipeline again to remake
                  them with the new one.
                </Typography>
              </Box>
            )}
            <svg width={width} height={layout.height} role="img" aria-label="Dataflow">
              {graph.edges.map((e, i) => {
                const a = pos.get(e.source);
                const b = pos.get(e.target);
                if (!a || !b) return null;
                const x1 = a.x + a.w / 2;
                const y1 = a.y + NODE_H;
                const x2 = b.x + b.w / 2;
                const y2 = b.y;
                const mid = (y1 + y2) / 2;
                const side = e.role !== 'source';
                return (
                  <g key={i}>
                    <path
                      d={`M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`}
                      fill="none"
                      stroke={side ? alpha(c.syntax.reference, 0.7) : c.text.disabled}
                      strokeWidth={1.3}
                      strokeDasharray={side ? '4 3' : undefined}
                    />
                    {side && (
                      <text x={(x1 + x2) / 2 + 4} y={mid} fontSize={9} fill={c.text.muted} fontFamily={theme.aa.font.ui}>
                        {e.role.split(':').pop()}
                      </text>
                    )}
                  </g>
                );
              })}
              {layout.placed.map((p) => {
                const n = byId.get(p.id)!;
                return (
                  <foreignObject key={p.id} x={p.x} y={p.y} width={p.w} height={NODE_H}>
                    <NodeBox
                      node={n}
                      picked={picked === n.id}
                      onPick={() => {
                        setPicked(n.id);
                        setActionError('');
                      }}
                    />
                  </foreignObject>
                );
              })}
            </svg>
            {graph.truncated && (
              <Typography sx={{ px: 1.5, fontSize: 11, color: c.text.muted }}>
                The folder has more products than are read here; some may not be shown.
              </Typography>
            )}
          </>
        ) : null}
      </Box>

      {node && (
        <Box sx={{ borderTop: `1px solid ${c.border.subtle}`, p: 1, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
          <Typography sx={{ fontSize: 11.5, fontWeight: 600, color: c.text.primary, wordBreak: 'break-all' }}>
            {node.name}
          </Typography>
          <Typography sx={{ fontSize: 10.5, color: c.text.muted }}>
            {node.tool || 'source'}
            {node.createdAt ? ` · ${node.createdAt.replace('T', ' ').replace('Z', ' UTC')}` : ''}
            {node.createdBy ? ` · ${node.createdBy}` : ''}
          </Typography>
          {node.stale && (
            <Typography sx={{ fontSize: 11, color: c.status.warning, lineHeight: 1.4 }}>{node.staleReason}</Typography>
          )}
          {actionError && (
            <Typography sx={{ fontSize: 11, color: c.status.error, lineHeight: 1.4 }}>{actionError}</Typography>
          )}
          {node.uri.startsWith('gs://') && (
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {opensAsEchogram(node.kind, node.name) && (
                <Button
                  size="small"
                  startIcon={<WavesOutlined sx={{ fontSize: 14 }} />}
                  onClick={() => {
                    void openEchogram(node.uri);
                    openPanel('echogram');
                  }}
                  sx={btn}
                >
                  Echogram
                </Button>
              )}
              {(isAnnotation(node.kind, node.name) || node.kind === 'seafloor') && (
                <Button
                  size="small"
                  startIcon={<WavesOutlined sx={{ fontSize: 14 }} />}
                  onClick={() => {
                    openPanel('echogram');
                    openAnnotation(node.uri).catch((e: unknown) => setActionError(e instanceof Error ? e.message : String(e)));
                  }}
                  sx={btn}
                >
                  On its echogram
                </Button>
              )}
              {opensAsResults(node.kind, node.name) && (
                <Button
                  size="small"
                  startIcon={<TableChartOutlined sx={{ fontSize: 14 }} />}
                  onClick={() => {
                    openResults(node.uri);
                    openPanel('results');
                  }}
                  sx={btn}
                >
                  Results
                </Button>
              )}
              {!NOT_AN_INPUT.has(node.kind) && (
                <Button
                  size="small"
                  startIcon={<AccountTreeOutlined sx={{ fontSize: 14 }} />}
                  onClick={async () => {
                    inputFromProduct(await pipelinesApi.product(node.uri));
                    openPanel('pipelines');
                  }}
                  sx={btn}
                >
                  Pipeline input
                </Button>
              )}
              <Button
                size="small"
                onClick={() => {
                  setActiveArtifact({ uri: node.uri, label: node.name, origin: 'Derived' });
                }}
                sx={btn}
              >
                Centre here
              </Button>
              <Button
                size="small"
                onClick={() => {
                  revealInDerived(node.uri);
                  openPanel('derived');
                }}
                sx={btn}
              >
                Show in Products
              </Button>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
};

const btn = { fontSize: 11, textTransform: 'none', minWidth: 0, px: 0.75 } as const;

function NodeBox({ node, picked, onPick }: { node: LineageNode; picked: boolean; onPick: () => void }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const border = node.stale
    ? c.status.warning
    : node.relation === 'self'
      ? c.accent.main
      : picked
        ? alpha(c.accent.main, 0.6)
        : c.border.subtle;
  return (
    <Box
      onClick={onPick}
      title={node.uri || node.name}
      sx={{
        height: NODE_H - 2,
        boxSizing: 'border-box',
        border: `1px solid ${border}`,
        borderWidth: node.relation === 'self' || node.stale ? 1.5 : 1,
        borderRadius: `${theme.aa.radius.md}px`,
        backgroundColor: picked ? alpha(c.accent.main, 0.1) : c.bg.elevated,
        px: 0.75,
        py: 0.4,
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 0.25,
        overflow: 'hidden',
        opacity: node.inBucket || node.relation === 'self' ? 1 : 0.75,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        {node.level && <LevelChip level={node.level} />}
        <Typography sx={{ fontSize: 10.5, fontWeight: 600, color: c.text.secondary, flexShrink: 0 }}>
          {KIND_LABELS[node.kind] ?? (node.kind || 'file')}
        </Typography>
        {node.stale && <WarningAmberRounded sx={{ fontSize: 13, color: c.status.warning, flexShrink: 0 }} />}
        <Box sx={{ flex: 1 }} />
        {node.productHash && <HashTag hash={node.productHash} quiet />}
      </Box>
      <Typography sx={{ fontSize: 10.5, color: c.text.primary, lineHeight: 1.2 }} noWrap>
        {node.name}
      </Typography>
    </Box>
  );
}
