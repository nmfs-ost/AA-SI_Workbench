import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import {
  Box,
  Button,
  Checkbox,
  CircularProgress,
  IconButton,
  InputBase,
  Tooltip,
  Typography,
  alpha,
  useTheme,
} from '@mui/material';
import {
  AccountTreeOutlined,
  ChevronRightOutlined,
  LayersOutlined,
  ContentCopyOutlined,
  DataObjectOutlined,
  DescriptionOutlined,
  ExpandMoreOutlined,
  FolderOutlined,
  GridOnOutlined,
  ImageOutlined,
  InsightsOutlined,
  LaunchOutlined,
  RefreshOutlined,
  SearchOutlined,
  TerminalOutlined,
  UnfoldLessOutlined,
  SchemaOutlined,
  ShowChartOutlined,
  TableChartOutlined,
  WavesOutlined,
  SavingsOutlined,
} from '@mui/icons-material';

import { CopyPathButton } from './CopyPathButton';
import { RowMenu, RowMenuButton, useRowMenu, type RowAction } from './RowMenu';
import { derivedApi } from '../../services/derivedApi';
import type { DerivedEntry, DerivedKind, DerivedStatus } from '../../services/derivedApi';
import type { ProductRef } from '../../services/pipelinesApi';
import { useLayout } from '../../context/LayoutContext';
import { setActiveArtifact } from '../../state/activeSubject';
import { openDialog } from '../../state/dialogs';
import { onGcpChange } from '../../state/gcp';
import { useRevealRequest } from '../../state/derivedReveal';
import { sendToTerminal } from '../../state/terminal';
import { setInputs, toggleInput, usePipelines } from '../../state/pipelines';
import { PanelBar, PanelHeader } from './PanelHeader';
import { HashTag, IntegrityMark } from './products/ProductBits';
import { LevelChip } from './prepare/ui';
import { panelColumns, panelDensity } from './panelStyles';
import { formatBytes, formatRelativeTime, modifiedTooltip } from './rowFormat';
import { quote } from './shellQuote';
import { openAnnotation, openEchogram } from '../../state/echogram';
import { isAnnotation, opensAsEchogram, opensAsResults } from './echogram/openers';
import { openResults } from './results/ResultsPanel';
import { CLASS_LABEL, formatMoney, formatRate, monthlyCost, type Prices } from '../../services/costsApi';
import { initCosts, showCosts, useCosts } from '../../state/costs';

const KIND_ICON: Record<DerivedKind, typeof FolderOutlined> = {
  folder: FolderOutlined,
  netcdf: GridOnOutlined,
  zarr: GridOnOutlined,
  raw: InsightsOutlined,
  table: GridOnOutlined,
  region: DescriptionOutlined,
  line: ShowChartOutlined,
  calibration: DescriptionOutlined,
  tiles: WavesOutlined,
  image: ImageOutlined,
  text: DescriptionOutlined,
  object: DescriptionOutlined,
};

const ASSET_KINDS = new Set<DerivedKind>(['netcdf', 'zarr', 'raw']);

/** The width of the hash column: "aa:" and eight characters. */
const HASH_COLUMN = 72;

/* The columns give way, narrowest panel first, so the name always has room:
   Updated goes below 560px of panel, Size below 500px (it is in the cost's
   tooltip), the cost a month below 360px. The hash stays: it is what this
   panel is for. (Container queries: the panel, not the window.) */
const HIDE_UPDATED = { '@container products (max-width: 559px)': { display: 'none' } };
const HIDE_SIZE = { '@container products (max-width: 499px)': { display: 'none' } };
const HIDE_COST = { '@container products (max-width: 359px)': { display: 'none' } };

/** What the Pipelines card needs from a row. */
export function refOf(entry: DerivedEntry): ProductRef {
  return {
    uri: entry.uri,
    name: entry.name,
    kind: entry.productKind,
    level: entry.level,
    productHash: entry.productHash,
    recipe: entry.recipe,
    md5: entry.md5,
    intact: entry.intact,
    tool: entry.tool,
    sizeBytes: entry.sizeBytes,
    updatedAt: entry.updatedAt,
  };
}

interface Row {
  entry: DerivedEntry;
  depth: number;
}

