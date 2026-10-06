import { describe, expect, it } from 'vitest';

import { formatMoney, formatRate, monthlyCost, type CostSummary, type Prices } from '../src/services/costsApi';
import { collapse, priceLine, summaryCsv, summaryText } from '../src/components/panels/costs/report';

/**
 * Storage cost figures: what a size costs a month, and the words and files
 * the figures go out in. The prices themselves come from the server
 * (api/costs.py, tested there); these are Google's list prices for a US region.
 */

const GIB = 1024 ** 3;

const prices: Prices = {
  bucket: 'b',
  location: 'US-CENTRAL1',
  locationType: 'region',
  defaultClass: 'STANDARD',
  assumed: false,
  table: 'us-region',
  tableLabel: 'US region',
  perGiBMonth: { STANDARD: 0.02, NEARLINE: 0.01, COLDLINE: 0.004, ARCHIVE: 0.0012 },
  listPerGiBMonth: { STANDARD: 0.02, NEARLINE: 0.01, COLDLINE: 0.004, ARCHIVE: 0.0012 },
  custom: null,
  customLabel: '',
  minimumDays: { STANDARD: 0, NEARLINE: 30, COLDLINE: 90, ARCHIVE: 365 },
  source: 'https://cloud.google.com/storage/pricing',
  asOf: '2026-10-06',
  note: '',
};

describe('cost of an object', () => {
  it('is its size in GiB times the rate for its class', () => {
    expect(monthlyCost(50 * GIB, 'STANDARD', prices)).toBeCloseTo(1.0);
    expect(monthlyCost(50 * GIB, 'archive', prices)).toBeCloseTo(0.06);
    // No class recorded: Standard.
    expect(monthlyCost(GIB, '', prices)).toBeCloseTo(0.02);
  });

  it('reads as dollars and cents', () => {
    expect(formatMoney(1234.567)).toBe('$1,235');
    expect(formatMoney(12.345)).toBe('$12.35');
    expect(formatMoney(0.4)).toBe('$0.40');
    expect(formatMoney(0.0039)).toBe('<$0.01');
    expect(formatMoney(0)).toBe('$0.00');
    expect(formatMoney(0.0039, { exact: true })).toBe('$0.0039');
    expect(formatMoney(12.3456, { exact: true })).toBe('$12.35');
    expect(formatRate(0.02)).toBe('$0.020 per GiB-month');
    expect(formatRate(0.0012)).toBe('$0.0012 per GiB-month');
  });
});

describe('a folder summary', () => {
  const share = (name: string, gib: number) => ({ name, path: `p/${name}`, objects: 1, bytes: gib * GIB, monthly: gib * 0.02 });
  const sum: CostSummary = {
    bucket: 'b',
    prefix: 'derived_products/',
    objects: 3,
    bytes: 60 * GIB,
    monthly: 1.2,
    yearly: 14.4,
    byClass: [{ name: 'STANDARD', path: '', objects: 3, bytes: 60 * GIB, monthly: 1.2 }],
    byFolder: [share('jane/', 50), share('bob/', 10)],
    largest: [share('HB1603_L1.nc', 50)],
    prices,
    truncated: false,
    computedAt: '2026-10-06T19:00:00Z',
    seconds: 0.4,
  };

  it('folds the long tail into one line', () => {
    const many = Array.from({ length: 14 }, (_, i) => share(`f${i}/`, 14 - i));
    const out = collapse(many, 10);
    expect(out).toHaveLength(11);
    expect(out[10].name).toBe('4 more');
    expect(out[10].bytes).toBe((4 + 3 + 2 + 1) * GIB);
    expect(collapse(many.slice(0, 11), 10)).toHaveLength(11); // one more is shown, not folded
  });

  it('says what price it used', () => {
    expect(priceLine(prices)).toContain('list price');
    expect(priceLine({ ...prices, custom: 0.015, customLabel: 'NOAA contract', perGiBMonth: { STANDARD: 0.015 } })).toBe(
      'At NOAA contract: $0.015 per GiB-month for every class.',
    );
  });

  it('copies as text and downloads as CSV', () => {
    const text = summaryText(sum);
    expect(text).toContain('Per month: $1.20    Per year: $14.40');
    expect(text).toContain('jane/');
    const csv = summaryCsv(sum).trim().split('\n');
    expect(csv[0]).toBe('section,name,path,objects,bytes,usd_per_month,usd_per_year');
    expect(csv).toContain(`folder,jane/,p/jane/,1,${50 * GIB},1.000000,12.000000`);
    expect(csv[csv.length - 1]).toBe(`total,,derived_products/,3,${60 * GIB},1.200000,14.400000`);
  });
});
