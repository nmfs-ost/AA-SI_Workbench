import { useCallback, useEffect, useRef, useState } from 'react';
import type { FunctionComponent } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import {
  Box,
  Button,
  CircularProgress,
  MenuItem,
  Select,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import {
  PlayArrowOutlined,
  RefreshOutlined,
  TerminalOutlined,
} from '@mui/icons-material';
import { Terminal } from '@xterm/xterm';
import type { ILink } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { useLayout } from '../../context/LayoutContext';
import { clearTerminalRequest, useTerminalRequest } from '../../state/terminal';
import { setActiveArtifact } from '../../state/activeSubject';
import { openFile } from '../../state/editors';
import { refreshFileBrowser } from '../../state/fileBrowser';
import { filesApi } from '../../services/filesApi';
import { terminalApi, terminalSocketUrl } from '../../services/terminalApi';
import type { TerminalInfo } from '../../services/terminalApi';
import type { AaTokens } from '../../theme';
import { tokens } from '../../theme';
import {
  describeLink,
  findLinks,
  logicalLineAt,
  positionAt,
  type FoundLink,
} from './terminalLinks';

type Status = 'idle' | 'connecting' | 'connected' | 'closed' | 'error';

/**
 * An interactive shell on the workstation.
 *
 * The session is a PTY on the backend; this component is a viewport onto it.
 * Bytes go both ways untouched — no command parsing, no client-side filtering —
 * because anything less than a real terminal is a worse terminal. The security
 * boundary is the backend's loopback check, not this component.
 *
 * The virtualenv selector exists because the Workbench drives `aa-*` tools that
 * live in a specific environment (venv313 on a workstation). A shell started
 * outside it silently cannot see them, so the environment is chosen up front
 * and activated by the server when the session starts.
 *
 * ## Links
 *
 * Output is scanned for URLs, `gs://` URIs and absolute paths, and each becomes
 * clickable. This is not decoration: the first thing every one of these tools
 * prints is a location — `aa-fetch` a run directory, `aa-combine` a store,
 * `aa-upload` a bucket URI — and the next thing the user does is select it,
 * copy it, and paste it into another panel. The click does that step.
 *
 * A path is resolved through `/api/fs/stat` before anything opens, because
 * whether it is a file or a directory decides which panel should answer, and
 * the text cannot say: the directories these tools print have no extension.
 * `terminalLinks.ts` holds the parsing, including the wrapped-line handling
 * that a dock this narrow makes the normal case rather than an edge one.
 */
/**
 * xterm's colours, from the active palette.
 *
 * This used to read the static `tokens` export — which is the *dark* palette,
 * always — so switching to the light theme left near-white text on a white
 * panel. Anything drawing outside MUI has to be handed the live palette
 * explicitly; there is no context reaching into a canvas.
 */
function xtermTheme(t: AaTokens) {
  return {
    background: t.color.bg.panel,
    foreground: t.color.text.primary,
    cursor: t.color.accent.main,
    cursorAccent: t.color.bg.panel,
    selectionBackground: t.color.accent.soft,
    white: t.color.terminalAnsi.white,
    brightWhite: t.color.terminalAnsi.brightWhite,
  };
}

export const TerminalPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();

  /* The terminal is created once and lives for the panel's lifetime, so the
     construction effect must not depend on the palette — re-running it would
     drop the session and the scrollback. A ref carries the current palette in,
     and the effect below repaints the live instance instead. */
  const themeRef = useRef(theme.aa);
  themeRef.current = theme.aa;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  const [info, setInfo] = useState<TerminalInfo | null>(null);
  const [venv, setVenv] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [error, setError] = useState('');
  /** What the hovered link would do. Shown in the toolbar rather than as a
      floating tooltip: xterm draws to a canvas, so a tooltip would have to be
      positioned by hand against a cell grid, and the toolbar is already the
      place this panel says things. */
  const [hovered, setHovered] = useState('');
  const { openPanel } = useLayout();
  // A command another panel wants run here. Held until the PTY is ready.
  const pendingRef = useRef<string | null>(null);
  const incoming = useTerminalRequest();

  /**
   * Act on a clicked link.
   *
   * Held in a ref because the terminal — and therefore the link provider — is
   * constructed once for the panel's lifetime. Closing over `openPanel` in the
   * construction effect would freeze the first render's copy; adding it to the
   * effect's dependencies would tear down the PTY and the scrollback every
   * time the layout controller re-rendered.
   */
  const activateRef = useRef<(link: FoundLink) => void>(() => {});
  activateRef.current = (link: FoundLink) => {
    if (link.kind === 'url') {
      window.open(link.text, '_blank', 'noopener,noreferrer');
      return;
    }

    if (link.kind === 'gs') {
      // The same thing clicking the object in the Derived panel does, so a
      // store reaches the inspector by either route.
      setActiveArtifact({
        uri: link.text,
        label: link.text.replace(/\/+$/, '').split('/').pop() ?? link.text,
        origin: 'Terminal',
        kind: link.text.toLowerCase().endsWith('.zarr') ? 'zarr' : 'object',
      });
      openPanel('metadata');
      return;
    }

    /* A path has to be resolved before it can be opened: a directory belongs
       in the Files tree and a file belongs in the editor, and the text does
       not say which it is. A path that no longer exists reports itself in the
       toolbar rather than opening an editor onto an error. */
    void filesApi
      .stat(link.text)
      .then((entry) => {
        if (entry.isDir) {
          refreshFileBrowser(entry.path);
          openPanel('files');
          return;
        }
        openFile(entry.path, entry.name);
      })
      .catch((caught: unknown) => {
        setError(
          caught instanceof Error
            ? `${link.text}: ${caught.message}`
            : `Could not open ${link.text}.`,
        );
      });
  };

  const loadInfo = useCallback(async () => {
    try {
      const next = await terminalApi.getInfo();
      setInfo(next);
      setError(next.available ? '' : next.disabledReason);
      setVenv((current) => {
        if (current) return current;
        // Prefer the environment holding the aa-* tools, then whatever the
        // server itself is running in.
        const withTools = next.venvs.find((v) => v.hasAaTools);
        return withTools?.path ?? next.currentVenv ?? '';
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not reach the API.');
    }
  }, []);

  /* Repaint a running terminal when the theme changes. xterm redraws from
     `options.theme` in place, so the session, scrollback and cursor position
     all survive the switch. */
  useEffect(() => {
    const term = termRef.current;
    if (term) term.options.theme = xtermTheme(theme.aa);
  }, [theme.aa]);

  useEffect(() => {
    void loadInfo();
  }, [loadInfo]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || termRef.current) return;

    const term = new Terminal({
      fontFamily: tokens.font.mono,
      fontSize: 12.5,
      cursorBlink: true,
      scrollback: 5000,
      theme: xtermTheme(themeRef.current),
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    termRef.current = term;

    /*
      The link provider.

      xterm asks per *buffer row*, so the first thing this does is reassemble
      the logical line the row belongs to — a run directory printed into a dock
      this narrow is wrapped far more often than not, and matching row by row
      would link its first fragment and stop, which looks like it worked.

      Ranges come back in 1-based cell coordinates, which is one off from
      `buffer.getLine`; `positionAt` is the only place that conversion happens.
    */
    const links = term.registerLinkProvider({
      provideLinks(bufferLineNumber, callback) {
        const buffer = term.buffer.active;
        const line = logicalLineAt(
          {
            length: buffer.length,
            getLine: (index) => {
              const row = buffer.getLine(index);
              if (!row) return undefined;
              return {
                isWrapped: row.isWrapped,
                // Never trimmed: a wrapped row contributes its full width, and
                // that is what makes index-to-cell arithmetic valid.
                translate: () => row.translateToString(false),
              };
            },
          },
          bufferLineNumber - 1,
        );

        if (!line) {
          callback(undefined);
          return;
        }

        const found = findLinks(line.text);
        if (found.length === 0) {
          callback(undefined);
          return;
        }

        const cols = term.cols;
        const result: ILink[] = found.map((link) => ({
          text: link.text,
          range: {
            start: positionAt(link.start, line.startRow, cols),
            // `end` is inclusive, so it addresses the last character rather
            // than the position after it.
            end: positionAt(link.end - 1, line.startRow, cols),
          },
          decorations: { pointerCursor: true, underline: true },
          activate: (event) => {
            // Let a modified click fall through to the browser's own
            // behaviour, and never hijack a right-click — that is the
            // selection menu, and a terminal without one is a broken terminal.
            if (event.button !== 0 || event.altKey) return;
            activateRef.current(link);
          },
          hover: () => setHovered(describeLink(link)),
          leave: () => setHovered(''),
        }));
        callback(result);
      },
    });

    // Dockview resizes the panel, not the window, so observe the element.
    const observer = new ResizeObserver(() => {
      try {
        fit.fit();
        const socket = socketRef.current;
        if (socket?.readyState === WebSocket.OPEN) {
          socket.send(
            JSON.stringify({ type: 'resize', rows: term.rows, cols: term.cols }),
          );
        }
      } catch {
        // fit() throws while the panel is hidden (zero height) — harmless.
      }
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      links.dispose();
      socketRef.current?.close();
      term.dispose();
      termRef.current = null;
    };
  }, []);

  const connect = useCallback(() => {
    const term = termRef.current;
    if (!term || socketRef.current) return;

    setStatus('connecting');
    setError('');
    term.clear();

    const socket = new WebSocket(
      terminalSocketUrl({ venv, rows: term.rows, cols: term.cols }),
    );
    socket.binaryType = 'arraybuffer';
    socketRef.current = socket;

    const flushPending = () => {
      const queued = pendingRef.current;
      if (queued === null || socket.readyState !== WebSocket.OPEN) return;
      pendingRef.current = null;
      socket.send(new TextEncoder().encode(queued));
      term.focus();
    };

    socket.onopen = () => {
      setStatus('connected');
      flushPending();
    };
    socket.onmessage = (event) => {
      term.write(
        typeof event.data === 'string'
          ? event.data
          : new Uint8Array(event.data as ArrayBuffer),
      );
    };
    socket.onerror = () => {
      setStatus('error');
      setError('The terminal connection failed.');
    };
    socket.onclose = (event) => {
      socketRef.current = null;
      setStatus((s) => (s === 'error' ? s : 'closed'));
      if (event.reason) setError(event.reason);
      term.write('\r\n\x1b[2m[session ended]\x1b[0m\r\n');
    };

    // Keystrokes MUST go as binary frames. xterm hands back a string, and
    // socket.send(string) sends a text frame — which the backend routes to the
    // JSON control channel, where it fails to parse and is silently dropped.
    // Encoding here keeps the protocol honest: binary = PTY bytes, text =
    // control messages.
    const encoder = new TextEncoder();
    const typed = term.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(encoder.encode(data));
    });
    socket.addEventListener('close', () => typed.dispose());

    // A terminal you have to hunt for focus in is a broken terminal.
    term.focus();
  }, [venv]);

  useEffect(() => {
    if (!incoming) return;
    const text = incoming.execute ? `${incoming.command}\n` : incoming.command;
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(new TextEncoder().encode(text));
      termRef.current?.focus();
    } else {
      // No session yet — queue it and start one. onopen flushes the queue.
      pendingRef.current = text;
      connect();
    }
    clearTerminalRequest(incoming.id);
  }, [incoming, connect]);

  const disconnect = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
  }, []);

  const running = status === 'connected' || status === 'connecting';
  const disabled = info !== null && !info.available;

  const statusColor =
    status === 'connected'
      ? theme.aa.color.status.success
      : status === 'error'
        ? theme.aa.color.status.error
        : theme.aa.color.text.muted;

  return (
    <Box
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.aa.color.bg.panel,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1,
          py: 0.5,
          flexShrink: 0,
          borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
        }}
      >
        <TerminalOutlined sx={{ fontSize: 15, color: theme.aa.color.text.muted }} />
        <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.muted }}>
          Environment
        </Typography>
        <Select
          size="small"
          value={venv}
          disabled={running || disabled}
          onChange={(e) => setVenv(e.target.value)}
          displayEmpty
          sx={{ minWidth: 190, fontSize: 12, '& .MuiSelect-select': { py: 0.35 } }}
        >
          <MenuItem value="" sx={{ fontSize: 12 }}>
            System (no virtualenv)
          </MenuItem>
          {(info?.venvs ?? []).map((v) => (
            <MenuItem key={v.path} value={v.path} sx={{ fontSize: 12 }}>
              {v.name}
              {v.pythonVersion ? ` \u00b7 ${v.pythonVersion}` : ''}
              {v.hasAaTools ? ' \u00b7 aa-tools' : ''}
            </MenuItem>
          ))}
        </Select>

        <Tooltip title="Re-scan for virtual environments">
          <span>
            <Button
              size="small"
              disabled={running}
              onClick={() => void loadInfo()}
              startIcon={<RefreshOutlined sx={{ fontSize: 15 }} />}
              sx={{ fontSize: 11.5, textTransform: 'none' }}
            >
              Rescan
            </Button>
          </span>
        </Tooltip>

        <Box sx={{ flex: 1, minWidth: 8 }} />

        {/* What a click would do. Takes the space before the status word
            because that is the only room in this toolbar, and while the
            pointer is on a link the target is the more useful of the two. */}
        {hovered && (
          <Typography
            title={hovered}
            sx={{
              fontSize: 11,
              minWidth: 0,
              flexShrink: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              color: theme.aa.color.accent.main,
              fontFamily: theme.aa.font.mono,
            }}
          >
            {hovered}
          </Typography>
        )}

        <Typography sx={{ fontSize: 11, color: statusColor, flexShrink: 0 }}>
          {status === 'connected'
            ? 'connected'
            : status === 'connecting'
              ? 'connecting…'
              : status === 'error'
                ? 'error'
                : 'not running'}
        </Typography>

        {running ? (
          <Button
            size="small"
            color="inherit"
            onClick={disconnect}
            sx={{ fontSize: 11.5, textTransform: 'none' }}
          >
            {status === 'connecting' ? <CircularProgress size={13} /> : 'End session'}
          </Button>
        ) : (
          <Button
            size="small"
            variant="contained"
            disabled={disabled}
            onClick={connect}
            startIcon={<PlayArrowOutlined sx={{ fontSize: 15 }} />}
            sx={{ fontSize: 11.5, textTransform: 'none' }}
          >
            {status === 'closed' ? 'Restart' : 'Start session'}
          </Button>
        )}
      </Box>

      {error && (
        <Typography
          sx={{
            fontSize: 11.5,
            px: 1.25,
            py: 0.75,
            color: disabled
              ? theme.aa.color.status.warning
              : theme.aa.color.status.error,
            borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
          }}
        >
          {error}
        </Typography>
      )}

      <Box
        ref={hostRef}
        onMouseDown={() => termRef.current?.focus()}
        sx={{
          flex: 1,
          minHeight: 0,
          p: 0.5,
          cursor: 'text',
          '& .xterm': { height: '100%' },
          '& .xterm-viewport': { backgroundColor: 'transparent !important' },
        }}
      />
    </Box>
  );
};