/** The console page for one object or prefix, rather than for the bucket.
 *
 * The header's Launch button already opens the bucket root; landing there
 * after asking about a store six prefixes deep is a link that technically
 * works and practically doesn't. GCS's console distinguishes the two forms:
 * `browser/<bucket>/<prefix>` lists, `browser/_details/<bucket>/<object>`
 * opens one object's detail page.
 */
function consoleUrlFor(
  bucket: string,
  project: string,
  entry: DerivedEntry,
): string {
  const base = 'https://console.cloud.google.com/storage/browser';
  const path = entry.path.replace(/^\/+/, '');
  const suffix = project ? `?project=${encodeURIComponent(project)}` : '';
  return entry.isDir
    ? `${base}/${bucket}/${path}${suffix}`
    : `${base}/_details/${bucket}/${path}${suffix}`;
}

interface DerivedRowProps {
  entry: DerivedEntry;
  depth: number;
  expanded: boolean;
  busy: boolean;
  selected: boolean;
  /** Ticked as an input of the Pipelines card. */
  checked: boolean;
  bucket: string;
  project: string;
  /** For the cost column; null until read. */
  prices: Prices | null;
  onActivate: (event: React.MouseEvent) => void;
  onCheck: () => void;
  onRunPipeline: () => void;
  onRefresh: () => void;
  onError: (message: string) => void;
}

/** What an object costs to keep a month, at the prices in force. Folders and
    stores are blank here: their totals are in the Storage costs panel. */
function CostCell({ entry, prices }: { entry: DerivedEntry; prices: Prices | null }) {
  const theme = useTheme();
  const show = prices && !entry.isDir && entry.kind !== 'zarr' && entry.sizeBytes > 0;
  const month = show ? monthlyCost(entry.sizeBytes, entry.storageClass, prices) : 0;
  const cls = CLASS_LABEL[(entry.storageClass || 'STANDARD').toUpperCase()] ?? entry.storageClass;
  return (
    <Tooltip
      disableInteractive
      placement="left"
      title={
        show
          ? `${formatMoney(month, { exact: true })} a month · ${formatMoney(month * 12, { exact: true })} a year · ${formatBytes(entry.sizeBytes)}, ${cls}`
          : entry.kind === 'zarr'
            ? 'A store: its size and cost are in Storage costs (folder menu)'
            : ''
      }
    >
      <Typography
        sx={{
          width: panelColumns.cost,
          flexShrink: 0,
          textAlign: 'right',
          fontSize: panelDensity.font.meta,
          color: theme.aa.color.text.muted,
          fontVariantNumeric: 'tabular-nums',
          ...HIDE_COST,
        }}
      >
        {show ? formatMoney(month) : ''}
      </Typography>
    </Tooltip>
  );
}

/** One row of the bucket tree. A component for the same reason `FileRow` is:
    each row owns its own menu anchor, and hooks cannot run in a loop body. */
