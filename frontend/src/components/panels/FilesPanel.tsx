import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import {
  Box,
  CircularProgress,
  IconButton,
  InputBase,
  MenuItem,
  Select,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  ArticleOutlined,
  ChevronRightOutlined,
  CodeOutlined,
  DescriptionOutlined,
  ExpandMoreOutlined,
  FolderOutlined,
  GridOnOutlined,
  ImageOutlined,
  InsightsOutlined,
  MenuBookOutlined,
  NoteAddOutlined,
  RefreshOutlined,
  SearchOutlined,
  UnfoldLessOutlined,
  VisibilityOffOutlined,
  VisibilityOutlined,
} from '@mui/icons-material';

import { filesApi } from '../../services/filesApi';
import type { FsEntry, FsKind, FsRoot } from '../../services/filesApi';
import { openDialog } from '../../state/dialogs';
import { openFile } from '../../state/editors';
import {
  clearReveal,
  setCurrentDirectory,
  useFileBrowser,
} from '../../state/fileBrowser';
import { CopyPathButton } from './CopyPathButton';
import { isOpenable } from './editor/language';
import { dirname } from './editor/paths';

const KIND_ICON: Record<FsKind, typeof FolderOutlined> = {
  folder: FolderOutlined,
  raw: InsightsOutlined,
  netcdf: GridOnOutlined,
  zarr: GridOnOutlined,
  table: GridOnOutlined,
  region: DescriptionOutlined,
  image: ImageOutlined,
  text: DescriptionOutlined,
  python: CodeOutlined,
  notebook: MenuBookOutlined,
  markdown: ArticleOutlined,
  file: DescriptionOutlined,
};

/** Kinds the acoustics workflow acts on — tinted so they're findable at a glance. */
const ASSET_KINDS = new Set<FsKind>(['raw', 'netcdf', 'zarr']);

