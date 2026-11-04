import { describe, expect, it } from 'vitest';

import type { AccountCheck } from '../src/services/identityApi';
import { accountSummary } from '../src/state/accountCheck';

/**
 * What the status bar says about the account. The check itself is the
 * server's (identity.py, tested there); this is how its answer is shown.
 */

const item = (id: string, state: AccountCheck['state'], detail = `${id} detail`) => ({
  id,
  label: `${id} label`,
  state,
  detail,
  fix: '',
  fixNote: '',
});

const check = (state: AccountCheck['state'], items: ReturnType<typeof item>[]): AccountCheck => ({
  state,
  principal: 'colleague@noaa.gov',
  uploader: 'colleague@noaa.gov',
  folder: 'gs://ggn-nmfs-aa-prod-1-data/derived_products/colleague/',
  checks: items,
});

describe('the account in the status bar', () => {
  it('before the check answers, no account is a warning', () => {
    expect(accountSummary('', '', null)).toMatchObject({ tone: 'warn', text: 'No account' });
    expect(accountSummary('ada@noaa.gov', 'Signed in as ada@noaa.gov.', null)).toEqual({
      tone: 'ok',
      text: 'ada@noaa.gov',
      tooltip: 'Signed in as ada@noaa.gov.',
    });
  });

  it('takes the worst state, and names the first problem, worst first', () => {
    const summary = accountSummary(
      'colleague@noaa.gov',
      '',
      check('fail', [
        item('account', 'warn', 'gcloud’s account setting is “ACCOUNT”.'),
        item('uploads', 'ok'),
        item('bucket', 'fail', 'no access'),
      ]),
    );
    expect(summary.tone).toBe('fail');
    expect(summary.tooltip).toBe('bucket label: no access Click for the account check.');
  });

  it('a placeholder account is a warning that says so', () => {
    const summary = accountSummary(
      'colleague@noaa.gov',
      '',
      check('warn', [item('account', 'warn', 'gcloud’s account setting is “ACCOUNT”.'), item('uploads', 'ok'), item('bucket', 'ok')]),
    );
    expect(summary.tone).toBe('warn');
    expect(summary.tooltip).toContain('“ACCOUNT”');
  });

  it('when all is well, says where products go', () => {
    const summary = accountSummary(
      'colleague@noaa.gov',
      '',
      check('ok', [item('account', 'ok'), item('uploads', 'ok'), item('bucket', 'ok')]),
    );
    expect(summary.tone).toBe('ok');
    expect(summary.tooltip).toContain('derived_products/colleague/');
  });
});
