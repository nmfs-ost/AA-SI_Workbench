import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputBase,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  ChevronRightOutlined,
  CloudOutlined,
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
} from '@mui/icons-material';

import { CopyPathButton } from './CopyPathButton';
import { RowMenu, RowMenuButton, useRowMenu, type RowAction } from './RowMenu';
import { derivedApi } from '../../services/derivedApi';
import type { DerivedEntry, DerivedKind, DerivedStatus } from '../../services/derivedApi';
import { useLayout } from '../../context/LayoutContext';
import { setActiveArtifact } from '../../state/activeSubject';
import { sendToTerminal } from '../../state/terminal';
import { panelColumns, panelDensity } from './panelStyles';
import { formatBytes, formatRelativeTime, modifiedTooltip } from './rowFormat';
import { quote } from './shellQuote';

const KIND_ICON: Record<DerivedKind, typeof FolderOutlined> = {
  folder: FolderOutlined,
  netcdf: GridOnOutlined,
  zarr: GridOnOutlined,
  raw: InsightsOutlined,
  table: GridOnOutlined,
  region: DescriptionOutlined,
  image: ImageOutlined,
  text: DescriptionOutlined,
  object: DescriptionOutlined,
};

const ASSET_KINDS = new Set<DerivedKind>(['netcdf', 'zarr', 'raw']);

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
  bucket: string;
  project: string;
  onActivate: () => void;
  onRefresh: () => void;
  onError: (message: string) => void;
}

/** One row of the bucket tree. A component for the same reason `FileRow` is:
    each row owns its own menu anchor, and hooks cannot run in a loop body. */
function DerivedRow({
  entry,
  depth,
  expanded,
  busy,
  selected,
  bucket,
  project,
  onActivate,
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
        ]
      : [
          {
            id: 'inspect',
            label: 'Inspect metadata',
            icon: DataObjectOutlined,
            onSelect: () => {
              onActivate();
              openPanel('metadata');
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
        onClick={onActivate}
        onContextMenu={menu.onContextMenu}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          height: panelDensity.rowHeight,
          pr: 0.5,
          pl: `${depth * 12 + 4}px`,
          cursor: 'pointer',
          userSelect: 'none',
          backgroundColor: selected ? theme.aa.color.bg.chrome : 'transparent',
          '&:hover': { backgroundColor: theme.aa.color.bg.chrome },
          '&:hover .aa-copy': { opacity: 1 },
          '&:hover .aa-rowmenu': { opacity: 1 },
        }}
      >
        <Box sx={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
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
            fontFamily: isAsset ? theme.aa.font.mono : undefined,
            color: theme.aa.color.text.primary,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {entry.name}
        </Typography>

        <Typography
          sx={{
            width: panelColumns.size,
            ml: `${panelColumns.lead}px`,
            flexShrink: 0,
            textAlign: 'right',
            fontSize: panelDensity.font.meta,
            color: theme.aa.color.text.muted,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {entry.isDir ? '' : formatBytes(entry.sizeBytes)}
        </Typography>

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
export const DerivedPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();

  const [status, setStatus] = useState<DerivedStatus | null>(null);
  const [children, setChildren] = useState<Record<string, DerivedEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');

  const fetchPrefix = useCallback(async (prefix: string) => {
    setLoading((s) => new Set(s).add(prefix));
    try {
      const listing = await derivedApi.list(prefix);
      setChildren((c) => ({ ...c, [prefix]: listing.entries }));
      setError('');
    } catch (e) {
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
    setChildren({});
    setExpanded(new Set());
    try {
      const next = await derivedApi.getStatus();
      setStatus(next);
      if (next.available) {
        setError('');
        await fetchPrefix('');
      } else {
        setError(next.detail);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the API.');
    }
  }, [fetchPrefix]);

  useEffect(() => {
    void load();
  }, [load]);

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

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Bucket header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
        }}
      >
        <CloudOutlined sx={{ fontSize: 14, color: theme.aa.color.text.muted }} />
        <Typography
          title={status ? `gs://${status.bucket}/${status.prefix}` : ''}
          sx={{
            flex: 1,
            minWidth: 0,
            fontSize: 11.5,
            fontFamily: theme.aa.font.mono,
            color: theme.aa.color.text.secondary,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {status ? status.bucket : 'connecting…'}
        </Typography>
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
              onClick={() =>
                window.open(status.consoleUrl, '_blank', 'noopener,noreferrer')
              }
            >
              <LaunchOutlined sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* Filter */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          py: 0.4,
          borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
        }}
      >
        <SearchOutlined sx={{ fontSize: 14, color: theme.aa.color.text.muted }} />
        <InputBase
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter"
          sx={{ flex: 1, fontSize: 12, color: theme.aa.color.text.primary }}
        />
        {busy && <CircularProgress size={11} />}
      </Box>

      {/* The bucket isn't reachable — say why, and what to do about it. */}
      {status && !status.available ? (
        <Box sx={{ p: 1.5 }}>
          <Typography sx={{ fontSize: 12, color: theme.aa.color.status.warning, mb: 1 }}>
            {status.detail || 'The derived-assets bucket is not reachable.'}
          </Typography>
          <Typography
            sx={{
              fontSize: 11,
              fontFamily: theme.aa.font.mono,
              color: theme.aa.color.text.muted,
              mb: 1.5,
            }}
          >
            gs://{status.bucket}
          </Typography>
          <Button
            size="small"
            variant="outlined"
            onClick={() => void load()}
            sx={{ fontSize: 11.5, textTransform: 'none', mr: 1 }}
          >
            Retry
          </Button>
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
            <Box
              sx={{
                width: panelColumns.size,
                ml: `${panelColumns.lead}px`,
                flexShrink: 0,
                textAlign: 'right',
              }}
            >
              Size
            </Box>
            <Box sx={{ width: panelColumns.modified, flexShrink: 0, textAlign: 'right' }}>
              Updated
            </Box>
            <Box sx={{ width: panelColumns.actions, flexShrink: 0 }} />
          </Box>

          <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0, py: 0.25 }}>
            {rows.map(({ entry, depth }) => (
              <DerivedRow
                key={entry.path}
                entry={entry}
                depth={depth}
                expanded={expanded.has(entry.path)}
                busy={loading.has(entry.path)}
                selected={selected === entry.path}
                bucket={status?.bucket ?? ''}
                project={status?.project ?? ''}
                onActivate={() => {
                  setSelected(entry.path);
                  if (entry.isDir) {
                    toggle(entry);
                    return;
                  }
                  /* Publish to the right dock. A store selected here is the
                     artifact of the entire acquire → convert → assemble
                     sector, and until this line existed clicking it changed
                     nothing anywhere — the Metadata panel could only ever be
                     about an NCEI raw file. The URI, not the path: a bare
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
                {query ? `Nothing matches “${query}”.` : 'No derived assets yet.'}
              </Typography>
            )}
          </Box>
        </>
      )}
    </Box>
  );
};
