import { describe, expect, it } from 'vitest';

import {
  FIRST_TIER,
  defaultMode,
  findMode,
  resolveSequence,
  resolveStage,
  stopsSequence,
} from '../src/components/panels/ncei/sequence';
import { buildArgs, type SequenceContext } from '../src/components/panels/ncei/useSequence';
import type { ToolInfo } from '../src/services/environmentApi';

function tool(name: string, version = '0.2.0'): ToolInfo {
  return { name, path: `/venv/bin/${name}`, distribution: name, version };
}

const CTX: SequenceContext = {
  vesselId: 'Alaska_Knight',
  surveyName: 'CHS12AK',
  sonarName: 'ES60',
  fileNames: ['a.raw', 'b.raw'],
  dateFrom: '2012-08-13',
  dateTo: '2012-08-14',
  workdir: './converted',
  output: 'L1.zarr',
  combineFlags: ['--chunk-pings', '500'],
  requestPath: 'req.yaml',
};

const stageById = (id: string) => FIRST_TIER.find((s) => s.id === id)!;

describe('stage resolution against the installed environment', () => {
  it('reports a tool that is not installed rather than offering to run it', () => {
    const resolved = resolveStage(stageById('assemble'), [], new Set());
    expect(resolved.confidence).toBe('missing');
    expect(resolved.runnable).toBe(false);
    expect(resolved.note).toContain('not installed');
  });

  it('separates "installed" from "self-describing"', () => {
    const installed = [tool('aa-combine')];
    expect(resolveStage(stageById('assemble'), installed, new Set()).confidence).toBe(
      'installed',
    );
    expect(
      resolveStage(stageById('assemble'), installed, new Set(['aa-combine'])).confidence,
    ).toBe('described');
  });

  it('a self-describing tool carries no caveat, an installed one does', () => {
    const described = resolveStage(
      stageById('assemble'),
      [tool('aa-combine')],
      new Set(['aa-combine']),
    );
    expect(described.note).toBe('');

    const guessed = resolveStage(stageById('assemble'), [tool('aa-combine')], new Set());
    expect(guessed.note).toContain('--help');
  });

  it('accepts an alias, and reports the name actually found', () => {
    // The converter was rendered as aa-raw; the notes call it aa-ed/aa-nc.
    const resolved = resolveStage(stageById('convert'), [tool('aa-nc')], new Set());
    expect(resolved.resolvedTool).toBe('aa-nc');
    expect(resolved.runnable).toBe(true);
  });

  it('an open question outranks being self-describing', () => {
    // Convert is installed AND describes itself, but which suffix it writes is
    // still undecided — the badge must not claim otherwise.
    const resolved = resolveStage(
      stageById('convert'),
      [tool('aa-ed')],
      new Set(['aa-ed']),
    );
    expect(resolved.confidence).toBe('unresolved');
    expect(resolved.note).toContain('--help');
  });

  it('resolves every stage without throwing on an empty environment', () => {
    const resolved = resolveSequence([], new Set());
    expect(resolved).toHaveLength(FIRST_TIER.length);
    expect(resolved.every((item) => item.confidence === 'missing')).toBe(true);
  });
});

describe('modes', () => {
  it('assemble leads with a mode that writes nothing', () => {
    const first = defaultMode(stageById('assemble'));
    expect(first.id).toBe('check');
    expect(first.writes).toBe(false);
  });

  it('every stage has exactly one writing mode at most, for the ones that write', () => {
    for (const stage of FIRST_TIER) {
      const writers = stage.modes.filter((mode) => mode.writes);
      expect(writers.length).toBeLessThanOrEqual(1);
    }
  });

  it('falls back to the default when asked for a mode that does not exist', () => {
    expect(findMode(stageById('assemble'), 'nonsense').id).toBe('check');
  });
});

describe('argv construction', () => {
  it('a non-writing mode never names an output', () => {
    const check = findMode(stageById('assemble'), 'check');
    const args = buildArgs('assemble', check, CTX);
    expect(args).toContain('--check');
    expect(args).not.toContain('-o');
    expect(args).not.toContain('L1.zarr');
  });

  it('the writing mode names the output', () => {
    const run = findMode(stageById('assemble'), 'run');
    const args = buildArgs('assemble', run, CTX);
    expect(args).toContain('-o');
    expect(args).toContain('L1.zarr');
    expect(args).not.toContain('--check');
  });

  it('carries the options form’s flags through unchanged', () => {
    const run = findMode(stageById('assemble'), 'run');
    const args = buildArgs('assemble', run, CTX);
    expect(args.join(' ')).toContain('--chunk-pings 500');
  });

  it('builds a request from the selection rather than prompting', () => {
    const build = findMode(stageById('request'), 'build');
    const args = buildArgs('request', build, CTX);
    expect(args).toEqual([
      '--vessel', 'Alaska_Knight',
      '--survey', 'CHS12AK',
      '--instrument', 'ES60',
      '--from', '2012-08-13',
      '--to', '2012-08-14',
      '-o', 'req.yaml',
    ]);
  });

  it('omits an empty date rather than passing an empty string', () => {
    const build = findMode(stageById('request'), 'build');
    const args = buildArgs('request', build, { ...CTX, dateFrom: '', dateTo: '' });
    expect(args).not.toContain('--from');
    expect(args).not.toContain('--to');
  });

  it('verify addresses the store the combine wrote', () => {
    const verify = findMode(stageById('verify'), 'verify');
    expect(buildArgs('verify', verify, CTX)).toEqual(['verify', '--json', 'L1.zarr']);
  });

  it('argv is a list, never a shell string — nothing needs quoting downstream', () => {
    const run = findMode(stageById('assemble'), 'run');
    const args = buildArgs('assemble', run, { ...CTX, output: 'my store.zarr' });
    // The space survives as one element; there is no shell to split it.
    expect(args).toContain('my store.zarr');
  });
});

describe('sequence gating', () => {
  it('any non-zero exit stops the sequence', () => {
    expect(stopsSequence(0)).toBe(false);
    // 3 is resumable and 4 is a finding, but neither means "carry on".
    for (const code of [1, 2, 3, 4]) expect(stopsSequence(code)).toBe(true);
  });

  it('a job that has not finished does not stop anything', () => {
    expect(stopsSequence(null)).toBe(false);
  });
});

describe('the stage order is the sector order', () => {
  it('acquire, convert, assemble, verify', () => {
    expect(FIRST_TIER.map((stage) => stage.id)).toEqual([
      'request',
      'fetch',
      'convert',
      'assemble',
      'verify',
    ]);
  });

  it('verify comes after the thing it verifies', () => {
    const ids = FIRST_TIER.map((s) => s.id);
    expect(ids.indexOf('verify')).toBeGreaterThan(ids.indexOf('assemble'));
  });

  it('only the interactive stage runs in the terminal', () => {
    const terminal = FIRST_TIER.filter((s) => s.runsVia === 'terminal');
    expect(terminal.map((s) => s.id)).toEqual(['fetch']);
  });
});
