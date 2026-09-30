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
            </Box>
          ))}
          <Box>
            <Button
              size="small"
              variant="outlined"
              startIcon={copied ? <CheckRounded sx={{ fontSize: 14 }} /> : <ContentCopyOutlined sx={{ fontSize: 13 }} />}
              onClick={async () => {
                if (await copyText(script)) {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                }
              }}
              sx={{ textTransform: 'none', fontSize: 11.5, ml: 2.25, mt: 0.25 }}
            >
              {copied ? 'Copied' : 'Copy as a shell script'}
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}

/**
 * The preview as a script that runs on its own: the scratch folder becomes
 * $RUN, and the Sv path aa-sv prints (its name carries the recipe hash, so it
 * is not known in advance) is captured and handed to aa-graph, as the card's
 * runner does.
 */
export function toScript(preview: Preview): string {
  const fetch = preview.stages.find((s) => s.id === 'fetch');
  const scratch = fetch ? fetch.command[fetch.command.indexOf('-o') + 1] ?? '' : '';
  const local = (arg: string) =>
    scratch && arg.startsWith(scratch) ? `$RUN${arg.slice(scratch.length)}` : arg;
  const lines = [
    '#!/usr/bin/env bash',
    `# ${preview.base}: NCEI -> EchoData, written to`,
    `#   ${preview.destination}`,
    '# Generated by the AA-SI Workbench (Prepare EchoData).',
    'set -eo pipefail',
    'RUN=$(mktemp -d)                    # raw files and per-file EchoData',
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
    lines.push(line, '');
  }
  lines.push('rm -rf "$RUN"', '');
  return lines.join('\n');
}