function formatBytes(bytes: number): string {
  if (bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** i;
  return `${value >= 10 || i === 0 ? Math.round(value) : value.toFixed(1)} ${units[i]}`;
}

interface Row {
  entry: FsEntry;
  depth: number;
}

/**
 * The workstation's filesystem, as an explorer tree.
 *
 * Folders expand in place rather than replacing the view, so context is never
 * lost — the same model as an IDE explorer. Children are fetched lazily on
 * first expand and cached, because a home directory with a season of survey
 * data is far too large to walk eagerly.
 *
 * Clicking a file opens it in the centre, where anything readable as text — a
 * script, a config, a notebook, a CSV — can be read and edited without leaving
 * the Workbench. The scientific binaries (.raw, .nc, .zarr) select but don't
 * open: there is nothing in them a text view could honestly show, and a tab
 * saying so on every click would be worse than no tab.
 *
 * Creating is here too, but deleting and renaming still aren't. Destructive
 * operations one misclick away from a file listing are a poor trade, and the
 * terminal is right there for them.
 */
export const FilesPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const browser = useFileBrowser();

  const [roots, setRoots] = useState<FsRoot[]>([]);
  const [rootPath, setRootPath] = useState('');
  const [children, setChildren] = useState<Record<string, FsEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState('');
  const lastRefreshRef = useRef(browser.refreshToken);

  const fetchChildren = useCallback(
    async (path: string, hidden: boolean) => {
      setLoading((s) => new Set(s).add(path));
      try {
        const listing = await filesApi.list(path, hidden);
        setChildren((c) => ({ ...c, [listing.path]: listing.entries }));
        setError('');
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not read that directory.');
      } finally {
        setLoading((s) => {
          const next = new Set(s);
          next.delete(path);
          return next;
        });
      }
    },
    [],
  );

  /* Discover roots once, then open the first one. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const discovered = await filesApi.roots();
        if (cancelled || discovered.length === 0) return;
        setRoots(discovered);
        setRootPath(discovered[0].path);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Could not reach the API.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Changing root (or the hidden toggle) invalidates everything below it. */
  useEffect(() => {
    if (!rootPath) return;
    setChildren({});
    setExpanded(new Set());
    void fetchChildren(rootPath, showHidden);
  }, [rootPath, showHidden, fetchChildren]);

  const toggle = useCallback(
    (entry: FsEntry) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(entry.path)) {
          next.delete(entry.path);
        } else {
          next.add(entry.path);
          if (!children[entry.path]) void fetchChildren(entry.path, showHidden);
        }
        return next;
      });
    },
    [children, fetchChildren, showHidden],
  );

  /* The tree, flattened in display order. Filtering keeps a folder whenever any
     loaded descendant matches, so matches stay in context instead of appearing
     as a rootless list. */
  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();

    const matches = (entry: FsEntry): boolean => {
      if (!q) return true;
      if (entry.name.toLowerCase().includes(q)) return true;
      return (children[entry.path] ?? []).some(matches);
    };

    const walk = (path: string, depth: number): Row[] =>
      (children[path] ?? []).filter(matches).flatMap((entry) => {
        const row: Row = { entry, depth };
        const open = expanded.has(entry.path) || (q && children[entry.path]);
        return entry.isDir && open ? [row, ...walk(entry.path, depth + 1)] : [row];
      });

    return walk(rootPath, 0);
  }, [children, expanded, query, rootPath]);

  /* Something was created elsewhere (the New dialog): re-read the folder it
     landed in and select it, so the tree shows the result of the action. */
  useEffect(() => {
    if (browser.refreshToken === lastRefreshRef.current) return;
    lastRefreshRef.current = browser.refreshToken;

    const reveal = browser.revealPath;
    const folder = reveal ? dirname(reveal) : rootPath;
    if (!folder) return;

    void fetchChildren(folder, showHidden).then(() => {
      if (!reveal) return;
      setExpanded((current) => new Set(current).add(folder));
      setSelected(reveal);
      clearReveal();
    });
  }, [browser.refreshToken, browser.revealPath, fetchChildren, rootPath, showHidden]);

  /* Publish where we're looking, so File ▸ New knows where to put things. */
  const currentDirectory = useMemo(() => {
    if (!selected) return rootPath;
    const entry = Object.values(children)
      .flat()
      .find((candidate) => candidate.path === selected);
    if (entry?.isDir) return entry.path;
    return dirname(selected) || rootPath;
  }, [children, rootPath, selected]);

  useEffect(() => {
    if (currentDirectory) setCurrentDirectory(currentDirectory);
  }, [currentDirectory]);

  /* A click on a file is a request to read it. Folders toggle instead. */
  const handleActivate = useCallback((entry: FsEntry) => {
    setSelected(entry.path);
    if (!entry.isDir && isOpenable(entry.kind, entry.path)) {
      openFile(entry.path, entry.name);
    }
  }, []);

  const rootLoading = loading.has(rootPath);
  const activeRoot = roots.find((candidate) => candidate.path === rootPath);

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      {/* Root selector — the explorer's "open folder" */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.25,
          px: 0.75,
          py: 0.5,
          borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
        }}
      >
        <Tooltip
          title={
            activeRoot
              ? `${activeRoot.description} — ${activeRoot.path}`
              : 'Workstation filesystem'
          }
        >
          <FolderOutlined
            sx={{ fontSize: 15, mx: 0.5, color: theme.aa.color.text.muted }}
          />
        </Tooltip>

        <Select
          size="small"
          value={rootPath}
          displayEmpty
          onChange={(e) => setRootPath(e.target.value)}
          sx={{
            flex: 1,
            fontSize: 11.5,
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            '& .MuiSelect-select': { py: 0.3 },
          }}
        >
          {roots.length === 0 && (
            <MenuItem value="" sx={{ fontSize: 12 }}>
              No folders found
            </MenuItem>
          )}
          {roots.map((r) => (
            <MenuItem key={r.path} value={r.path} sx={{ fontSize: 12 }}>
              {r.label}
            </MenuItem>
          ))}
        </Select>

        <Tooltip title="New file or folder">
          <IconButton size="small" onClick={() => openDialog('new-file', 'text')}>
            <NoteAddOutlined sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Collapse all">
          <IconButton size="small" onClick={() => setExpanded(new Set())}>
            <UnfoldLessOutlined sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={showHidden ? 'Hide dotfiles' : 'Show dotfiles'}>
          <IconButton size="small" onClick={() => setShowHidden((v) => !v)}>
            {showHidden ? (
              <VisibilityOutlined sx={{ fontSize: 15 }} />
            ) : (
              <VisibilityOffOutlined sx={{ fontSize: 15 }} />
            )}
          </IconButton>
        </Tooltip>
        <Tooltip title="Refresh">
          <IconButton
            size="small"
            onClick={() => {
              setChildren({});
              setExpanded(new Set());
              void fetchChildren(rootPath, showHidden);
            }}
          >
            <RefreshOutlined sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
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
        {rootLoading && <CircularProgress size={11} />}
      </Box>

      {error && (
        <Typography sx={{ px: 1.25, py: 1, fontSize: 11.5, color: theme.aa.color.status.error }}>
          {error}
        </Typography>
      )}

      {/* The tree */}
      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0, py: 0.25 }}>
        {rows.map(({ entry, depth }) => {
          const Icon = entry.isDir ? FolderOutlined : KIND_ICON[entry.kind];
          const open = expanded.has(entry.path);
          const busy = loading.has(entry.path);
          const isSelected = selected === entry.path;

          return (
            <Box
              key={entry.path}
              onClick={() => {
                if (entry.isDir) {
                  setSelected(entry.path);
                  toggle(entry);
                } else {
                  handleActivate(entry);
                }
              }}
              title={entry.path}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                height: 22,
                pr: 0.5,
                // Indent guides land under the chevron column, like an IDE tree.
                pl: `${depth * 12 + 4}px`,
                cursor: 'pointer',
                userSelect: 'none',
                backgroundColor: isSelected
                  ? theme.aa.color.bg.selected ?? theme.aa.color.bg.chrome
                  : 'transparent',
                '&:hover': { backgroundColor: theme.aa.color.bg.chrome },
                '&:hover .aa-copy': { opacity: 1 },
              }}
            >
              {/* Chevron column: present for folders, blank for files, so names align */}
              <Box sx={{ width: 16, flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                {entry.isDir &&
                  (busy ? (
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

              <CopyPathButton value={entry.path} label="Copy path" />
            </Box>
          );
        })}

        {!rootLoading && rows.length === 0 && (
          <Box sx={{ p: 2, textAlign: 'center' }}>
            <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.muted }}>
              {query ? `Nothing matches “${query}”.` : 'This folder is empty.'}
            </Typography>
            {!query && (
              <Typography
                component="button"
                onClick={() => openDialog('new-file', 'text')}
                sx={{
                  mt: 1,
                  fontSize: 11.5,
                  color: theme.aa.color.accent.main,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  p: 0,
                  '&:hover': { textDecoration: 'underline' },
                }}
              >
                Create a file here
              </Typography>
            )}
          </Box>
        )}
      </Box>
    </Box>
  );
};
