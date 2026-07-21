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
  DescriptionOutlined,
  ExpandMoreOutlined,
  FolderOutlined,
  GridOnOutlined,
  ImageOutlined,
  InsightsOutlined,
  LaunchOutlined,
  RefreshOutlined,
  SearchOutlined,
  UnfoldLessOutlined,
} from '@mui/icons-material';

import { CopyPathButton } from './CopyPathButton';
import { derivedApi } from '../../services/derivedApi';
import type { DerivedEntry, DerivedKind, DerivedStatus } from '../../services/derivedApi';

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

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

interface Row {
  entry: DerivedEntry;
  depth: number;
}

/**
 * Derived assets — the products pipelines write back to Google Cloud Storage.
 *
 * Same explorer model as the local Files panel, because a bucket's flat object
 * namespace is only navigable if you fold it into folders: the backend lists
 * with a delimiter, so each level is one request and nothing is enumerated
 * until it's opened.
 *
 * Read-only. Producing derived assets is the pipelines' job; putting delete one
 * misclick from a listing would be a poor trade.
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

          <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0, py: 0.25 }}>
            {rows.map(({ entry, depth }) => {
              const Icon = entry.isDir ? FolderOutlined : KIND_ICON[entry.kind];
              const open = expanded.has(entry.path);
              const rowBusy = loading.has(entry.path);

              return (
                <Box
                  key={entry.path}
                  title={entry.uri}
                  onClick={() => {
                    setSelected(entry.path);
                    if (entry.isDir) toggle(entry);
                  }}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    height: 22,
                    pr: 0.5,
                    pl: `${depth * 12 + 4}px`,
                    cursor: 'pointer',
                    userSelect: 'none',
                    backgroundColor:
                      selected === entry.path
                        ? theme.aa.color.bg.chrome
                        : 'transparent',
                    '&:hover': { backgroundColor: theme.aa.color.bg.chrome },
                    '&:hover .aa-copy': { opacity: 1 },
                  }}
                >
                  <Box
                    sx={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center' }}
                  >
                    {entry.isDir &&
                      (rowBusy ? (
                        <CircularProgress size={10} sx={{ ml: '2px' }} />
                      ) : open ? (
                        <ExpandMoreOutlined
                          sx={{ fontSize: 16, color: theme.aa.color.text.muted }}
                        />
                      ) : (
                        <ChevronRightOutlined
                          sx={{ fontSize: 16, color: theme.aa.color.text.muted }}
                        />
                      ))}
                  </Box>

                  <Icon
                    sx={{
                      fontSize: 14,
                      flexShrink: 0,
                      color: ASSET_KINDS.has(entry.kind)
                        ? theme.aa.color.accent.main
                        : theme.aa.color.text.muted,
                    }}
                  />

                  <Typography
                    sx={{
                      flex: 1,
                      minWidth: 0,
                      fontSize: 12,
                      fontFamily: ASSET_KINDS.has(entry.kind)
                        ? theme.aa.font.mono
                        : undefined,
                      color: theme.aa.color.text.primary,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {entry.name}
                  </Typography>

                  {!entry.isDir && entry.sizeBytes > 0 && (
                    <Typography
                      sx={{
                        fontSize: 10.5,
                        color: theme.aa.color.text.muted,
                        flexShrink: 0,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {formatBytes(entry.sizeBytes)}
                    </Typography>
                  )}

                  <CopyPathButton value={entry.uri} label="Copy gs:// URI" />
                </Box>
              );
            })}

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