function DerivedRow({
  entry,
  depth,
  expanded,
  busy,
  selected,
  checked,
  bucket,
  project,
  prices,
  onActivate,
  onCheck,
  onRunPipeline,
  onRefresh,
  onError,
}: DerivedRowProps) {
  const theme = useTheme();
  const menu = useRowMenu();
  const { openPanel } = useLayout();

  const Icon = entry.isDir ? FolderOutlined : KIND_ICON[entry.kind];
  const isAsset = ASSET_KINDS.has(entry.kind);

  const copy = (value: string, what: string) => {
    void navigator.clipboard?.writeText(value).catch(() => {
      onError(`Could not reach the clipboard — select the ${what} instead.`);
    });
  };

  const actions: readonly RowAction[] = [
    ...(entry.isDir
      ? [
          {
            id: 'refresh',
            label: 'Refresh this folder',
            icon: RefreshOutlined,
            onSelect: onRefresh,
          },
          {
            id: 'costs',
            label: 'Storage cost of this folder',
            icon: SavingsOutlined,
            onSelect: () => {
              showCosts(entry.path);
              openPanel('costs');
            },
          },
        ]
      : [
          {
            id: 'pipeline',
            label: 'Run a pipeline on this',
            icon: AccountTreeOutlined,
            onSelect: onRunPipeline,
          },
          ...(opensAsEchogram(entry.productKind, entry.name)
            ? [
                {
                  id: 'echogram',
                  label: 'Open as echogram',
                  icon: WavesOutlined,
                  onSelect: () => {
                    void openEchogram(entry.uri);
                    openPanel('echogram');
                  },
                },
              ]
            : []),
          ...(isAnnotation(entry.productKind, entry.name) || entry.productKind === 'seafloor'
            ? [
                {
                  id: 'echogram',
                  label: 'Open on its echogram',
                  icon: WavesOutlined,
                  onSelect: () => {
                    openPanel('echogram');
                    openAnnotation(entry.uri).catch((e: unknown) =>
                      onError(e instanceof Error ? e.message : String(e)),
                    );
                  },
                },
              ]
            : []),
          ...(opensAsResults(entry.productKind, entry.name)
            ? [
                {
                  id: 'results',
                  label: 'Open results',
                  icon: TableChartOutlined,
                  onSelect: () => {
                    openResults(entry.uri);
                    openPanel('results');
                  },
                },
              ]
            : []),
          {
            id: 'inspect',
            label: 'Inspect metadata',
            icon: DataObjectOutlined,
            onSelect: () => {
              setActiveArtifact({ uri: entry.uri, label: entry.name, origin: 'Derived', kind: entry.kind });
              openPanel('metadata');
            },
          },
          {
            id: 'dataflow',
            label: 'Show its dataflow',
            icon: SchemaOutlined,
            onSelect: () => {
              setActiveArtifact({ uri: entry.uri, label: entry.name, origin: 'Derived', kind: entry.kind });
              openPanel('dataflow');
            },
          },
        ]),
    {
      id: 'copy-uri',
      label: 'Copy gs:// URI',
      icon: ContentCopyOutlined,
      dividerBefore: true,
      onSelect: () => copy(entry.uri, 'URI'),
    },
    {
      id: 'copy-path',
      label: 'Copy bucket path',
      icon: ContentCopyOutlined,
      onSelect: () => copy(entry.path, 'path'),
    },
    /* `aa-store` on a store, not on everything. Offering "inspect this PNG
       with aa-store" would put a command in the user's shell that exits
       non-zero, and a menu that suggests failing commands stops being read. */
    ...(entry.kind === 'zarr'
      ? [
          {
            id: 'aa-store',
            label: 'aa-store info in Terminal',
            icon: TerminalOutlined,
            onSelect: () => {
              sendToTerminal(`aa-store info ${quote(entry.uri)}`, {
                origin: 'Derived',
                execute: false,
              });
              openPanel('terminal');
            },
          },
        ]
      : []),
    {
      id: 'console',
      label: 'Open in Cloud console',
      icon: LaunchOutlined,
      dividerBefore: true,
      disabled: !bucket,
      disabledReason: 'The bucket is not reachable, so there is nothing to open.',
      onSelect: () => {
        window.open(
          consoleUrlFor(bucket, project, entry),
          '_blank',
          'noopener,noreferrer',
        );
      },
    },
  ];

  return (
    <>
      <Box
        title={entry.uri}
        data-path={entry.path}
        onClick={onActivate}
        onContextMenu={menu.onContextMenu}
        sx={{
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          height: panelDensity.rowHeight,
          pr: 0.5,
          pl: `${depth * 12 + 4}px`,
          cursor: 'pointer',
          userSelect: 'none',
          backgroundColor: checked
            ? theme.aa.color.bg.selected
            : selected
              ? theme.aa.color.bg.hover
              : 'transparent',
          boxShadow: checked ? `inset 2px 0 0 ${theme.aa.color.accent.main}` : 'none',
          '&:hover': {
            backgroundColor: checked ? theme.aa.color.bg.selected : theme.aa.color.bg.hover,
          },
          '&:hover .aa-copy': { opacity: 1 },
          '&:hover .aa-rowmenu': { opacity: 1 },
          '&:hover .aa-check': { opacity: 1 },
        }}
      >
        <Box sx={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
          {!entry.isDir && isAsset && (
            <Checkbox
              className="aa-check"
              size="small"
              checked={checked}
              onClick={(e) => e.stopPropagation()}
              onChange={onCheck}
              inputProps={{ 'aria-label': `Use ${entry.name} as a pipeline input` }}
              sx={{
                p: 0,
                ml: '-1px',
                opacity: checked ? 1 : 0,
                transition: 'opacity .12s',
                '&.Mui-focusVisible': { opacity: 1 },
                '& .MuiSvgIcon-root': { fontSize: 15 },
              }}
            />
          )}
          {entry.isDir &&
            (busy ? (
              <CircularProgress size={10} sx={{ ml: '2px' }} />
            ) : expanded ? (
              <ExpandMoreOutlined
                sx={{ fontSize: panelDensity.icon.chevron, color: theme.aa.color.text.muted }}
              />
            ) : (
              <ChevronRightOutlined
                sx={{ fontSize: panelDensity.icon.chevron, color: theme.aa.color.text.muted }}
              />
            ))}
        </Box>

        <Icon
          sx={{
            fontSize: panelDensity.icon.row,
            flexShrink: 0,
            color: isAsset ? theme.aa.color.accent.main : theme.aa.color.text.muted,
          }}
        />

        <Typography
          sx={{
            flex: 1,
            minWidth: 0,
            fontSize: panelDensity.font.row,
            color: theme.aa.color.text.primary,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {entry.name}
        </Typography>

        {entry.level && <LevelChip level={entry.level} />}
        <IntegrityMark intact={entry.intact === false ? false : null} />

        <Box
          sx={{
            width: HASH_COLUMN,
            ml: `${panelColumns.lead}px`,
            flexShrink: 0,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          {entry.productHash && <HashTag hash={entry.productHash} quiet />}
        </Box>

        <Typography
          sx={{
            width: panelColumns.size,
            flexShrink: 0,
            textAlign: 'right',
            fontSize: panelDensity.font.meta,
            color: theme.aa.color.text.muted,
            fontVariantNumeric: 'tabular-nums',
            ...HIDE_SIZE,
          }}
        >
          {entry.isDir ? '' : formatBytes(entry.sizeBytes)}
        </Typography>

        <CostCell entry={entry} prices={prices} />

        {/* Modified. GCS reports `updatedAt` on objects only — a common prefix
            is not a thing that has a timestamp, and neither is a store listed
            as a leaf, because that listing never enumerated its chunks. Those
            rows render blank rather than borrowing a number from somewhere
            plausible. */}
        <Tooltip
          title={modifiedTooltip(entry.updatedAt)}
          placement="left"
          disableInteractive
        >
          <Typography
            sx={{
              width: panelColumns.modified,
              flexShrink: 0,
              textAlign: 'right',
              fontSize: panelDensity.font.meta,
              color: theme.aa.color.text.muted,
              fontVariantNumeric: 'tabular-nums',
              ...HIDE_UPDATED,
            }}
          >
            {formatRelativeTime(entry.updatedAt)}
          </Typography>
        </Tooltip>

        <CopyPathButton value={entry.uri} label="Copy gs:// URI" />
        <RowMenuButton controller={menu} label={`Actions for ${entry.name}`} />
      </Box>

      <RowMenu controller={menu} actions={actions} />
    </>
  );
}

/**
 * Derived assets — the products pipelines write back to Google Cloud Storage.
 *
 * Same explorer model as the local Files panel, because a bucket's flat object
 * namespace is only navigable if you fold it into folders: the backend lists
 * with a delimiter, so each level is one request and nothing is enumerated
 * until it's opened.
 *
 * Right-click a row (or use the ⋮ at its right edge) for the same menu the
 * Files panel offers — but a *read-only* one. That is not an oversight and not
 * a thing to fill in later: `/api/derived` has no mutating route at all, and
 * the reason is that these objects are pipeline output. A store deleted here
 * is a store some run has to produce again, and the bucket's own console
 * already offers deletion to anyone whose IAM role permits it. So the menu
 * carries no Delete item rather than a disabled one — a disabled item promises
 * the action is coming, and it is not.
 *
 * What the menu does carry is the four things a reader of this panel actually
 * wants and currently has to assemble by hand: the `gs://` URI, the console
 * link for *this* object rather than the bucket, the metadata inspection this
 * panel already feeds, and an `aa-store` command typed into the terminal.
 */
/** The last "show in bucket" request acted on, across mounts of the panel. */
let revealedNonce = 0;

export const DerivedPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const { openPanel } = useLayout();
  const { inputs } = usePipelines();
  const chosen = useMemo(() => new Set(inputs.map((i) => i.uri)), [inputs]);

  const [status, setStatus] = useState<DerivedStatus | null>(null);
  const [children, setChildren] = useState<Record<string, DerivedEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  /** Bumped when the bucket is listed afresh: answers for an older listing
   *  (the previous bucket, after the project changed) are dropped. */
  const generation = useRef(0);

  const fetchPrefix = useCallback(async (prefix: string) => {
    const mine = generation.current;
    setLoading((s) => new Set(s).add(prefix));
    try {
      const listing = await derivedApi.list(prefix);
      if (mine !== generation.current) return;
      setChildren((c) => ({ ...c, [prefix]: listing.entries }));
      setError('');
    } catch (e) {
      if (mine !== generation.current) return;
      setError(e instanceof Error ? e.message : 'Could not list the bucket.');
    } finally {
      setLoading((s) => {
        const next = new Set(s);
        next.delete(prefix);
        return next;
      });
    }
  }, []);

  const load = useCallback(async () => {
    const mine = ++generation.current;
    setChildren({});
    setExpanded(new Set());
    try {
      const next = await derivedApi.getStatus();
      if (mine !== generation.current) return;
      setStatus(next);
      if (next.available) {
        setError('');
        await fetchPrefix('');
      } else {
        setError(next.detail);
      }
    } catch (e) {
      if (mine !== generation.current) return;
      setError(e instanceof Error ? e.message : 'Could not reach the API.');
    }
  }, [fetchPrefix]);

  useEffect(() => {
    void load();
  }, [load]);
  // A new project or bucket was chosen: list that one.
  useEffect(() => onGcpChange(() => void load()), [load]);

  /* "Show in bucket" from elsewhere (the Prepare card's results): list each
     folder down to the object afresh — it is new since this panel last looked
     — open them, and select it. */
  const reveal = useRevealRequest();
  const listRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!reveal || !status?.available || reveal.nonce <= revealedNonce) return;
    revealedNonce = reveal.nonce; // a remount must not replay an old request
    const root = `gs://${status.bucket}/${status.prefix}`;
    if (!reveal.uri.startsWith(root)) {
      setError(`${reveal.uri} is outside the bucket this panel shows (${root}).`);
      return;
    }
    const target = reveal.uri.slice(root.length).replace(/\/$/, '');
    const parts = target.split('/');
    const folders = parts.slice(0, -1).map((_, i) => `${parts.slice(0, i + 1).join('/')}/`);
    let live = true;
    void (async () => {
      await fetchPrefix('');
      for (const folder of folders) {
        if (!live) return;
        await fetchPrefix(folder);
      }
      if (!live) return;
      setQuery('');
      setExpanded((current) => new Set([...current, ...folders]));
      setSelected(target);
      requestAnimationFrame(() => {
        listRef.current
          ?.querySelector(`[data-path="${CSS.escape(target)}"]`)
          ?.scrollIntoView({ block: 'center' });
      });
    })();
    return () => {
      live = false;
    };
    // Keyed on the request, not the listing it causes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal?.nonce, status?.available]);

  const toggle = useCallback(
    (entry: DerivedEntry) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
          if (!children[entry.path]) void fetchPrefix(entry.path);
        }
        return next;
      });
    },
    [children, fetchPrefix],
  );

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = (entry: DerivedEntry): boolean => {
      if (!q) return true;
      if (entry.name.toLowerCase().includes(q)) return true;
      return (children[entry.path] ?? []).some(matches);
    };
    const walk = (prefix: string, depth: number): Row[] =>
      (children[prefix] ?? []).filter(matches).flatMap((entry) => {
        const row: Row = { entry, depth };
        const open = expanded.has(entry.path) || (q && children[entry.path]);
        return entry.isDir && open ? [row, ...walk(entry.path, depth + 1)] : [row];
      });
    return walk('', 0);
  }, [children, expanded, query]);

  const busy = loading.has('');
  const costs = useCosts();
  useEffect(() => initCosts(), []);

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 0,
        containerType: 'inline-size',
        containerName: 'products',
      }}
    >
      <PanelHeader
        icon={<LayersOutlined className="panel-header-icon" />}
        title="Products"
        subtitle={
          <span title={status ? `gs://${status.bucket}/${status.prefix}` : ''}>
            {status ? (status.bucket ? `gs://${status.bucket}/${status.prefix}` : 'no bucket chosen') : 'connecting…'}
          </span>
        }
        actions={
          <>
            <Tooltip title="Collapse all">
              <IconButton size="small" onClick={() => setExpanded(new Set())}>
                <UnfoldLessOutlined sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
            <Tooltip title="Refresh">
              <IconButton size="small" onClick={() => void load()}>
                <RefreshOutlined sx={{ fontSize: 15 }} />
              </IconButton>
            </Tooltip>
            {status?.consoleUrl && (
              <Tooltip title="Open in Google Cloud console">
                <IconButton
                  size="small"
                  onClick={() => window.open(status.consoleUrl, '_blank', 'noopener,noreferrer')}
                >
                  <LaunchOutlined sx={{ fontSize: 14 }} />
                </IconButton>
              </Tooltip>
            )}
          </>
        }
      />

      <PanelBar sx={{ px: 1 }}>
        <SearchOutlined sx={{ fontSize: 14, color: theme.aa.color.text.muted }} />
        <InputBase
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter"
          inputProps={{ 'aria-label': 'Filter the products' }}
          sx={{ flex: 1, fontSize: 12, color: theme.aa.color.text.primary }}
        />
        {busy && <CircularProgress size={11} />}
        {inputs.length > 0 && (
          <Tooltip title="The products the Pipelines card runs on. Click to clear.">
            <Box
              component="button"
              type="button"
              onClick={() => setInputs([])}
              sx={{
                border: 'none',
                cursor: 'pointer',
                font: 'inherit',
                fontSize: 10.5,
                fontWeight: 600,
                px: 0.75,
                height: 18,
                borderRadius: 9,
                color: theme.aa.color.accent.main,
                backgroundColor: alpha(theme.aa.color.accent.main, 0.14),
              }}
            >
              {inputs.length} selected
            </Box>
          </Tooltip>
        )}
      </PanelBar>

      {/* The bucket isn't reachable — say why, and what to do about it. */}
      {status && !status.available ? (
        <Box sx={{ p: 1.5 }}>
          <Typography sx={{ fontSize: 12, color: theme.aa.color.status.warning, mb: 1 }}>
            {status.detail || 'The derived-assets bucket is not reachable.'}
          </Typography>
          <Typography sx={{ fontSize: 11, color: theme.aa.color.text.muted, mb: 1.5 }}>
            gs://{status.bucket}
          </Typography>
          {!status.configured ? (
            <Button
              size="small"
              variant="outlined"
              onClick={() => openDialog('gcp')}
              sx={{ fontSize: 11.5, textTransform: 'none', mr: 1 }}
            >
              Choose a project and bucket
            </Button>
          ) : (
            <>
              <Button
                size="small"
                variant="outlined"
                onClick={() => void load()}
                sx={{ fontSize: 11.5, textTransform: 'none', mr: 1 }}
              >
                Retry
              </Button>
              <Button
                size="small"
                onClick={() => openDialog('gcp')}
                sx={{ fontSize: 11.5, textTransform: 'none', mr: 1 }}
              >
                Choose another
              </Button>
            </>
          )}
          {status.consoleUrl && (
            <Button
              size="small"
              onClick={() =>
                window.open(status.consoleUrl, '_blank', 'noopener,noreferrer')
              }
              sx={{ fontSize: 11.5, textTransform: 'none' }}
            >
              Open in console
            </Button>
          )}
        </Box>
      ) : (
        <>
          {error && (
            <Typography
              sx={{ px: 1.25, py: 1, fontSize: 11.5, color: theme.aa.color.status.error }}
            >
              {error}
            </Typography>
          )}

          {/* Column header — matches the Files panel's, so the two trees read
              as one component on different storage. */}
          <Box
            sx={{
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
              pr: 0.5,
              pl: '4px',
              height: 18,
              flexShrink: 0,
              borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
              color: theme.aa.color.text.muted,
              fontSize: 9.5,
              letterSpacing: 0.5,
              textTransform: 'uppercase',
              userSelect: 'none',
            }}
          >
            <Box sx={{ width: 16, flexShrink: 0 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>Name</Box>
            <Tooltip
              disableInteractive
              title="The product hash the console tools recorded: the same hash, the same science. Click one to copy it whole."
            >
              <Box sx={{ width: HASH_COLUMN, ml: `${panelColumns.lead}px`, flexShrink: 0, textAlign: 'right' }}>
                Hash
              </Box>
            </Tooltip>
            <Box sx={{ width: panelColumns.size, flexShrink: 0, textAlign: 'right', ...HIDE_SIZE }}>Size</Box>
            <Tooltip
              disableInteractive
              title={
                costs.prices
                  ? `Estimated storage cost a month: the object's size times ${
                      costs.prices.custom !== null ? costs.prices.customLabel || 'our own price' : "Google's list price"
                    } for its storage class (Standard ${formatRate(costs.prices.perGiBMonth.STANDARD ?? 0)}). Storage only; see Storage costs for folders and totals.`
                  : 'Estimated storage cost a month'
              }
            >
              <Box sx={{ width: panelColumns.cost, flexShrink: 0, textAlign: 'right', ...HIDE_COST }}>$/month</Box>
            </Tooltip>
            <Box sx={{ width: panelColumns.modified, flexShrink: 0, textAlign: 'right', ...HIDE_UPDATED }}>
              Updated
            </Box>
            <Box sx={{ width: panelColumns.actions, flexShrink: 0 }} />
          </Box>

          <Box ref={listRef} sx={{ flex: 1, overflow: 'auto', minHeight: 0, py: 0.25 }}>
            {rows.map(({ entry, depth }) => (
              <DerivedRow
                key={entry.path}
                entry={entry}
                depth={depth}
                expanded={expanded.has(entry.path)}
                busy={loading.has(entry.path)}
                selected={selected === entry.path}
                checked={chosen.has(entry.uri)}
                bucket={status?.bucket ?? ''}
                project={status?.project ?? ''}
                prices={costs.prices}
                onCheck={() => toggleInput(refOf(entry))}
                onRunPipeline={() => {
                  setInputs([refOf(entry)]);
                  openPanel('pipelines');
                }}
                onActivate={(event) => {
                  setSelected(entry.path);
                  if (entry.isDir) {
                    toggle(entry);
                    return;
                  }
                  /* A product is the Pipelines card's input: a click makes it
                     the one, Ctrl/Cmd-click (or its tick box) adds it to the
                     ones. */
                  if (ASSET_KINDS.has(entry.kind)) {
                    if (event.ctrlKey || event.metaKey) toggleInput(refOf(entry));
                    // Several ticked: a plain click only inspects; the ticks stay.
                    else if (inputs.length < 2) setInputs([refOf(entry)]);
                  }
                  /* Publish to the right dock. A store selected here is the
                     artifact of the entire acquire → convert → assemble
                     sector, and until this line existed clicking it changed
                     nothing anywhere. The URI, not the path: a bare
                     path resolves against whatever directory the reader
                     happens to be standing in. */
                  setActiveArtifact({
                    uri: entry.uri,
                    label: entry.name,
                    origin: 'Derived',
                    kind: entry.kind,
                  });
                }}
                onRefresh={() => void fetchPrefix(entry.isDir ? entry.path : '')}
                onError={setError}
              />
            ))}

            {!busy && rows.length === 0 && !error && (
              <Typography
                sx={{
                  p: 1.5,
                  fontSize: 11.5,
                  color: theme.aa.color.text.muted,
                  textAlign: 'center',
                }}
              >
                {query ? `Nothing matches “${query}”.` : 'No products here yet.'}
              </Typography>
            )}
          </Box>
        </>
      )}
    </Box>
  );
};
