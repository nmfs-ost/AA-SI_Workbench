import { describe, expect, it } from 'vitest';

import { cleanAccounts, describeCard, type RemoteCard } from '../src/services/remoteApi';

/**
 * The Remote requests dialog's helpers. Who may start a run is decided by the
 * server (api/remote.py, tested there); this is how the list is kept and a
 * request is described.
 */

describe('the accounts list', () => {
  it('keeps one clean address per entry', () => {
    expect(cleanAccounts(' Jane.Doe@NOAA.gov \n\njane.doe@noaa.gov, app@x.iam.gserviceaccount.com;')).toEqual([
      'jane.doe@noaa.gov',
      'app@x.iam.gserviceaccount.com',
    ]);
  });

  it('is empty for nothing', () => {
    expect(cleanAccounts('  \n ')).toEqual([]);
  });
});

describe('a request in a line', () => {
  const card: RemoteCard = {
    source: 'ncei',
    vessel: 'Henry_B._Bigelow',
    survey: 'HB1603',
    sonar: 'EK60',
    start: '2016-07-03T06:00:00',
    end: '2016-07-03T12:00:00',
    streamed: true,
    format: 'zarr',
    sv: true,
    echogram: true,
    base: '',
    note: '',
  };

  it('says what will be made, and how', () => {
    expect(describeCard(card)).toBe(
      'Henry_B._Bigelow HB1603 EK60, 2016-07-03T06:00:00 to 2016-07-03T12:00:00 UTC: EchoData and Sv (Zarr, file by file into the bucket)',
    );
    expect(describeCard({ ...card, streamed: false, format: 'nc', sv: false })).toMatch(/: EchoData \(NetCDF\)$/);
  });

  it('names a source other than NCEI, and a chosen name', () => {
    expect(describeCard({ ...card, source: 'omao', base: 'test_run' })).toBe(
      'Henry_B._Bigelow HB1603 EK60 from omao, 2016-07-03T06:00:00 to 2016-07-03T12:00:00 UTC: EchoData and Sv (Zarr, file by file into the bucket), named test_run',
    );
  });
});
