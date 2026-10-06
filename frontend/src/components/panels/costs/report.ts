/**
 * The Storage costs panel's words and files: what is copied into a report and
 * downloaded as CSV. No React here, so it is tested on its own.
 */

import { formatMoney, formatRate, type CostSummary, type Prices, type Share } from '../../../services/costsApi';
import { formatBytes } from '../rowFormat';

export const FOLDERS_SHOWN = 10;

/** The first `n` folders, and the rest as one line. */
export function collapse(shares: Share[], n: number): Share[] {
  if (shares.length <= n + 1) return shares;
  const rest = shares.slice(n);
  return [
    ...shares.slice(0, n),
    {
      name: `${rest.length} more`,
      path: '',
      objects: rest.reduce((a, x) => a + x.objects, 0),
      bytes: rest.reduce((a, x) => a + x.bytes, 0),
      monthly: rest.reduce((a, x) => a + x.monthly, 0),
    },
  ];
}

export function priceLine(prices: Prices): string {
  const standard = prices.perGiBMonth.STANDARD ?? 0;
  return prices.custom !== null
    ? `At ${prices.customLabel || 'our own price'}: ${formatRate(standard)} for every class.`
    : `At Google’s list price, ${prices.location ? prices.location.toLowerCase() : prices.tableLabel}: Standard ${formatRate(standard)}${prices.assumed ? ' (location assumed)' : ''}.`;
}

/** Plain text for a report or an email. */
export function summaryText(sum: CostSummary): string {
  const where = `gs://${sum.bucket}/${sum.prefix}`;
  const lines = [
    `Storage cost estimate, ${where}`,
    `Counted ${sum.computedAt.replace('T', ' ').replace('Z', ' UTC')}: ${formatBytes(sum.bytes) || '0 B'} in ${sum.objects.toLocaleString()} objects`,
    `Per month: ${formatMoney(sum.monthly)}    Per year: ${formatMoney(sum.yearly)}`,
    priceLine(sum.prices),
    '',
    'By folder:',
    ...collapse(sum.byFolder, FOLDERS_SHOWN).map((f) => `  ${f.name.padEnd(34)} ${(formatBytes(f.bytes) || '0 B').padStart(9)}  ${formatMoney(f.monthly).padStart(10)}/month`),
    '',
    'Storage at rest only (operations, retrieval and egress are billed separately); estimates, Google’s invoice is the record.',
  ];
  return lines.join('\n');
}

function csvCell(value: string | number): string {
  const text = String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Folders and largest products, as one CSV. */
export function summaryCsv(sum: CostSummary): string {
  const rows: (string | number)[][] = [['section', 'name', 'path', 'objects', 'bytes', 'usd_per_month', 'usd_per_year']];
  for (const f of sum.byFolder) rows.push(['folder', f.name, f.path, f.objects, f.bytes, f.monthly.toFixed(6), (f.monthly * 12).toFixed(6)]);
  for (const x of sum.byClass) rows.push(['class', x.name, '', x.objects, x.bytes, x.monthly.toFixed(6), (x.monthly * 12).toFixed(6)]);
  for (const p of sum.largest) rows.push(['product', p.name, p.path, p.objects, p.bytes, p.monthly.toFixed(6), (p.monthly * 12).toFixed(6)]);
  rows.push(['total', '', sum.prefix, sum.objects, sum.bytes, sum.monthly.toFixed(6), sum.yearly.toFixed(6)]);
  return rows.map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
