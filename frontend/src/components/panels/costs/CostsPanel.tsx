import { useEffect, useState } from 'react';
import type { FunctionComponent, ReactNode } from 'react';
import type { IDockviewPanelProps } from 'dockview';
import {
  Box,
  Button,
  CircularProgress,
  IconButton,
  InputBase,
  Link,
  Tooltip,
  Typography,
  alpha,
  useTheme,
  type Theme,
} from '@mui/material';
import {
  ContentCopyOutlined,
  FileDownloadOutlined,
  LayersOutlined,
  RefreshOutlined,
  SavingsOutlined,
} from '@mui/icons-material';

import { CLASS_LABEL, formatMoney, type CostSummary, type Prices, type Share } from '../../../services/costsApi';
import { useLayout } from '../../../context/LayoutContext';
import { getCosts, initCosts, loadSummary, setOwnPrice, useCosts } from '../../../state/costs';
import { revealInDerived } from '../../../state/derivedReveal';
import { PanelBar, PanelHeader } from '../PanelHeader';
import { FOLDERS_SHOWN, collapse, priceLine, summaryCsv, summaryText } from './report';
import { formatBytes, formatRelativeTime } from '../rowFormat';

/**
 * What the bucket's storage costs, for the people who pay for it: per month
 * and per year, by folder (people, surveys), by storage class, and the largest
 * products. Estimates of storage at rest from Google's list prices for the
 * bucket's location, or from the team's own price when one is set.
 */
