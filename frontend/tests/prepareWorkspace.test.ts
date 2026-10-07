import { describe, expect, it } from 'vitest';

import { freeLine, pathArg, toScript } from '../src/components/panels/prepare/CommandsSection';
import { formatSize } from '../src/components/panels/prepare/WorkspaceStep';
import { planRange } from '../src/components/panels/prepare/plan';
import type { PlanFile } from '../src/components/panels/prepare/plan';
import type { Preview } from '../src/services/baselineApi';
import { baselineApi, simSpaceNeeded } from '../src/services/baselineApi';
import { buildRequest } from '../src/state/prepare';
import { idFromName } from '../src/components/panels/prepare/SourcesDialog';

/**
 * Working space: where a run works, and freeing space as it goes. The server
 * owns the arithmetic and the deletions; the card shows them, and the copied
 * script must delete what the runner deletes, at the same points.
 */

describe('formatSize', () => {
  it('uses decimal units, as the server words its messages', () => {
    expect(formatSize(0)).toBe('0 B');
    expect(formatSize(999)).toBe('999 B');
    expect(formatSize(1_500_000)).toBe('1.5 MB');
    expect(formatSize(123_000_000_000)).toBe('123 GB');
    expect(formatSize(4_100_000_000_000)).toBe('4.1 TB');
  });
});

describe('the stand-in estimate', () => {
  it('is the server formula: kept, everything adds up; freed, the largest pair', () => {
    const raw = 1e9;
    expect(simSpaceNeeded(raw, false, true, false)).toBe(Math.floor((1 + 2.2 + 2.2 + 4.5) * raw * 1.15));
    expect(simSpaceNeeded(raw, false, true, true)).toBe(Math.floor((2.2 + 4.5) * raw * 1.15));
    expect(simSpaceNeeded(raw, false, false, true)).toBe(Math.floor(4.4 * raw * 1.15));
    expect(simSpaceNeeded(raw, true, false, false)).toBe(Math.floor(3.2 * raw * 1.15));
  });

  it('refuses what cannot fit, and says how big the folder is', async () => {
    const r = request({ expectedBytes: 200e9 });
    const ws = await baselineApi.workspace(r);
    expect(ws.problem).toMatch(/working space/);
    const small = await baselineApi.workspace(request({ expectedBytes: 1e9 }));
    expect(small.problem).toBe('');
    expect(small.needBytes).toBe(small.needFreeingBytes);
    const kept = await baselineApi.workspace(request({ expectedBytes: 1e9, keepLocal: true }));
    expect(kept.freeing).toBe(false);
    expect(kept.needBytes).toBe(kept.needKeepingBytes);
  });
});

describe('freeLine', () => {
  it('deletes a pattern under $RUN with its wildcards unquoted', () => {
    expect(freeLine('raw/*.raw')).toBe('rm -rf -- "$RUN"/raw/*.raw');
  });
  it('finds a file at any depth for **/', () => {
    expect(freeLine('cache/**/HB1603_EK60.nc')).toBe(
      'find "$RUN/cache" -name HB1603_EK60.nc -prune -exec rm -rf {} +',
    );
  });
});

