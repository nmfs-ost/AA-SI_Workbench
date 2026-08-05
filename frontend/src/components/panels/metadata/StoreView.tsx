import { useEffect } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  LinearProgress,
  Tooltip,
  Typography,
  useTheme,
} from '@mui/material';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import FactCheckOutlined from '@mui/icons-material/FactCheckOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import CheckCircleOutlineOutlined from '@mui/icons-material/CheckCircleOutlineOutlined';

import { CopyPathButton } from '../CopyPathButton';
import { panelDensity } from '../panelStyles';
import type { ActiveSubject } from '../../../state/activeSubject';
import {
  inspectStore,
  refreshStore,
  verifyStore,
  useInspection,
} from '../../../state/storeInspection';
import {
  compression,
  formatBytes,
  formatCount,
  sparsity,
  type StoreSummary,
} from '../../../services/storeApi';

/**
 * The store view of the Metadata panel.
 *
 * This is an **Inspect** widget, and the distinction from an Action widget is
 * the whole reason it is a separate component. An Action widget composes a
 * command from a mode and a set of parameters — combining, downloading,
 * requesting — and its job is to produce something to run. An Inspect widget
 * renders a description that already exists. It takes no parameters beyond
 * which store to look at, and **it has no Run button**. Conflating the two is
 * what turns a metadata pane into a second, worse configuration form.
 *
 * The one action here is Verify, and it is not an exception: `aa-store verify`
 * writes nothing, and its result is a *reading of this store* rather than a new
 * artifact. It is behind a button rather than automatic because a verdict
 * nobody asked for, on a store that was merely clicked, is noise — and because
 * it is a second full census.
 *
 * What the panel actually shows, in order of what it is for:
 *
 *   1. The two ratios. Sparsity (`chunkCount.written / expected`) and
 *      compression (`bytes.stored / logical`). Everything else in an
 *      `aa-store info` payload is decoration around these.
 *   2. Layout — dims, chunk shape, codec, dtype. What a later reader needs to
 *      know before opening it.
 *   3. Lineage. A handle is a message and gets lost; a store attribute travels
 *      with the bytes, which is why this can be shown for a store nobody has a
 *      handle for any more.
 *
 * Unknown is rendered as unknown. A sharded store cannot have its chunks
 * counted without decoding a shard index, and `--no-census` skips the count
 * outright; both come back null. Showing those as 0% would be a confident lie
 * about a store that is very probably fine.
 */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Box sx={{ display: 'flex', gap: 1, py: 0.4, alignItems: 'baseline' }}>
      <Typography
        sx={{
          fontSize: 11.5,
          color: theme.aa.color.text.muted,
          minWidth: 84,
          flexShrink: 0,
        }}
      >
        {label}
      </Typography>
      <Box sx={{ fontSize: 12.5, color: theme.aa.color.text.primary, minWidth: 0 }}>
        {children}
      </Box>
    </Box>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  return (
    <Typography
      sx={{
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: 0.6,
        textTransform: 'uppercase',
        color: theme.aa.color.text.muted,
        mt: 1.5,
        mb: 0.5,
      }}
    >
      {children}
    </Typography>
  );
}

/**
 * One ratio, as a bar and a number.
 *
 * `value === null` renders the reason instead of a bar. That branch is the
 * point of the component — a ratio that could not be computed is a different
 * statement from a ratio that came out at zero, and a bar cannot express the
 * difference.
 */
function Ratio({
  label,
  value,
  detail,
  unknownReason,
  invert,
}: {
  label: string;
  value: number | null;
  detail: string;
  unknownReason: string;
  /** True when a low number is the good outcome, as it is for compression. */
  invert?: boolean;
}) {
  const theme = useTheme();

  if (value === null) {
    return (
      <Box sx={{ mb: 1 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
          <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.secondary }}>
            {label}
          </Typography>
          <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.muted }}>
            not counted
          </Typography>
        </Box>
        <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted }}>
          {unknownReason}
        </Typography>
      </Box>
    );
  }

  const percent = Math.max(0, Math.min(100, value * 100));
  const good = invert ? value <= 0.5 : value >= 0.999;
  const colour = good ? theme.aa.color.status.success : theme.aa.color.accent.main;

  return (
    <Box sx={{ mb: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.25 }}>
        <Typography sx={{ fontSize: 11.5, color: theme.aa.color.text.secondary }}>
          {label}
        </Typography>
        <Typography
          sx={{ fontSize: 11.5, fontFamily: theme.aa.font.mono, color: colour }}
        >
          {invert ? `${(1 / Math.max(value, 1e-9)).toFixed(1)}×` : `${percent.toFixed(1)}%`}
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={percent}
        sx={{
          height: 4,
          borderRadius: 2,
          backgroundColor: theme.aa.color.border.subtle,
          '& .MuiLinearProgress-bar': { backgroundColor: colour },
        }}
      />
      <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted, mt: 0.25 }}>
        {detail}
      </Typography>
    </Box>
  );
}