export const CostsPanel: FunctionComponent<IDockviewPanelProps> = () => {
  const theme = useTheme();
  const c = theme.aa.color;
  const s = useCosts();
  const { openPanel } = useLayout();
  const [copied, setCopied] = useState(false);

  // Counted on first sight (kept by the server for 10 minutes); a folder asked
  // for from Products is already on its way.
  useEffect(() => {
    initCosts();
    const now = getCosts();
    if (!now.summary && !now.loading) void loadSummary(now.scope);
  }, []);

  const sum = s.summary;
  const prices = sum?.prices ?? s.prices;
  const bucket = sum?.bucket || prices?.bucket || '';
  const crumbs = ['', ...s.scope.split('/').filter(Boolean).map((_, i, all) => `${all.slice(0, i + 1).join('/')}/`)];

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0, backgroundColor: c.bg.panel }}>
      <PanelHeader
        icon={<SavingsOutlined className="panel-header-icon" />}
        title="Storage costs"
        subtitle={bucket ? `gs://${bucket}/${s.scope}` : undefined}
        actions={
          <>
            {sum && (
              <>
                <Tooltip title={copied ? 'Copied' : 'Copy a summary for a report'}>
                  <IconButton
                    size="small"
                    onClick={() =>
                      void navigator.clipboard?.writeText(summaryText(sum)).then(() => {
                        setCopied(true);
                        setTimeout(() => setCopied(false), 1500);
                      })
                    }
                  >
                    <ContentCopyOutlined sx={{ fontSize: 14 }} />
                  </IconButton>
                </Tooltip>
                <Tooltip title="Download as CSV (folders and largest products)">
                  <IconButton size="small" onClick={() => download(sum)}>
                    <FileDownloadOutlined sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              </>
            )}
            <Tooltip title="Count again (the figures are kept for 10 minutes)">
              <span>
                <IconButton size="small" disabled={s.loading} onClick={() => void loadSummary(s.scope, true)}>
                  <RefreshOutlined sx={{ fontSize: 15 }} />
                </IconButton>
              </span>
            </Tooltip>
          </>
        }
      />
      <PanelBar sx={{ gap: 0.25 }}>
        {crumbs.map((crumb, i) => (
          <Box key={crumb} sx={{ display: 'flex', alignItems: 'center', minWidth: 0 }}>
            {i > 0 && <Typography sx={{ fontSize: 11.5, color: c.text.muted, px: 0.25 }}>/</Typography>}
            <Button
              size="small"
              onClick={() => void loadSummary(crumb)}
              disabled={crumb === s.scope}
              sx={{
                fontSize: 11.5,
                textTransform: 'none',
                minWidth: 0,
                px: 0.5,
                py: 0,
                color: c.text.secondary,
                '&.Mui-disabled': { color: c.text.primary, fontWeight: 600 },
              }}
            >
              {i === 0 ? 'Whole bucket' : crumb.split('/').filter(Boolean).pop()}
            </Button>
          </Box>
        ))}
        <Box sx={{ flex: 1 }} />
        {sum && (
          <Typography sx={{ fontSize: 10.5, color: c.text.muted }} noWrap>
            counted {countedAgo(sum.computedAt)} · {sum.objects.toLocaleString()} objects
          </Typography>
        )}
      </PanelBar>

      <Box sx={{ flex: 1, minHeight: 0, overflow: 'auto', p: 1.5, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {s.loading && !sum && (
          <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
            <CircularProgress size={14} />
            <Typography sx={{ fontSize: 12, color: c.text.secondary }}>
              Counting what is stored (every object’s size and class; a large bucket takes a minute)…
            </Typography>
          </Box>
        )}
        {s.error && <Typography sx={{ fontSize: 12, color: c.status.error }}>{s.error}</Typography>}

        {sum && prices && (
          <>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 1.25 }}>
              <Kpi label="Per month" value={formatMoney(sum.monthly)} exact={formatMoney(sum.monthly, { exact: true })} accent />
              <Kpi label="Per year" value={formatMoney(sum.yearly)} exact={formatMoney(sum.yearly, { exact: true })} />
              <Kpi
                label="Stored"
                value={formatBytes(sum.bytes) || '0 B'}
                detail={`${sum.objects.toLocaleString()} objects${sum.truncated ? ' (first 500,000 counted)' : ''}`}
              />
            </Box>
            <Typography sx={{ fontSize: 11.5, color: c.text.secondary, mt: -1 }}>
              {priceLine(prices)}
              {s.loading && ' · counting again…'}
            </Typography>

            <Section
              title={sum.prefix ? 'Inside this folder' : 'By folder'}
              note={sum.byFolder.some((f) => f.name.endsWith('/')) ? 'click a folder to look inside it' : undefined}
            >
              <Bars
                shares={collapse(sum.byFolder, FOLDERS_SHOWN)}
                total={sum.monthly}
                onPick={(share) => (share.path && share.name.endsWith('/') ? void loadSummary(share.path) : undefined)}
              />
            </Section>

            <Section title="By storage class" note="colder classes cost less to keep, more to read back">
              <Bars shares={sum.byClass.map((x) => ({ ...x, name: CLASS_LABEL[x.name] ?? x.name }))} total={sum.monthly} />
            </Section>

            <Section title="Largest products" note="a Zarr store counted whole; a product with its record">
              <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <Box component="thead">
                  <Box component="tr" sx={{ color: c.text.muted, fontSize: 10.5, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                    <Box component="th" sx={{ textAlign: 'left', fontWeight: 500, py: 0.5 }}>Product</Box>
                    <Box component="th" sx={{ textAlign: 'right', fontWeight: 500, width: 80 }}>Size</Box>
                    <Box component="th" sx={{ textAlign: 'right', fontWeight: 500, width: 80 }}>Month</Box>
                    <Box component="th" sx={{ textAlign: 'right', fontWeight: 500, width: 80 }}>Year</Box>
                    <Box component="th" sx={{ width: 32 }} />
                  </Box>
                </Box>
                <Box component="tbody">
                  {sum.largest.map((p) => (
                    <Box component="tr" key={p.path} sx={{ borderTop: `1px solid ${alpha(c.border.subtle, 0.6)}` }}>
                      <Box component="td" title={p.path} sx={{ py: 0.5, color: c.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 0, width: '100%' }}>
                        {p.name}
                      </Box>
                      <Box component="td" sx={num(c.text.secondary)}>{formatBytes(p.bytes)}</Box>
                      <Box component="td" title={formatMoney(p.monthly, { exact: true })} sx={num(c.text.primary)}>
                        {formatMoney(p.monthly)}
                      </Box>
                      <Box component="td" title={formatMoney(p.monthly * 12, { exact: true })} sx={num(c.text.secondary)}>
                        {formatMoney(p.monthly * 12)}
                      </Box>
                      <Box component="td" sx={{ textAlign: 'right' }}>
                        <Tooltip title="Show in Products">
                          <IconButton
                            size="small"
                            onClick={() => {
                              revealInDerived(`gs://${sum.bucket}/${p.path}`);
                              openPanel('derived');
                            }}
                          >
                            <LayersOutlined sx={{ fontSize: 14 }} />
                          </IconButton>
                        </Tooltip>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Section>

            <PriceSection prices={prices} saving={s.saving} />
          </>
        )}
      </Box>
    </Box>
  );
};


function Kpi({
  label,
  value,
  exact,
  detail,
  accent = false,
}: {
  label: string;
  value: string;
  /** The unrounded figure, on hover. */
  exact?: string;
  detail?: string;
  accent?: boolean;
}) {
  const theme = useTheme();
  const c = theme.aa.color;
  return (
    <Box
      sx={{
        border: `1px solid ${accent ? alpha(c.accent.main, 0.5) : c.border.subtle}`,
        backgroundColor: accent ? alpha(c.accent.main, 0.07) : c.bg.elevated,
        borderRadius: `${theme.aa.radius.md}px`,
        px: 1.5,
        py: 1.1,
      }}
    >
      <Typography sx={{ fontSize: 10.5, color: c.text.muted, textTransform: 'uppercase', letterSpacing: 0.6 }}>{label}</Typography>
      <Typography
        title={exact}
        sx={{ fontSize: 26, fontWeight: 600, color: c.text.primary, lineHeight: 1.25, fontVariantNumeric: 'tabular-nums' }}
      >
        {value}
      </Typography>
      {detail && <Typography sx={{ fontSize: 11, color: c.text.secondary }}>{detail}</Typography>}
    </Box>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  const theme = useTheme();
  const c = theme.aa.color;
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.75 }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 600, color: c.text.primary }}>{title}</Typography>
        {note && <Typography sx={{ fontSize: 11, color: c.text.muted }}>{note}</Typography>}
      </Box>
      {children}
    </Box>
  );
}

