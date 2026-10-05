import { useState } from 'react';
import { Box, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import {
  CheckCircleOutlineRounded,
  ContentCopyOutlined,
  ErrorOutlineRounded,
  FingerprintOutlined,
} from '@mui/icons-material';

import { LevelChip } from '../prepare/ui';
import { KIND_LABELS, shortHash } from '../pipelines/chain';

/**
 * How a product's identity is shown, everywhere a product appears: the
 * Products panel, the pipeline's input, a run's results.
 *
 * Three hashes, three questions (see backend products.py):
 *   product hash — is this the same science? (aa:xxxxxxxx, as the tools print)
 *   recipe       — was it made the same way? (the _xxxxxxxx in its name)
 *   MD5          — are these the bytes the tool published?
 * The product hash leads. Each tag shows eight characters and copies the whole
 * hash on a click; the tooltip names it and gives it in full.
 */

const HASH_INFO = {
  product: {
    label: 'Product hash',
    prefix: 'aa:',
    about:
      'SHA-256 of what was computed: the tool, its scientific settings, the software, and the identity of every input. The same hash means the same science.',
  },
  recipe: {
    label: 'Recipe',
    prefix: '',
    about:
      'The processing without the data. Its first eight characters are the _xxxxxxxx in the names of the products it makes, so files made the same way share it. (An echogram or plot is named after the product it shows.)',
  },
  md5: {
    label: 'MD5',
    prefix: 'md5:',
    about: "Google's checksum of the bytes in the bucket.",
  },
} as const;

export type HashKind = keyof typeof HASH_INFO;

export function HashTag({
  hash,
  kind = 'product',
  size = 'small',
  quiet = false,
}: {
  hash: string;
  kind?: HashKind;
  size?: 'small' | 'medium';
  /** No frame: for a dense row. */
  quiet?: boolean;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  const [copied, setCopied] = useState(false);
  if (!hash) return null;
  const info = HASH_INFO[kind];
  const color = kind === 'product' ? c.syntax.entity : kind === 'recipe' ? c.syntax.reference : c.text.secondary;
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    void navigator.clipboard?.writeText(hash).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1200);
      },
      () => undefined,
    );
  };
  return (
    <Tooltip
      disableInteractive
      title={
        <Box sx={{ maxWidth: 360 }}>
          <Typography sx={{ fontSize: 11.5, fontWeight: 600 }}>
            {copied ? 'Copied' : `${info.label} — click to copy`}
          </Typography>
          <Typography sx={{ fontSize: 11, wordBreak: 'break-all', fontVariantNumeric: 'tabular-nums', my: 0.25 }}>
            {hash}
          </Typography>
          <Typography sx={{ fontSize: 10.5, opacity: 0.8 }}>{info.about}</Typography>
        </Box>
      }
    >
      <Box
        component="button"
        type="button"
        onClick={copy}
        aria-label={`Copy the ${info.label.toLowerCase()} ${hash}`}
        sx={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 0.4,
          flexShrink: 0,
          height: size === 'small' ? 17 : 20,
          px: quiet ? 0 : 0.6,
          border: quiet ? 'none' : `1px solid ${alpha(color, 0.3)}`,
          borderRadius: `${theme.aa.radius.sm}px`,
          backgroundColor: quiet ? 'transparent' : alpha(color, 0.08),
          color,
          cursor: 'copy',
          font: 'inherit',
          fontSize: size === 'small' ? 10.5 : 11.5,
          fontWeight: 500,
          letterSpacing: '0.02em',
          fontVariantNumeric: 'tabular-nums',
          '&:hover': { backgroundColor: alpha(color, quiet ? 0.08 : 0.16) },
          '&:focus-visible': { outline: `1px solid ${c.accent.main}`, outlineOffset: 1 },
        }}
      >
        {kind === 'product' && !quiet && <FingerprintOutlined sx={{ fontSize: size === 'small' ? 11 : 13 }} />}
        <span>
          {info.prefix}
          {shortHash(hash)}
        </span>
        {copied && <ContentCopyOutlined sx={{ fontSize: 10 }} />}
      </Box>
    </Tooltip>
  );
}

/** "L2A Sv": the level chip and the kind's name. */
export function KindTag({ kind, level }: { kind: string; level: string }) {
  const theme = useTheme();
  if (!kind) return null;
  return (
    <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
      <LevelChip level={level} />
      <Typography component="span" sx={{ fontSize: 11, fontWeight: 600, color: theme.aa.color.text.secondary }}>
        {KIND_LABELS[kind] ?? kind}
      </Typography>
    </Box>
  );
}

/** Whether the object is still the bytes its tool published. */
export function IntegrityMark({ intact }: { intact: boolean | null }) {
  const theme = useTheme();
  if (intact === null || intact === undefined) return null;
  return intact ? (
    <Tooltip
      disableInteractive
      title="The object's MD5 matches the one the tool recorded when it published it: its provenance describes these bytes."
    >
      <CheckCircleOutlineRounded sx={{ fontSize: 14, color: theme.aa.color.status.success, flexShrink: 0 }} />
    </Tooltip>
  ) : (
    <Tooltip
      disableInteractive
      title="The object was rewritten after its tool published it (its MD5 no longer matches the one recorded), so its provenance and hashes may not describe it."
    >
      <ErrorOutlineRounded sx={{ fontSize: 14, color: theme.aa.color.status.warning, flexShrink: 0 }} />
    </Tooltip>
  );
}
