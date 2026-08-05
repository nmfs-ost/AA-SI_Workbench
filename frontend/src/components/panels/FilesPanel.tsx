import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputBase,
  MenuItem,
  Select,
  Snackbar,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  ArticleOutlined,
  ChevronRightOutlined,
  CodeOutlined,
  ContentCopyOutlined,
  CreateNewFolderOutlined,
  DeleteOutlineOutlined,
  DescriptionOutlined,
  DriveFileRenameOutlineOutlined,
  ExpandMoreOutlined,
  FolderOutlined,
  GridOnOutlined,
  ImageOutlined,
  InsightsOutlined,
  MenuBookOutlined,
  NoteAddOutlined,
  OpenInNewOutlined,
  RefreshOutlined,
  SearchOutlined,
  TerminalOutlined,
  UnfoldLessOutlined,
  VisibilityOffOutlined,
  VisibilityOutlined,
} from '@mui/icons-material';

import { filesApi } from '../../services/filesApi';
import type { FsEntry, FsKind, FsRoot, FsTrashResult } from '../../services/filesApi';
import { useLayout } from '../../context/LayoutContext';
import { openDialog } from '../../state/dialogs';
import { openFile } from '../../state/editors';
import {
  clearReveal,
  setCurrentDirectory,
  useFileBrowser,
} from '../../state/fileBrowser';
import { loadIdentity, useIdentity } from '../../state/identity';
import { sendToTerminal } from '../../state/terminal';
import { CopyPathButton } from './CopyPathButton';
import { RowMenu, RowMenuButton, useRowMenu, type RowAction } from './RowMenu';
import { isOpenable } from './editor/language';
import { dirname } from './editor/paths';
import { panelDensity } from './panelStyles';
import { formatBytes, formatRelativeTime, modifiedTooltip } from './rowFormat';
import { quote } from './shellQuote';

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

interface Row {
  entry: FsEntry;
  depth: number;
}

/** Width of the Modified column, so the values form a column rather than a
    ragged right edge. Sized for "12 Aug", the widest thing it renders. */
const MODIFIED_WIDTH = 46;
/** Width of the size column. Sized for "999.9 MB". */
const SIZE_WIDTH = 52;

interface FileRowProps {
  entry: FsEntry;
  depth: number;
  expanded: boolean;
  busy: boolean;
  selected: boolean;
  canWrite: boolean;
  canTrash: boolean;
  /** Why organising is unavailable, when it is. Shown on the disabled item. */
  readOnlyReason: string;
  onActivate: () => void;
  onRefreshParent: () => void;
  onTrashed: (result: FsTrashResult) => void;
  onError: (message: string) => void;
}

/**
 * One row of the tree.
 *
 * A component rather than a fragment inside `rows.map` because each row owns
 * its own menu anchor, and a hook cannot be called from a loop body. That is a
 * React constraint rather than a design choice, but it lands somewhere better
 * than it started: the row's actions are now defined next to the row rather
 * than in the panel's render, where they would be rebuilt on every keystroke
 * in the filter box.
 */
