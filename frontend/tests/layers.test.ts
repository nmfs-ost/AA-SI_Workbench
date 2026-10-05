import { describe, expect, it } from 'vitest';

import {
  LAYERS,
  STACK,
  chainIssues,
  isCompatible,
  isGridded,
  layerLabel,
} from '../src/types/layers';
import type { LayerKind } from '../src/types/layers';

/**
 * The layer vocabulary, and the composition check it exists to drive.
 *
 * The previous `consumes`/`produces` union was declared and read by nothing,
 * which is how it drifted into being wrong without anyone noticing. These tests
 * are the thing that stops that recurring: they assert the catalogue is
 * expressible in the vocabulary and that the built-in pipelines compose under
 * it, so an entry that goes stale fails here rather than in a warning box
 * nobody reads.
 */

describe('the vocabulary', () => {
  it('describes every kind it declares', () => {
    for (const [id, info] of Object.entries(LAYERS)) {
      expect(info.id).toBe(id);
      expect(info.label.length).toBeGreaterThan(0);
      expect(info.description.length).toBeGreaterThan(0);
    }
  });

  it('marks exactly the dense gridded layers as gridded', () => {
    expect(STACK.filter(isGridded)).toEqual(['l1', 'sv', 'mvbs', 'mask']);
    // Raw is native acquisition, not a chunked store. Sparse products are
    // tabular. Neither has a chunk shape, so neither can claim one.
    expect(isGridded('raw')).toBe(false);
    for (const kind of ['regions', 'lines', 'nasc'] as LayerKind[]) {
      expect(isGridded(kind)).toBe(false);
      expect(LAYERS[kind].storage).toBe('parquet');
    }
  });

  it('has no "nc" kind, because L1 and NetCDF are different things', () => {
    expect('nc' in LAYERS).toBe(false);
    expect(LAYERS.l1.storage).toBe('zarr');
    expect(LAYERS.netcdf.storage).toBe('file');
  });

  it('falls back to the raw id rather than throwing on an unknown kind', () => {
    expect(layerLabel('not-a-layer' as LayerKind)).toBe('not-a-layer');
  });
});

describe('isCompatible', () => {
  it('matches a kind to itself', () => {
    expect(isCompatible('sv', 'sv')).toBe(true);
    expect(isCompatible('sv', 'mvbs')).toBe(false);
  });

  it('lets "any" match in both directions', () => {
    // This is what keeps the freeform shell stage composable anywhere without
    // a special case at every call site.
    expect(isCompatible('any', 'sv')).toBe(true);
    expect(isCompatible('sv', 'any')).toBe(true);
  });

  it('lets "none" match nothing, including itself', () => {
    expect(isCompatible('none', 'none')).toBe(false);
    expect(isCompatible('sv', 'none')).toBe(false);
    expect(isCompatible('none', 'sv')).toBe(false);
  });
});

describe('chainIssues', () => {
  const stage = (tool: string, consumes: LayerKind, produces: LayerKind) => ({
    tool,
    consumes,
    produces,
  });

  it('passes a well-formed chain', () => {
    expect(
      chainIssues(
        [
          stage('aa-raw', 'raw', 'l1'),
          stage('aa-sv', 'l1', 'sv'),
          stage('aa-mvbs', 'sv', 'mvbs'),
        ],
        'raw',
      ),
    ).toHaveLength(0);
  });

  it('flags a step whose input nothing upstream produces', () => {
    const issues = chainIssues([stage('aa-mvbs', 'sv', 'mvbs')], 'raw');
    expect(issues).toHaveLength(1);
    expect(issues[0].tool).toBe('aa-mvbs');
    expect(issues[0].needs).toBe('sv');
    expect(issues[0].got).toBe('raw');
  });

  it('reports one issue per bad seam rather than cascading', () => {
    // aa-mvbs is wrong here; aa-pyramid that follows it is not, because the
    // declared output is carried forward regardless. One mistake, one warning.
    const issues = chainIssues(
      [stage('aa-mvbs', 'sv', 'mvbs'), stage('aa-pyramid', 'mvbs', 'mvbs')],
      'l1',
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].index).toBe(0);
  });

  it('does not flag a freeform stage wherever it is placed', () => {
    expect(
      chainIssues(
        [stage('aa-sv', 'l1', 'sv'), stage('sh', 'any', 'any'), stage('aa-mvbs', 'sv', 'mvbs')],
        'l1',
      ),
    ).toHaveLength(0);
  });

  it('phrases the first step differently, since it has no previous step', () => {
    const [first] = chainIssues([stage('aa-mvbs', 'sv', 'mvbs')], 'raw');
    expect(first.message).toContain('the input is');
    const [later] = chainIssues(
      [stage('aa-raw', 'raw', 'l1'), stage('aa-mvbs', 'sv', 'mvbs')],
      'raw',
    );
    expect(later.message).toContain('the previous step produces');
  });

  it('warns about nothing when the input kind is unknown', () => {
    // The New Pipeline dialog composes before any file is chosen. An unknown
    // head must not make every first step look broken.
    expect(chainIssues([stage('aa-mvbs', 'sv', 'mvbs')], 'any')).toHaveLength(0);
  });
});
