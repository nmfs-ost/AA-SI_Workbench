import { useCallback, useEffect, useMemo, useState } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import {
  Box,
  CircularProgress,
  IconButton,
  InputBase,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Select,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  ArrowUpwardOutlined,
  ContentCopyOutlined,
  DescriptionOutlined,
  FolderOutlined,
  GridOnOutlined,
  ImageOutlined,
  InsightsOutlined,
  RefreshOutlined,
  SearchOutlined,
  VisibilityOffOutlined,
  VisibilityOutlined,
} from '@mui/icons-material';

import { filesApi } from '../../services/filesApi';
import type { FsEntry, FsKind, FsListing, FsRoot } from '../../services/filesApi';

/** Icon per asset kind, so raw/NetCDF stand out from ordinary files. */
const KIND_ICON: Record<FsKind, typeof FolderOutlined> = {
  folder: FolderOutlined,
  raw: InsightsOutlined,
  netcdf: GridOnOutlined,
  zarr: GridOnOutlined,
  table: GridOnOutlined,
  region: DescriptionOutlined,
  image: ImageOutlined,
  text: DescriptionOutlined,
  file: DescriptionOutlined,
};

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

function formatDate(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * The workstation's own filesystem.
 *
 * The Workbench runs on the machine that holds the data, so this is a direct
 * view of it rather than a catalogue: the roots are discovered from the server
 * (home, working directory, and any `<Ship>_<Survey>_<Sonar>_NCEI` folder
 * aa-raw left behind), and everything below is read live.
 *
 * Read-only by design. Browsing and handing a path to a pipeline is the job;
 * creating and deleting files belongs in the terminal, where the user can see
 * exactly what they are doing.
 */
export const FilesPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();

  const [roots, setRoots] = useState<FsRoot[]>([]);
  const [listing, setListing] = useState<FsListing | null>(null);
  const [path, setPath] = useState('');
  const [query, setQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');

  const load = useCallback(
    async (target: string, hidden: boolean) => {
      setLoading(true);
      setError('');
      try {
        const next = await filesApi.list(target, hidden);
        setListing(next);
        setPath(next.path);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not read that directory.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const discovered = await filesApi.roots();
        if (cancelled) return;
        setRoots(discovered);
        await load(discovered[0]?.path ?? '', false);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not reach the API.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const entries = useMemo(() => {
    const all = listing?.entries ?? [];
    const q = query.trim().toLowerCase();
    return q ? all.filter((e) => e.name.toLowerCase().includes(q)) : all;
  }, [listing, query]);

  const copyPath = useCallback(async (entry: FsEntry) => {
    try {
      await navigator.clipboard.writeText(entry.path);
      setCopied(entry.path);
      window.setTimeout(() => setCopied(''), 1500);
    } catch {
      // Clipboard is unavailable over plain http on some hosts; the path is
      // still visible in the row, so this is a convenience, not a dependency.
    }
  }, []);

  const rootLabel =
    roots.find((r) => r.path === listing?.path)?.label ?? '';

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Root selector + navigation */}
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
        <Select
          size="small"
          value={roots.some((r) => r.path === path) ? path : ''}
          displayEmpty
          onChange={(e) => void load(e.target.value, showHidden)}
          sx={{ flex: 1, fontSize: 12, '& .MuiSelect-select': { py: 0.35 } }}
        >
          <MenuItem value="" disabled sx={{ fontSize: 12 }}>
            {rootLabel || 'Browse…'}
          </MenuItem>
          {roots.map((r) => (
            <MenuItem key={r.path} value={r.path} sx={{ fontSize: 12 }}>
              {r.label}
            </MenuItem>
          ))}
        </Select>

        <Tooltip title="Up one level">
          <span>
            <IconButton
              size="small"
              disabled={!listing?.parent}
              onClick={() => void load(listing?.parent ?? '', showHidden)}
            >
              <ArrowUpwardOutlined sx={{ fontSize: 16 }} />
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}>
          <IconButton
            size="small"
            onClick={() => {
              const next = !showHidden;
              setShowHidden(next);
              void load(path, next);
            }}
          >
            {showHidden ? (
              <VisibilityOutlined sx={{ fontSize: 16 }} />
            ) : (
              <VisibilityOffOutlined sx={{ fontSize: 16 }} />
            )}
          </IconButton>
        </Tooltip>
        <Tooltip title="Refresh">
          <IconButton size="small" onClick={() => void load(path, showHidden)}>
            <RefreshOutlined sx={{ fontSize: 16 }} />
          </IconButton>
        </Tooltip>
      </Box>

      {/* Current path — the ground truth for anything you copy into a pipeline */}
      <Typography
        title={path}
        sx={{
          px: 1.25,
          py: 0.5,
          fontFamily: theme.aa.font.mono,
          fontSize: 11,
          color: theme.aa.color.text.muted,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          direction: 'rtl',
          textAlign: 'left',
          borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
        }}
      >
        {path || '—'}
      </Typography>

      {/* Filter */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          py: 0.5,
          borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
        }}
      >
        <SearchOutlined sx={{ fontSize: 15, color: theme.aa.color.text.muted }} />
        <InputBase
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter this folder"
          sx={{ flex: 1, fontSize: 12, color: theme.aa.color.text.primary }}
        />
        {loading && <CircularProgress size={12} />}
      </Box>

      {error ? (
        <Typography
          sx={{ p: 1.5, fontSize: 12, color: theme.aa.color.status.error }}
        >
          {error}
        </Typography>
      ) : (
        <List dense disablePadding sx={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
          {entries.map((entry) => {
            const Icon = KIND_ICON[entry.kind] ?? DescriptionOutlined;
            const meta = [
              entry.isDir
                ? entry.childCount >= 0
                  ? `${entry.childCount} item${entry.childCount === 1 ? '' : 's'}`
                  : ''
                : formatBytes(entry.sizeBytes),
              formatDate(entry.modifiedAt),
            ]
              .filter(Boolean)
              .join(' · ');

            return (
              <ListItemButton
                key={entry.path}
                dense
                onClick={() => entry.isDir && void load(entry.path, showHidden)}
                sx={{ py: 0.25, pl: 1.25, pr: 0.5 }}
              >
                <Icon
                  sx={{
                    fontSize: 15,
                    mr: 1,
                    flexShrink: 0,
                    color:
                      entry.kind === 'raw' || entry.kind === 'netcdf' || entry.kind === 'zarr'
                        ? theme.aa.color.accent.main
                        : theme.aa.color.text.muted,
                  }}
                />
                <ListItemText
                  primary={entry.name}
                  secondary={meta || undefined}
                  primaryTypographyProps={{
                    sx: {
                      fontFamily: theme.aa.font.mono,
                      fontSize: 12,
                      color: theme.aa.color.text.primary,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    },
                  }}
                  secondaryTypographyProps={{
                    sx: { fontSize: 11, color: theme.aa.color.text.muted },
                  }}
                />
                <Tooltip title={copied === entry.path ? 'Copied' : 'Copy path'}>
                  <IconButton
                    size="small"
                    onClick={(e) => {
                      e.stopPropagation();
                      void copyPath(entry);
                    }}
                    sx={{ ml: 0.5, flexShrink: 0 }}
                  >
                    <ContentCopyOutlined sx={{ fontSize: 13 }} />
                  </IconButton>
                </Tooltip>
              </ListItemButton>
            );
          })}

          {!loading && entries.length === 0 && (
            <Typography
              sx={{
                p: 1.5,
                fontSize: 12,
                color: theme.aa.color.text.muted,
                textAlign: 'center',
              }}
            >
              {query ? `Nothing matches “${query}”.` : 'This folder is empty.'}
            </Typography>
          )}

          {listing?.truncated && (
            <Typography
              sx={{
                px: 1.5,
                py: 1,
                fontSize: 11,
                color: theme.aa.color.status.warning,
              }}
            >
              Listing truncated — this folder has more entries than are shown.
            </Typography>
          )}
        </List>
      )}
    </Box>
  );
};