function FileRow({
  entry,
  depth,
  expanded,
  busy,
  selected,
  canWrite,
  canTrash,
  readOnlyReason,
  onActivate,
  onRefreshParent,
  onTrashed,
  onError,
}: FileRowProps) {
  const theme = useTheme();
  const menu = useRowMenu();
  const { openPanel } = useLayout();

  const Icon = entry.isDir ? FolderOutlined : KIND_ICON[entry.kind];
  const isAsset = ASSET_KINDS.has(entry.kind);

  const handleTrash = async () => {
    try {
      const result = await filesApi.trash(entry.path);
      onTrashed(result);
      onRefreshParent();
    } catch (caught) {
      onError(caught instanceof Error ? caught.message : 'Could not move that to Trash.');
    }
  };

  /* The folder a "New" here should create into: the folder itself when this
     row is one, otherwise the folder it sits in. */
  const containingFolder = entry.isDir ? entry.path : dirname(entry.path);

  const actions: readonly RowAction[] = [
    ...(entry.isDir
      ? []
      : [
          {
            id: 'open',
            label: isOpenable(entry.kind, entry.path) ? 'Open' : 'Select',
            icon: OpenInNewOutlined,
            onSelect: onActivate,
          },
        ]),
    {
      id: 'new',
      label: 'New file here…',
      icon: NoteAddOutlined,
      disabled: !canWrite,
      disabledReason: readOnlyReason,
      dividerBefore: !entry.isDir,
      onSelect: () => {
        setCurrentDirectory(containingFolder);
        openDialog('new-file', 'text');
      },
    },
    {
      id: 'new-folder',
      label: 'New folder here…',
      icon: CreateNewFolderOutlined,
      disabled: !canWrite,
      disabledReason: readOnlyReason,
      onSelect: () => {
        setCurrentDirectory(containingFolder);
        openDialog('new-file', 'folder');
      },
    },
    {
      id: 'rename',
      label: 'Rename…',
      icon: DriveFileRenameOutlineOutlined,
      disabled: !canWrite,
      disabledReason: readOnlyReason,
      dividerBefore: true,
      onSelect: () => openDialog('rename', entry.path),
    },
    {
      id: 'copy-path',
      label: 'Copy path',
      icon: ContentCopyOutlined,
      onSelect: () => {
        void navigator.clipboard?.writeText(entry.path).catch(() => {
          onError('Could not reach the clipboard — select the path instead.');
        });
      },
    },
    {
      id: 'terminal',
      label: 'Open in Terminal',
      icon: TerminalOutlined,
      onSelect: () => {
        // `cd` without a trailing newline: the shell is the user's, and
        // running something in it unasked is a different kind of action from
        // offering it. They press Enter.
        sendToTerminal(`cd ${quote(containingFolder)}`, {
          origin: 'Files',
          execute: false,
        });
        openPanel('terminal');
      },
    },
    {
      id: 'trash',
      label: 'Move to Trash',
      icon: DeleteOutlineOutlined,
      danger: true,
      dividerBefore: true,
      disabled: !canTrash,
      disabledReason: readOnlyReason,
      onSelect: () => void handleTrash(),
    },
  ];

  return (
    <>
      <Box
        onClick={onActivate}
        onContextMenu={menu.onContextMenu}
        title={entry.path}
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          height: panelDensity.rowHeight,
          pr: 0.5,
          // Indent guides land under the chevron column, like an IDE tree.
          pl: `${depth * 12 + 4}px`,
          cursor: 'pointer',
          userSelect: 'none',
          backgroundColor: selected
            ? theme.aa.color.bg.selected ?? theme.aa.color.bg.chrome
            : 'transparent',
          '&:hover': { backgroundColor: theme.aa.color.bg.chrome },
          '&:hover .aa-copy': { opacity: 1 },
          '&:hover .aa-rowmenu': { opacity: 1 },
        }}
      >
        {/* Chevron column: present for folders, blank for files, so names align */}
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
            width: SIZE_WIDTH,
            flexShrink: 0,
            textAlign: 'right',
            fontSize: panelDensity.font.meta,
            color: theme.aa.color.text.muted,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {entry.isDir ? '' : formatBytes(entry.sizeBytes)}
        </Typography>

        {/* Modified. Relative, because the question is nearly always "is this
            the file the job just wrote?" and `2h` answers it where an ISO
            timestamp does not — and it fits a dock this narrow. The exact
            stamp, and the owner, are in the tooltip. */}
        <Tooltip
          title={modifiedTooltip(entry.modifiedAt, entry.owner)}
          placement="left"
          disableInteractive
        >
          <Typography
            sx={{
              width: MODIFIED_WIDTH,
              flexShrink: 0,
              textAlign: 'right',
              fontSize: panelDensity.font.meta,
              color: theme.aa.color.text.muted,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {formatRelativeTime(entry.modifiedAt)}
          </Typography>
        </Tooltip>

        <CopyPathButton value={entry.path} label="Copy path" />
        <RowMenuButton controller={menu} label={`Actions for ${entry.name}`} />
      </Box>

      <RowMenu controller={menu} actions={actions} title={entry.name} />
    </>
  );
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
 * Organising — new, rename, move to trash — is on the right-click menu and on
 * a ⋮ button revealed at the row's right edge. Both open the same menu: the
 * right-click is what makes it fast, the button is what makes it *findable*,
 * and on a touchscreen the button is the only one of the two that exists.
 *
 * There is still no delete. Trashing moves the entry to the desktop trash and
 * offers Undo for as long as the toast is up, which is a better guarantee than
 * the confirmation dialog it replaces — a confirmation asks you to be certain
 * in advance, and being certain in advance is the thing nobody can do.
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
  /** The last trash operation, held only while its Undo toast is up. */
  const [trashed, setTrashed] = useState<FsTrashResult | null>(null);
  const lastRefreshRef = useRef(browser.refreshToken);

  const { identity } = useIdentity();

  /* Identity is fetched once per session by whichever consumer mounts first. */
  useEffect(() => {
    void loadIdentity();
  }, []);

  /**
   * Why organising is unavailable, when it is.
   *
   * The backend's own wording, so the reason a button is disabled and the
   * reason the request would fail are the same sentence rather than two
   * paraphrases that drift apart.
   */
  const readOnlyReason =
    identity.detail || 'This Workbench is configured read-only.';

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

      {/* Column header.
          The Modified values would otherwise read as a trailing annotation on
          each row rather than as a column — the header is what turns a ragged
          right edge into something the eye can scan down. Deliberately tiny:
          it labels the columns without competing with the filenames. */}
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
        <Box sx={{ width: SIZE_WIDTH, flexShrink: 0, textAlign: 'right' }}>Size</Box>
        <Box sx={{ width: MODIFIED_WIDTH, flexShrink: 0, textAlign: 'right' }}>
          Modified
        </Box>
        {/* Reserves the two hover buttons' width so the headings sit over the
            columns they name rather than two icons to the right of them. */}
        <Box sx={{ width: 44, flexShrink: 0 }} />
      </Box>

      {/* The tree */}
      <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0, py: 0.25 }}>
        {rows.map(({ entry, depth }) => (
          <FileRow
            key={entry.path}
            entry={entry}
            depth={depth}
            expanded={expanded.has(entry.path)}
            busy={loading.has(entry.path)}
            selected={selected === entry.path}
            canWrite={identity.capabilities.writeFiles}
            canTrash={identity.capabilities.trashFiles}
            readOnlyReason={readOnlyReason}
            onActivate={() => {
              if (entry.isDir) {
                setSelected(entry.path);
                toggle(entry);
              } else {
                handleActivate(entry);
              }
            }}
            onRefreshParent={() => void fetchChildren(dirname(entry.path) || rootPath, showHidden)}
            onTrashed={setTrashed}
            onError={setError}
          />
        ))}

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

      {/*
        The undo.

        This is what lets Move to Trash be a plain menu item rather than an
        action behind a confirmation dialog. A confirmation asks the user to be
        certain *before* acting, which is precisely when they have the least
        information; an undo lets them look at the result and change their mind,
        which is when they have the most.

        Six seconds, and dismissing it does not undo — the entry stays in the
        desktop trash either way, so the toast expiring loses nothing but the
        shortcut back.
      */}
      <Snackbar
        open={trashed !== null}
        autoHideDuration={6000}
        onClose={() => setTrashed(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message={trashed ? `Moved ${trashed.name} to Trash` : ''}
        action={
          <Button
            size="small"
            onClick={() => {
              const pending = trashed;
              if (!pending) return;
              setTrashed(null);
              void filesApi
                .restore(pending.token)
                .then((entry) => {
                  void fetchChildren(dirname(entry.path) || rootPath, showHidden);
                  setSelected(entry.path);
                })
                .catch((caught: unknown) => {
                  setError(
                    caught instanceof Error ? caught.message : 'Could not undo that.',
                  );
                });
            }}
            sx={{ fontSize: 11.5, textTransform: 'none' }}
          >
            Undo
          </Button>
        }
        sx={{ '& .MuiSnackbarContent-message': { fontSize: 12 } }}
      />
    </Box>
  );
};
