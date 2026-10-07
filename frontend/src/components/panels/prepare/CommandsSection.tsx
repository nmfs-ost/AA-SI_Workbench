import { useEffect, useState } from 'react';
import { Box, Button, CircularProgress, Typography, useTheme } from '@mui/material';
import { CheckRounded, ContentCopyOutlined } from '@mui/icons-material';

import { copyText } from '../CopyPathButton';
import { quote } from '../shellQuote';
import type { BaselineRequest, Preview } from '../../../services/baselineApi';
import { baselineApi } from '../../../services/baselineApi';
import { LevelChip } from './ui';

/**
 * The exact console commands the card will run, from the server that will run
 * them (the same function builds the preview and the run, so they cannot
 * disagree). This is the answer to "what is it actually doing?", and the way
 * to do the same thing again from a terminal without the card.
 */
export function CommandsSection({ request }: { request: BaselineRequest | null }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const [preview, setPreview] = useState<Preview | null>(null);
  /** The request the shown preview was made for: copying waits for the current one. */
  const [previewFor, setPreviewFor] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const key = request ? JSON.stringify(request) : '';

  useEffect(() => {
    if (!request) {
      setPreview(null);
      return;
    }
    let live = true;
    setBusy(true);
    const timer = setTimeout(() => {
      baselineApi
        .preview(request)
        .then((p) => {
          if (live) {
            setPreview(p);
            setPreviewFor(key);
            setError('');
          }
        })
        .catch((e: Error) => live && setError(e.message))
        .finally(() => live && setBusy(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
    // `key` stands for the request's content; the object itself is new each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (!request) {
    return (
      <Typography sx={{ fontSize: 11, color: c.text.muted }}>
        Choose a survey and a time range to see the commands.
      </Typography>
    );
  }

  const script = preview ? toScript(preview) : '';
  const current = previewFor === key && !busy;

  return (
    <Box>
      {error && <Typography sx={{ fontSize: 11, color: c.status.error, mb: 1 }}>{error}</Typography>}
      {!preview && busy && <CircularProgress size={14} />}
      {preview && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, opacity: busy ? 0.6 : 1 }}>
          {preview.stages.map((stage, i) => (
            <Box key={stage.id}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.4 }}>
                <Typography sx={{ fontSize: 10, color: c.text.muted, width: 12, textAlign: 'right' }}>
                  {i + 1}
                </Typography>
                <Typography sx={{ fontSize: 11, fontWeight: 600, color: c.text.primary }}>
                  {stage.label}
                </Typography>
                <LevelChip level={stage.level} />
                <Typography
                  sx={{
                    ml: 'auto',
                    fontSize: 10,
                    color: c.text.muted,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    minWidth: 0,
                  }}
                  title={stage.description}
                >
                  {stage.description}
                </Typography>
              </Box>
              <Box
                component="pre"
                sx={{
                  m: 0,
                  ml: 2.25,
                  px: 1,
                  py: 0.75,
                  borderRadius: `${theme.aa.radius.sm}px`,
                  backgroundColor: c.bg.editor,
                  border: `1px solid ${c.border.subtle}`,
                  fontFamily: theme.aa.font.mono,
                  fontSize: 10.5,
                  lineHeight: 1.55,
                  color: c.text.secondary,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                <Box component="span" sx={{ color: c.syntax.keyword, fontWeight: 600 }}>
                  {stage.command[0]}
                </Box>{' '}
                {stage.command.slice(1).map(quote).join(' ')}
              </Box>
              {stage.frees && stage.frees.length > 0 && (
                <Typography
                  sx={{ ml: 2.25, mt: 0.4, fontSize: 10, color: c.text.muted, fontFamily: theme.aa.font.mono }}
                  title="Free space as it goes: no later stage reads these"
                >
                  then deletes {stage.frees.join(', ')}
                </Typography>
              )}
            </Box>
          ))}
          <Box>
            <Button
              size="small"
              variant="outlined"
              disabled={!current}
              startIcon={copied ? <CheckRounded sx={{ fontSize: 14 }} /> : <ContentCopyOutlined sx={{ fontSize: 13 }} />}
              onClick={async () => {
                if (await copyText(script)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
              sx={{ textTransform: 'none', fontSize: 11.5, ml: 2.25, mt: 0.25 }}
            >
              {copied ? 'Copied' : current ? 'Copy as a shell script' : 'Updating…'}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/**
 * A folder for the shell, in single quotes so nothing in it ($, backquotes,
 * backslashes) is expanded or run, with a leading ~/ left outside to expand.
 */
export function pathArg(path: string): string {
  const literal = (text: string) => `'${text.replace(/'/g, `'\\''`)}'`;
  if (path.startsWith('~/')) return path.length > 2 ? `~/${literal(path.slice(2))}` : '~';
  return literal(path);
}

/** A shell line deleting one of the server's "frees" patterns under $RUN. */
export function freeLine(pattern: string): string {
  const deep = pattern.indexOf('**/');
  if (deep >= 0) {
    const dir = pattern.slice(0, deep).replace(/\/$/, '');
    const name = pattern.slice(deep + 3);
    return `find "$RUN${dir ? `/${dir}` : ''}" -name ${quote(name)} -prune -exec rm -rf {} +`;
  }
  // The pattern's own wildcards must stay outside the quotes to expand.
  return `rm -rf -- "$RUN"/${pattern}`;
}

/**
 * The preview as a script that runs on its own: the scratch folder becomes
 * $RUN (made in the card's working folder), the Sv path aa-sv prints (its name
 * carries the recipe hash, so it is not known in advance) is captured and
 * handed to aa-graph, and the working files the card frees as it goes are
 * deleted at the same points, as the card's runner does.
 */
export function toScript(preview: Preview): string {
  const fetch = preview.stages.find((s) => s.id === 'fetch');
  const scratch =
    preview.scratch || (fetch && fetch.command.includes('-o') ? fetch.command[fetch.command.indexOf('-o') + 1] ?? '' : '');
  const local = (arg: string) =>
    scratch && arg.startsWith(scratch) ? `$RUN${arg.slice(scratch.length)}` : arg;
  const lines = [
    '#!/usr/bin/env bash',
    `# ${preview.base}: ${preview.source || 'NCEI'} -> EchoData, written to`,
    `#   ${preview.destination}`,
    '# Generated by the AA-SI Workbench (Prepare EchoData).',
    'set -eo pipefail',
    ...(preview.workRoot
      ? [
          `mkdir -p ${pathArg(preview.workRoot)}`,
          `RUN=$(mktemp -d ${pathArg(preview.workRoot.replace(/\/$/, '') + '/run.XXXXXX')})   # in the working folder`,
        ]
      : ['RUN=$(mktemp -d)                    # raw files and per-file EchoData']),
    'export AA_CACHE_DIR="$RUN/cache"     # the tools\' staging and download cache',
    'cd "$RUN"',
    '',
  ];
  for (const stage of preview.stages) {
    const args = stage.command.map(local);
    if (stage.id === 'echogram') args[1] = '$SV';
    let line = args.map(quote).join(' ');
    if (stage.id === 'sv') line = `SV=$(${line})`;
    lines.push(`# ${stage.label}${stage.level ? ` (${stage.level})` : ''}: ${stage.description}`);
    // A copy from a folder archive needs its folder; aa-fetch makes its own.
    if (stage.id === 'fetch' && stage.tool === 'cp') lines.push(`mkdir -p ${quote(local(args[args.length - 1]))}`);
    lines.push(line);
    if (stage.frees?.length) {
      lines.push('# Free space as it goes: no later stage reads these.');
      lines.push(...stage.frees.map(freeLine));
    }
    lines.push('');
  }
  lines.push('rm -rf "$RUN"', '');
  return lines.join('\n');
}
