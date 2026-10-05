import { describe, expect, it } from 'vitest';

import { gcpApi, simulatedBucket } from '../src/services/gcpApi';
import { chooseGcp, forgetGcp, onGcpChange } from '../src/state/gcp';

/**
 * The project and bucket picker's client side. The server decides (gcp.py);
 * here: the stand-in behaves like it, and a change reaches everything that
 * reads the bucket.
 */

describe('the stand-in GCP API', () => {
  it('starts with nothing chosen and lists the AA-SI projects', async () => {
    await gcpApi.forget();
    expect((await gcpApi.get()).source).toBe('unset');
    const found = await gcpApi.discover();
    expect(found.projects.map((p) => p.id)).toEqual(['ggn-nmfs-aa-prod-1', 'ggn-nmfs-aa-dev-1']);
    expect(found.autoSelected).toBe(false); // two writable buckets: a choice to make
  });

  it('takes the project from the bucket name, and refuses a bad name', async () => {
    const chosen = await gcpApi.choose('', 'gs://ggn-nmfs-aa-prod-1-data/');
    expect(chosen).toMatchObject({ project: 'ggn-nmfs-aa-prod-1', bucket: 'ggn-nmfs-aa-prod-1-data', source: 'chosen' });
    expect(simulatedBucket()).toBe('ggn-nmfs-aa-prod-1-data');
    await expect(gcpApi.choose('', 'Not A Bucket')).rejects.toThrow(/bucket/);
    await gcpApi.forget();
  });
});

describe('the GCP store', () => {
  it('tells everything that reads the bucket when it changes', async () => {
    const heard: string[] = [];
    const stop = onGcpChange(() => heard.push('changed'));
    expect(await chooseGcp('ggn-nmfs-aa-dev-1', 'ggn-nmfs-aa-dev-1-data')).toBe(true);
    await forgetGcp();
    expect(await chooseGcp('', 'NO')).toBe(false);
    stop();
    await chooseGcp('ggn-nmfs-aa-dev-1', 'ggn-nmfs-aa-dev-1-data');
    expect(heard).toEqual(['changed', 'changed']);
    await forgetGcp();
  });
});