/** Why the chunk census produced no number, phrased as a fact about the store. */
function censusReason(summary: StoreSummary | null, census: boolean): string {
  if (!census) return 'The census was skipped for this describe.';
  if (summary?.shards) {
    return 'Sharded: counting inner chunks needs a shard-index read, which is a read of the data.';
  }
  return 'The tool could not count chunk objects for this store.';
}

/** The write marker, read as a sentence. This is what exit 3 is built on. */
function writeState(summary: StoreSummary | null): {
  icon: typeof CheckCircleOutlineOutlined;
  colour: 'success' | 'warning' | 'muted';
  text: string;
} {
  const complete = summary?.write?.complete;
  if (complete === true) {
    return {
      icon: CheckCircleOutlineOutlined,
      colour: 'success',
      text: 'Marked complete. Missing chunks are empty and cost nothing.',
    };
  }
  if (complete === false) {
    return {
      icon: WarningAmberOutlined,
      colour: 'warning',
      text: 'The write did not finish. Missing chunks are absent, not empty — this is resumable.',
    };
  }
  return {
    icon: ErrorOutlineOutlined,
    colour: 'muted',
    text:
      'No write marker. Zarr has no notion of a finished store, so a missing chunk here is ' +
      'ambiguous forever: either sparsity or an unfinished write. Verify with strict to treat ' +
      'it as unfinished.',
  };
}

