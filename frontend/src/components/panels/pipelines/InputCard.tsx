import { Box, Button, IconButton, Tooltip, Typography, alpha, useTheme } from '@mui/material';
import {
  CloseRounded,
  DataObjectOutlined,
  InputRounded,
  LayersOutlined,
} from '@mui/icons-material';

import type { ProductRef } from '../../../services/pipelinesApi';
import { setInputs, toggleInput } from '../../../state/pipelines';
import { setActiveArtifact } from '../../../state/activeSubject';
import { revealInDerived } from '../../../state/derivedReveal';
import { useLayout } from '../../../context/LayoutContext';
import { formatBytes, formatRelativeTime } from '../rowFormat';
import { HashTag, IntegrityMark, KindTag } from '../products/ProductBits';
import { Caption } from '../prepare/ui';

/**
 * What the pipeline runs on: products chosen in the Products panel (or taken
 * from a run's results). One product shows in full, with its three hashes;
 * several show as a list, each becoming its own run.
 */
export function InputCard({ inputs }: { inputs: ProductRef[] }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const { openPanel } = useLayout();

  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1 }}>
        <Caption>Input</Caption>
        <Box sx={{ flex: 1 }} />
        {inputs.length > 0 && (
          <Button
            size="small"
            onClick={() => setInputs([])}
            sx={{ fontSize: 11, textTransform: 'none', minWidth: 0, py: 0, color: c.text.muted }}
          >
            Clear
          </Button>
        )}
      </Box>

      {inputs.length === 0 ? (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            px: 1.5,
            py: 1.25,
            borderRadius: `${theme.aa.radius.md}px`,
            border: `1px dashed ${c.border.strong}`,
            backgroundColor: alpha(c.accent.main, 0.03),
          }}
        >
          <InputRounded sx={{ fontSize: 20, color: c.text.muted }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: c.text.primary }}>
              Choose a product in the bucket
            </Typography>
            <Typography sx={{ fontSize: 11.5, color: c.text.secondary, lineHeight: 1.5 }}>
              Select an EchoData, Sv, MVBS or other product in the Products panel (tick several to
              run each). It flows into the pipeline below, with its hashes and history.
            </Typography>
          </Box>
          <Button
            size="small"
            variant="outlined"
            startIcon={<LayersOutlined sx={{ fontSize: 15 }} />}
            onClick={() => openPanel('derived')}
            sx={{ textTransform: 'none', fontSize: 11.5, flexShrink: 0 }}
          >
            Open Products
          </Button>
        </Box>
      ) : inputs.length === 1 ? (
        <One product={inputs[0]} />
      ) : (
        <Box
          sx={{
            borderRadius: `${theme.aa.radius.md}px`,
            border: `1px solid ${c.border.subtle}`,
            backgroundColor: c.bg.panel,
            overflow: 'hidden',
          }}
        >
          {inputs.map((p) => (
            <Box
              key={p.uri}
              title={p.uri}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.25,
                height: 30,
                '& + &': { borderTop: `1px solid ${c.border.subtle}` },
              }}
            >
              <KindTag kind={p.kind} level={p.level} />
              <Typography
                sx={{ flex: 1, minWidth: 0, fontSize: 12, color: c.text.primary }}
                noWrap
              >
                {p.name}
              </Typography>
              <HashTag hash={p.productHash} />
              <Typography sx={{ fontSize: 10.5, color: c.text.muted, width: 60, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                {p.sizeBytes ? formatBytes(p.sizeBytes) : ''}
              </Typography>
              <IconButton size="small" aria-label={`Remove ${p.name}`} onClick={() => toggleInput(p)}>
                <CloseRounded sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          ))}
          <Typography sx={{ px: 1.25, py: 0.75, fontSize: 11, color: c.text.muted, borderTop: `1px solid ${c.border.subtle}` }}>
            {inputs.length} products: each runs as its own run, with the same settings.
          </Typography>
        </Box>
      )}
    </Box>
  );
}

/** One product, in full: what it is, where, and its three hashes. */
function One({ product: p }: { product: ProductRef }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const { openPanel } = useLayout();
  const folder = p.uri.slice(0, p.uri.length - p.name.length);
  return (
    <Box
      sx={{
        position: 'relative',
        px: 1.5,
        py: 1.1,
        borderRadius: `${theme.aa.radius.md}px`,
        border: `1px solid ${c.border.subtle}`,
        backgroundColor: c.bg.panel,
        boxShadow: `inset 3px 0 0 ${c.accent.main}`,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
        <KindTag kind={p.kind || 'unknown'} level={p.level} />
        <Typography sx={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: c.text.primary }} noWrap title={p.name}>
          {p.name}
        </Typography>
        <IntegrityMark intact={p.intact} />
        <Tooltip title="Inspect its provenance (Metadata)">
          <IconButton
            size="small"
            onClick={() => {
              setActiveArtifact({ uri: p.uri, label: p.name, origin: 'Pipelines', kind: 'netcdf' });
              openPanel('metadata');
            }}
          >
            <DataObjectOutlined sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Show in the Products panel">
          <IconButton
            size="small"
            onClick={() => {
              revealInDerived(p.uri);
              openPanel('derived');
            }}
          >
            <LayersOutlined sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Remove">
          <IconButton size="small" aria-label="Remove the input" onClick={() => setInputs([])}>
            <CloseRounded sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
      </Box>
      <Typography sx={{ fontSize: 11, color: c.text.muted, mt: 0.25, wordBreak: 'break-all' }}>{folder}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 0.75, mt: 0.9 }}>
        {p.productHash ? (
          <>
            <HashTag hash={p.productHash} size="medium" />
            <HashTag hash={p.recipe} kind="recipe" size="medium" />
          </>
        ) : (
          <Typography sx={{ fontSize: 11, color: c.status.warning }}>
            No product hash recorded: not made by the console tools, or before they recorded one.
          </Typography>
        )}
        <HashTag hash={p.md5} kind="md5" size="medium" />
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 11, color: c.text.muted, fontVariantNumeric: 'tabular-nums' }}>
          {[p.sizeBytes ? formatBytes(p.sizeBytes) : '', p.tool, p.updatedAt ? formatRelativeTime(p.updatedAt) : '']
            .filter(Boolean)
            .join(' · ')}
        </Typography>
      </Box>
    </Box>
  );
}
