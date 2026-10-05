import { describe, expect, it } from 'vitest';

import type { Catalogue, PipelineSpec, ToolDef, ToolParam } from '../src/services/pipelinesApi';
import {
  describeValues,
  fit,
  shortHash,
  stagesEqual,
  startIndex,
  toolsReading,
  walk,
  withParam,
} from '../src/components/panels/pipelines/chain';

/**
 * The card's own quick answers about chains: which pipelines can take the
 * selected product, where they pick it up, what may follow a stage. (The
 * server's plan is the authority before a run; backend/tests/test_pipelines.py
 * covers it against the real tools' flags.)
 */

function param(id: string, patch: Partial<ToolParam> = {}): ToolParam {
  return {
    id,
    label: id,
    type: 'text',
    default: null,
    choices: [],
    flag: `--${id}`,
    trueFlag: '',
    falseFlag: '',
    help: '',
    science: true,
    required: false,
    primary: false,
    repeat: false,
    ...patch,
  };
}

function tool(name: string, consumes: string[], produces: string, patch: Partial<ToolDef> = {}): ToolDef {
  return {
    name,
    label: name,
    group: 'g',
    summary: '',
    consumes,
    produces,
    level: '',
    needs: [],
    depthParam: '',
    adds: [],
    echodataFlag: '',
    echodataRequired: false,
    echodataWhen: [],
    passthrough: false,
    params: [],
    reads: '',
    chaining: '',
    examples: [],
    ...patch,
  };
}

const catalogue: Catalogue = {
  tools: [
    tool('aa-sv', ['echodata'], 'sv'),
    tool('aa-clean', ['sv'], 'sv'),
    tool('aa-mvbs', ['sv'], 'mvbs', { params: [param('range_bin', { default: '20m' })] }),
    tool('aa-coerce-time', ['sv', 'mvbs'], 'sv', { passthrough: true }),
    tool('aa-graph', ['sv', 'mvbs', 'mask'], 'echogram', {
      params: [param('vmin', { type: 'number' }), param('no_flip', { type: 'bool', default: false, trueFlag: '--no-flip' })],
    }),
  ],
  kinds: { echodata: 'EchoData', sv: 'Sv', mvbs: 'MVBS', echogram: 'Echogram', mask: 'Mask' },
  levels: { echodata: 'L1', sv: 'L2A', mvbs: 'L3', echogram: '' },
  groups: ['g'],
  aalibraryVersion: '1.2.0',
  missing: [],
  problem: '',
  checkedAt: '',
};

function pipeline(...tools: string[]): PipelineSpec {
  return {
    id: 'p',
    name: 'p',
    description: '',
    stages: tools.map((t) => ({ tool: t, params: {} })),
    builtin: false,
    updatedAt: '',
  };
}

describe('where a pipeline picks up a product', () => {
  it('starts at the first stage that reads it', () => {
    const p = pipeline('aa-sv', 'aa-mvbs', 'aa-graph');
    expect(startIndex(p.stages, 'echodata', catalogue)).toBe(0);
    expect(startIndex(p.stages, 'sv', catalogue)).toBe(1);
    expect(startIndex(p.stages, 'mvbs', catalogue)).toBe(2);
    expect(startIndex(p.stages, '', catalogue)).toBe(0);
  });

  it('says why a pipeline cannot take a product', () => {
    expect(fit(pipeline('aa-graph'), ['echodata'], catalogue)).toMatchObject({ ok: false });
    expect(fit(pipeline('aa-graph'), ['echodata'], catalogue).reason).toMatch(/not EchoData/);
    expect(fit(pipeline('aa-sv', 'aa-graph'), ['sv'], catalogue)).toEqual({ ok: true, skipped: 1, reason: '' });
    expect(fit(pipeline('aa-sv', 'aa-nope'), [], catalogue).reason).toMatch(/aa-nope is not installed/);
  });

  it('takes several products only when it can take each', () => {
    expect(fit(pipeline('aa-sv', 'aa-graph'), ['echodata', 'sv'], catalogue).ok).toBe(true);
    expect(fit(pipeline('aa-mvbs'), ['echodata', 'sv'], catalogue).ok).toBe(false);
  });
});

describe('the chain', () => {
  it('passes the kind along, and a correction keeps the kind it was given', () => {
    const steps = walk(pipeline('aa-sv', 'aa-mvbs', 'aa-coerce-time', 'aa-graph').stages, catalogue, 'echodata');
    expect(steps.map((s) => s.writes)).toEqual(['sv', 'mvbs', 'mvbs', 'echogram']);
    expect(steps.every((s) => !s.mismatch)).toBe(true);
  });

  it('marks a stage that gets what it cannot read', () => {
    const steps = walk(pipeline('aa-sv', 'aa-graph', 'aa-mvbs').stages, catalogue);
    expect(steps[2].mismatch).toMatch(/aa-mvbs reads Sv, not Echogram/);
  });

  it('marks the stages the input is already past', () => {
    const steps = walk(pipeline('aa-sv', 'aa-graph').stages, catalogue, 'sv');
    expect(steps.map((s) => s.skip)).toEqual([true, false]);
  });

  it('offers only tools that read what the last stage writes', () => {
    expect(toolsReading('mvbs', catalogue).map((t) => t.name)).toEqual(['aa-coerce-time', 'aa-graph']);
    expect(toolsReading('', catalogue)).toHaveLength(catalogue.tools.length);
  });
});

describe('settings', () => {
  const graph = catalogue.tools[4];
  const vmin = graph.params[0];
  const noFlip = graph.params[1];

  it('keeps only values that differ from the tool default', () => {
    let stage = { tool: 'aa-graph', params: {} };
    stage = withParam(stage, vmin, -80);
    stage = withParam(stage, noFlip, false); // the default: not kept
    expect(stage.params).toEqual({ vmin: -80 });
    stage = withParam(stage, vmin, undefined);
    expect(stage.params).toEqual({});
  });

  it('compares numbers as numbers', () => {
    expect(
      stagesEqual([{ tool: 'aa-mvbs', params: { range_bin: '5m', x: 3 } }], [{ tool: 'aa-mvbs', params: { range_bin: '5m', x: 3.0 } }]),
    ).toBe(true);
    expect(stagesEqual([{ tool: 'aa-mvbs', params: {} }], [{ tool: 'aa-mvbs', params: { range_bin: '5m' } }])).toBe(false);
  });

  it('describes what a stage changes', () => {
    expect(describeValues({ tool: 'aa-graph', params: { vmin: -80, no_flip: true } }, graph)).toBe('vmin -80 · no_flip');
  });
});

describe('hashes', () => {
  it('are shown as their first eight characters, as the tools print them', () => {
    expect(shortHash('a13d29c552465cdc1b9525b1f5f3ef11')).toBe('a13d29c5');
    expect(shortHash('')).toBe('');
  });
});
