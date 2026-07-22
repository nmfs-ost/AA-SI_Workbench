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
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

import { clearTerminalRequest, useTerminalRequest } from '../../state/terminal';
import { terminalApi, terminalSocketUrl } from '../../services/terminalApi';
import type { TerminalInfo } from '../../services/terminalApi';
import type { AaTokens } from '../../theme';
import { tokens } from '../../theme';

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
  // A command another panel wants run here. Held until the PTY is ready.
  const pendingRef = useRef<string | null>(null);
  const incoming = useTerminalRequest();

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

        <Box sx={{ flex: 1 }} />

        <Typography sx={{ fontSize: 11, color: statusColor }}>
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