function Bars({ shares, total, onPick }: { shares: Share[]; total: number; onPick?: (share: Share) => void }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const max = Math.max(1e-12, ...shares.map((x) => x.monthly));
  if (!shares.length) return <Typography sx={{ fontSize: 11.5, color: c.text.muted }}>Nothing stored here.</Typography>;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
      {shares.map((x) => {
        const pickable = Boolean(onPick && x.path && x.name.endsWith('/'));
        const pct = total > 0 ? (x.monthly / total) * 100 : 0;
        return (
          <Box
            key={x.name + x.path}
            onClick={pickable ? () => onPick?.(x) : undefined}
            title={pickable ? `Show what is inside ${x.name}` : undefined}
            sx={{
              display: 'grid',
              gridTemplateColumns: 'minmax(90px, 1.1fr) 2fr 70px 76px 44px',
              alignItems: 'center',
              gap: 1,
              fontSize: 12,
              py: 0.25,
              px: 0.5,
              borderRadius: `${theme.aa.radius.sm}px`,
              cursor: pickable ? 'pointer' : 'default',
              '&:hover': pickable ? { backgroundColor: c.bg.hover } : undefined,
            }}
          >
            <Typography sx={{ fontSize: 12, color: c.text.primary }} noWrap>
              {x.name}
            </Typography>
            <Box sx={{ height: 10, borderRadius: 5, backgroundColor: alpha(c.text.muted, 0.12), overflow: 'hidden' }}>
              <Box sx={{ width: `${Math.max(0.5, (x.monthly / max) * 100)}%`, height: '100%', backgroundColor: c.accent.main, borderRadius: 5 }} />
            </Box>
            <Typography sx={{ fontSize: 11, color: c.text.secondary, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {formatBytes(x.bytes) || '0 B'}
            </Typography>
            <Typography
              title={`${formatMoney(x.monthly, { exact: true })} a month · ${formatMoney(x.monthly * 12, { exact: true })} a year`}
              sx={{ fontSize: 12, color: c.text.primary, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}
            >
              {formatMoney(x.monthly)}
            </Typography>
            <Typography sx={{ fontSize: 11, color: c.text.muted, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {pct >= 0.5 ? `${Math.round(pct)}%` : '<1%'}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
}

function PriceSection({ prices, saving }: { prices: Prices; saving: boolean }) {
  const theme = useTheme();
  const c = theme.aa.color;
  const [rate, setRate] = useState(prices.custom === null ? '' : String(prices.custom));
  const [label, setLabel] = useState(prices.customLabel);
  useEffect(() => {
    setRate(prices.custom === null ? '' : String(prices.custom));
    setLabel(prices.customLabel);
  }, [prices.custom, prices.customLabel]);
  const value = Number(rate);
  const valid = rate.trim() !== '' && Number.isFinite(value) && value >= 0 && value <= 10;
  const where = prices.location ? `${prices.location.toLowerCase()} (${prices.locationType || 'location'})` : prices.tableLabel;
  return (
    <Section title="Price used">
      <Box
        sx={{
          border: `1px solid ${c.border.subtle}`,
          borderRadius: `${theme.aa.radius.md}px`,
          p: 1.25,
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}
      >
        <Typography sx={{ fontSize: 12, color: c.text.primary, lineHeight: 1.5 }}>
          Google’s list price for {where}, per GiB-month:{' '}
          {Object.entries(prices.listPerGiBMonth)
            .map(([cls, r]) => `${CLASS_LABEL[cls] ?? cls} $${r.toFixed(r >= 0.01 ? 3 : 4)}`)
            .join(' · ')}{' '}
          <Link href={prices.source} target="_blank" rel="noopener noreferrer" sx={{ fontSize: 11.5 }}>
            (as of {prices.asOf})
          </Link>
        </Typography>
        {prices.note && <Typography sx={{ fontSize: 11.5, color: c.status.warning }}>{prices.note}</Typography>}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: 12, color: c.text.secondary }}>Our own price</Typography>
          <InputBase
            value={rate}
            onChange={(e) => setRate(e.target.value)}
            placeholder={String(prices.listPerGiBMonth.STANDARD ?? '')}
            inputProps={{ 'aria-label': 'Our price per GiB-month', inputMode: 'decimal' }}
            startAdornment={<span style={{ color: c.text.muted, marginRight: 2 }}>$</span>}
            sx={field(theme, 96, rate !== '' && !valid)}
          />
          <Typography sx={{ fontSize: 12, color: c.text.muted }}>per GiB-month, called</Typography>
          <InputBase
            value={label}
            onChange={(e) => setLabel(e.target.value.slice(0, 60))}
            placeholder="Our price"
            inputProps={{ 'aria-label': 'Name of our price' }}
            sx={field(theme, 150, false)}
          />
          <Button size="small" variant="outlined" disabled={!valid || saving} onClick={() => void setOwnPrice(value, label)} sx={{ fontSize: 11.5, textTransform: 'none' }}>
            Use it
          </Button>
          {prices.custom !== null && (
            <Button size="small" disabled={saving} onClick={() => void setOwnPrice(null, '')} sx={{ fontSize: 11.5, textTransform: 'none' }}>
              Back to the list price
            </Button>
          )}
        </Box>
        <Typography sx={{ fontSize: 11, color: c.text.muted, lineHeight: 1.5 }}>
          Storage at rest only. Operations, retrieval from colder classes, early deletion (Nearline,
          Coldline and Archive are billed for at least 30, 90 and 365 days) and network egress are billed
          separately. These are estimates; Google’s invoice is the record. Storage bought in advance
          can be entered as our own price.
        </Typography>
      </Box>
    </Section>
  );
}

function field(theme: Theme, width: number, bad: boolean) {
  const c = theme.aa.color;
  return {
    fontSize: 12,
    width,
    px: 0.75,
    border: `1px solid ${bad ? c.status.error : c.border.subtle}`,
    borderRadius: `${theme.aa.radius.sm}px`,
  } as const;
}

function num(color: string) {
  return { textAlign: 'right', color, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap', pl: 1 } as const;
}

function countedAgo(iso: string): string {
  const ago = formatRelativeTime(iso);
  return ago === 'now' ? 'just now' : /^\d+[mhd]$/.test(ago) ? `${ago} ago` : `on ${ago}`;
}

function download(sum: CostSummary): void {
  const blob = new Blob([summaryCsv(sum)], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `storage-cost_${sum.bucket}_${sum.prefix.replace(/\//g, '_') || 'bucket'}_${sum.computedAt.slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