describe('toScript', () => {
  const preview: Preview = {
    base: 'HB',
    destination: 'gs://b/derived_products/u/V/HB/HB/',
    workRoot: '/data/aa runs',
    assets: [],
    stages: [
      { id: 'fetch', label: 'Fetch', tool: 'aa-fetch', level: 'L0', description: 'd',
        command: ['aa-fetch', '/data/aa runs/<run>/HB.yaml', '-o', '/data/aa runs/<run>', '-n', 'raw'],
        frees: [] },
      { id: 'convert', label: 'Convert', tool: 'aa-ed', level: 'L1', description: 'd',
        command: ['aa-ed', '/data/aa runs/<run>/raw', '--sonar_model', 'EK60'], frees: ['raw/*.raw'] },
      { id: 'sv', label: 'Calibrate', tool: 'aa-sv', level: 'L2A', description: 'd',
        command: ['aa-sv', 'gs://b/HB.nc', '--dest', 'gs://b/'], frees: ['cache/**/HB.nc'] },
    ],
  };

  it('makes $RUN in the working folder and frees files where the runner does', () => {
    const script = toScript(preview);
    expect(script).toContain("mkdir -p '/data/aa runs'");
    expect(script).toContain("RUN=$(mktemp -d '/data/aa runs/run.XXXXXX')");
    const lines = script.split('\n');
    const convert = lines.findIndex((l) => l.startsWith('aa-ed'));
    expect(lines[convert + 2]).toBe('rm -rf -- "$RUN"/raw/*.raw');
    expect(lines[convert]).toContain('$RUN/raw');
    expect(script).toContain('find "$RUN/cache" -name HB.nc -prune -exec rm -rf {} +');
  });

  it('keeps a leading ~/ expandable', () => {
    expect(toScript({ ...preview, workRoot: '~/aa-workbench-runs' })).toContain(
      "RUN=$(mktemp -d ~/'aa-workbench-runs/run.XXXXXX')",
    );
  });

  it('never lets a folder name run or expand anything', () => {
    expect(pathArg('/x/$HOME/`id`/a\\')).toBe("'/x/$HOME/`id`/a\\'");
    expect(pathArg("/x/it's")).toBe("'/x/it'\\''s'");
  });

  it('copies from a folder archive into $RUN, making the folder first', () => {
    const script = toScript({
      ...preview,
      source: 'OMAO',
      scratch: '/data/aa runs/<run>',
      stages: [
        { id: 'fetch', label: 'Fetch', tool: 'cp', level: 'L0', description: 'Copy the raw files from OMAO.',
          command: ['cp', '-p', '--', '/mnt/omao/V/S/EK60/D1.raw', '/data/aa runs/<run>/raw/'], frees: [] },
      ],
    });
    expect(script).toContain('# HB: OMAO -> EchoData');
    const lines = script.split('\n');
    const copy = lines.findIndex((l) => l.startsWith('cp '));
    expect(lines[copy - 1]).toBe('mkdir -p "$RUN/raw/"');
    expect(lines[copy]).toBe('cp -p -- /mnt/omao/V/S/EK60/D1.raw "$RUN/raw/"');
  });

  it('falls back to a temporary folder when no working folder is named', () => {
    expect(toScript({ ...preview, workRoot: undefined })).toContain('RUN=$(mktemp -d)');
  });
});

describe('sources', () => {
  it('get an id from their name', () => {
    expect(idFromName('  Shimada share (2024) ')).toBe('shimada-share-2024');
    expect(idFromName('OMAO')).toBe('omao');
  });
});

describe('buildRequest', () => {
  it('carries the working folder, the freeing choice and the size to fetch', () => {
    const files: PlanFile[] = [
      { name: 'D20160703-T060000.raw', acquiredAt: '2016-07-03T06:00:00Z', sizeBytes: 300 },
      { name: 'D20160703-T062000.raw', acquiredAt: '2016-07-03T06:20:00Z', sizeBytes: 500 },
    ];
    const plan = planRange(files, Date.parse('2016-07-03T06:00:00Z'), Date.parse('2016-07-03T06:30:00Z'), 900, 6)!;
    const state = defaultState();
    const r = buildRequest(
      { ...state, workRoot: '  /data/runs ', freeAsYouGo: false, vessel: null, survey: null, sonar: null,
        start: '2016-07-03 06:00:00', end: '2016-07-03 06:30:00' },
      plan,
    );
    expect(r.workRoot).toBe('/data/runs');
    expect(r.freeAsYouGo).toBe(false);
    expect(r.expectedBytes).toBe(800);
  });
});

/** A fresh form, as the card starts. */
function defaultState() {
  return {
    vessels: [], surveys: [], sonars: [], files: [], vessel: null, survey: null, sonar: null,
    loading: { vessels: false, surveys: false, sonars: false, files: false }, catalogError: '',
    start: '', end: '', sv: true, echogram: true, format: 'nc' as const, base: '', bucket: '',
    gapSeconds: 900, gapFactor: 6, strict: false, keepLocal: false, workRoot: '', freeAsYouGo: true,
    echogramOptions: { vmin: -80, vmax: -30, decimate: 10, cmap: 'viridis' },
    waveformMode: 'CW' as const, encodeMode: 'complex' as const,
    config: null, configError: '', run: null, starting: false, runError: '',
  };
}

function request(patch: Partial<ReturnType<typeof base>>) {
  return { ...base(), ...patch };
}

function base() {
  return {
    vessel: 'Henry_B._Bigelow', survey: 'HB1603', sonar: 'EK60',
    start: '2016-07-03T06:00:00', end: '2016-07-03T07:00:00', fetchFrom: '', fetchTo: '',
    expectedFiles: ['a.raw', 'b.raw'], base: '', bucket: '', prefix: '', format: 'nc' as const,
    sv: true, echogram: true, gapSeconds: 900, gapFactor: 6, strict: false, keepLocal: false,
    echogramOptions: { vmin: -80, vmax: -30, decimate: 10, cmap: 'viridis' },
    waveformMode: 'CW' as const, encodeMode: 'complex' as const,
    workRoot: '', freeAsYouGo: true, expectedBytes: 0,
  };
}