export function StoreView({ subject }: { subject: ActiveSubject }) {
  const theme = useTheme();
  const inspection = useInspection(subject.uri);

  // Read-only, so firing on selection needs no confirmation. The store module
  // dedupes by URI and holds an in-flight set, so a re-render cannot stampede.
  useEffect(() => {
    inspectStore(subject.uri);
  }, [subject.uri]);

  const mono = {
    fontFamily: theme.aa.font.mono,
    fontSize: 12,
    wordBreak: 'break-all' as const,
  };

  const summary = inspection.info?.summary ?? null;
  const verdict = inspection.verify?.summary?.verify ?? null;
  const sparse = sparsity(summary);
  const ratio = compression(summary);
  const write = writeState(summary);
  const writeColour =
    write.colour === 'success'
      ? theme.aa.color.status.success
      : write.colour === 'warning'
        ? theme.aa.color.status.warning
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
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1.25,
          minHeight: 30,
          borderBottom: `1px solid ${theme.aa.color.border.subtle}`,
        }}
      >
        <Typography
          sx={{ ...mono, flex: 1, minWidth: 0, color: theme.aa.color.text.primary }}
          noWrap
          title={subject.label}
        >
          {subject.label}
        </Typography>
        {inspection.phase === 'loading' && <CircularProgress size={12} />}
        <Tooltip title="Describe this store again">
          <span style={{ display: 'flex' }}>
            <Button
              size="small"
              onClick={() => refreshStore(subject.uri)}
              sx={{ minWidth: 0, px: 0.5 }}
            >
              <RefreshOutlined sx={{ fontSize: panelDensity.icon.header }} />
            </Button>
          </span>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto', p: 1.5 }}>
        <Box sx={{ display: 'flex', gap: 0.5, mb: 1, flexWrap: 'wrap' }}>
          <Chip
            label={summary?.kind ?? subject.layer}
            size="small"
            sx={{
              height: 18,
              fontSize: 10.5,
              backgroundColor: theme.aa.color.accent.soft,
              color: theme.aa.color.accent.main,
            }}
          />
          <Chip label={subject.origin} size="small" variant="outlined" sx={{ height: 18, fontSize: 10.5 }} />
          {summary && (
            <Chip
              label={summary.consolidated ? 'consolidated' : 'not consolidated'}
              size="small"
              variant="outlined"
              sx={{
                height: 18,
                fontSize: 10.5,
                borderColor: summary.consolidated
                  ? theme.aa.color.border.subtle
                  : theme.aa.color.status.warning,
                color: summary.consolidated
                  ? theme.aa.color.text.secondary
                  : theme.aa.color.status.warning,
              }}
            />
          )}
        </Box>

        {inspection.phase === 'error' && (
          <Alert severity="error" sx={{ fontSize: 11.5, mb: 1, py: 0.25 }}>
            {inspection.error}
          </Alert>
        )}

        {inspection.info && !summary && (
          <Alert severity="warning" sx={{ fontSize: 11.5, mb: 1, py: 0.25 }}>
            {inspection.info.error || 'aa-store could not describe this store.'}
          </Alert>
        )}

        {summary && (
          <>
            {/* ── The two ratios ─────────────────────────────────── */}
            <SectionTitle>Occupancy</SectionTitle>
            <Ratio
              label="Chunks written"
              value={sparse}
              detail={`${formatCount(summary.chunkCount?.written)} of ${formatCount(
                summary.chunkCount?.expected,
              )} expected · ${formatCount(summary.objects)} objects`}
              unknownReason={censusReason(summary, inspection.census)}
            />
            <Ratio
              label="Compression"
              value={ratio}
              invert
              detail={`${formatBytes(summary.bytes?.stored)} stored · ${formatBytes(
                summary.bytes?.logical,
              )} logical`}
              unknownReason="No byte totals were produced for this store."
            />

            {/* The write marker. Not decoration: it is the entire mechanism
                behind exit 3 meaning something actionable. */}
            <Box
              sx={{
                display: 'flex',
                gap: 0.75,
                alignItems: 'flex-start',
                p: 0.75,
                mt: 0.5,
                borderRadius: `${theme.aa.radius.sm}px`,
                backgroundColor: theme.aa.color.bg.base,
                border: `1px solid ${theme.aa.color.border.subtle}`,
              }}
            >
              <write.icon sx={{ fontSize: 14, color: writeColour, mt: '1px' }} />
              <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.secondary }}>
                {write.text}
              </Typography>
            </Box>

            {/* ── Layout ─────────────────────────────────────────── */}
            <SectionTitle>Layout</SectionTitle>
            <Row label="Dimensions">
              {summary.dims ? (
                <Box sx={mono}>
                  {Object.entries(summary.dims)
                    .map(([name, extent]) => `${name}: ${extent.toLocaleString()}`)
                    .join('  ')}
                </Box>
              ) : (
                '—'
              )}
            </Row>
            <Row label="Chunks">
              <Box sx={mono}>{summary.chunks ? `[${summary.chunks.join(', ')}]` : '—'}</Box>
            </Row>
            {summary.shards && (
              <Row label="Shards">
                <Box sx={mono}>[{summary.shards.join(', ')}]</Box>
              </Row>
            )}
            <Row label="Codec">
              <Box sx={mono}>{summary.codec ?? '—'}</Box>
            </Row>
            <Row label="dtype">
              <Box sx={mono}>{summary.dtype ?? '—'}</Box>
            </Row>
            {/* Shown whenever present, never folded away: a consumer that
                ignores scale/offset reads numbers wrong by two orders of
                magnitude, and they look entirely plausible. */}
            {(summary.scale !== undefined || summary.offset !== undefined) && (
              <Row label="Packed">
                <Box sx={{ ...mono, color: theme.aa.color.status.warning }}>
                  scale {summary.scale ?? 1} · offset {summary.offset ?? 0}
                </Box>
              </Row>
            )}
            <Row label="Arrays">
              {formatCount(summary.arrayCount)}
              {summary.primaryArray ? ` · primary ${summary.primaryArray}` : ''}
            </Row>
            <Row label="Zarr">v{summary.zarrFormat ?? '?'}</Row>

            {/* ── Lineage ────────────────────────────────────────── */}
            <SectionTitle>Lineage</SectionTitle>
            <Row label="Produced by">
              {summary.provenance?.tool ? (
                <Box sx={mono}>
                  {summary.provenance.tool}
                  {summary.provenance.version ? ` ${summary.provenance.version}` : ''}
                </Box>
              ) : (
                '—'
              )}
            </Row>
            <Row label="Inputs">
              {summary.provenance?.parents?.length
                ? `${summary.provenance.parents.length} file(s)`
                : summary.write?.inputs
                  ? `${summary.write.inputs} file(s)`
                  : '—'}
            </Row>
            {summary.time && summary.time.length === 2 && (
              <Row label="Covers">
                <Box sx={{ ...mono, fontSize: 11.5 }}>
                  {summary.time[0]} → {summary.time[1]}
                </Box>
              </Row>
            )}
            {summary.report && (
              <Row label="QC report">
                <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                  <Box sx={{ ...mono, fontSize: 11.5, color: theme.aa.color.text.secondary }}>
                    {summary.report}
                  </Box>
                  <CopyPathButton value={summary.report} label="Copy report URI" alwaysVisible />
                </Box>
              </Row>
            )}
            <Row label="URI">
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.5 }}>
                <Box sx={{ ...mono, color: theme.aa.color.text.secondary }}>{summary.uri}</Box>
                <CopyPathButton value={summary.uri} label="Copy store URI" alwaysVisible />
              </Box>
            </Row>

            {/* ── Verdict ────────────────────────────────────────── */}
            {verdict && (
              <>
                <SectionTitle>Verify</SectionTitle>
                <Alert
                  severity={
                    verdict.exit === 0 ? 'success' : verdict.exit === 3 ? 'warning' : 'error'
                  }
                  sx={{ fontSize: 11.5, py: 0.25, mb: 0.5 }}
                >
                  {verdict.exit === 0
                    ? 'Complete and coherent.'
                    : verdict.exit === 3
                      ? 'Unfinished, and resumable.'
                      : 'Finished and wrong.'}
                </Alert>
                {verdict.problems.map((problem) => (
                  <Typography
                    key={problem}
                    sx={{ fontSize: 10.5, color: theme.aa.color.status.error, mb: 0.4 }}
                  >
                    • {problem}
                  </Typography>
                ))}
                {verdict.notes.map((note) => (
                  <Typography
                    key={note}
                    sx={{ fontSize: 10.5, color: theme.aa.color.text.muted, mb: 0.4 }}
                  >
                    • {note}
                  </Typography>
                ))}
              </>
            )}

            <Divider sx={{ my: 1.5 }} />
            <Typography sx={{ fontSize: 10, color: theme.aa.color.text.muted }}>
              Read from the store's own attributes by aa-store. A handle is a message and gets
              lost; these travel with the bytes.
            </Typography>
          </>
        )}
      </Box>

      {/* The only action, and it writes nothing. There is deliberately no Run
          button in this panel — see the note at the top of this file. */}
      <Box
        sx={{
          borderTop: `1px solid ${theme.aa.color.border.subtle}`,
          backgroundColor: theme.aa.color.bg.chrome,
          p: 1,
          display: 'flex',
          gap: 0.75,
          alignItems: 'center',
        }}
      >
        <Typography sx={{ fontSize: 10.5, color: theme.aa.color.text.muted, flex: 1 }}>
          Read-only
        </Typography>
        <Button
          size="small"
          variant="outlined"
          disabled={inspection.verifying || !summary}
          startIcon={
            inspection.verifying ? (
              <CircularProgress size={12} />
            ) : (
              <FactCheckOutlined sx={{ fontSize: 14 }} />
            )
          }
          onClick={() => void verifyStore(subject.uri)}
          sx={{ fontSize: 11.5 }}
        >
          Verify
        </Button>
        <Tooltip title="Treat missing chunks with no write marker as unfinished rather than as sparsity">
          <span style={{ display: 'flex' }}>
            <Button
              size="small"
              disabled={inspection.verifying || !summary}
              onClick={() => void verifyStore(subject.uri, { strict: true })}
              sx={{ fontSize: 11.5 }}
            >
              Strict
            </Button>
          </span>
        </Tooltip>
      </Box>
    </Box>
  );
}
