import { beforeEach, describe, expect, it } from 'vitest';

import {
  RECIPE_VERBS,
  buildRecipeCommand,
  missingRequiredInputs,
  wiredOnlyInputs,
} from '../src/components/panels/recipes/recipeCommand';
import { mockRecipesSource } from '../src/components/panels/recipes/recipeService';
import type { RecipeSummary } from '../src/components/panels/recipes/recipeTypes';
import {
  controlKindFor,
  recipeSummaryLine,
  stepLabel,
} from '../src/components/panels/recipes/recipeTypes';
import {
  getConfigurationFocus,
  setConfigurationFocus,
} from '../src/state/configurationFocus';

/**
 * The recipes feature's pure logic.
 *
 * The contract under test is the `aa-recipe` CLI's declared surface (verified
 * against the installed tool: `aa-recipe <verb> RECIPE --input NAME=VALUE`),
 * plus the two rules that keep the integration honest: values equal to the
 * recipe's own default are never repeated on the command line, and inputs only
 * a parent recipe can wire (dataset/echodata) are never emitted or demanded.
 */

function recipe(overrides: Partial<RecipeSummary> = {}): RecipeSummary {
  return {
    id: 'r.yaml',
    path: '/home/user/recipes/r.yaml',
    fileName: 'r.yaml',
    name: 'r',
    inputs: [],
    steps: [],
    ...overrides,
  };
}

describe('buildRecipeCommand', () => {
  it('emits verb + quoted path and nothing else for an untouched form', () => {
    const r = recipe({
      inputs: [
        { name: 'sonar_model', type: 'str', default: 'EK60', required: false },
      ],
    });
    expect(buildRecipeCommand(r, 'dry-run', {})).toBe(
      'aa-recipe dry-run /home/user/recipes/r.yaml',
    );
  });

  it('quotes a path with spaces', () => {
    const r = recipe({ path: '/home/user/my recipes/r.yaml' });
    expect(buildRecipeCommand(r, 'run', {})).toBe(
      'aa-recipe run "/home/user/my recipes/r.yaml"',
    );
  });

  it('emits --input only for values that differ from the declared default', () => {
    const r = recipe({
      inputs: [
        { name: 'sonar_model', type: 'str', default: 'EK60', required: false },
        { name: 'cruise_id', type: 'str', required: true },
      ],
    });
    // Equal to default → the recipe already says this; repeating it would
    // claim an override that didn't happen.
    expect(buildRecipeCommand(r, 'run', { sonar_model: 'EK60' })).toBe(
      'aa-recipe run /home/user/recipes/r.yaml',
    );
    expect(
      buildRecipeCommand(r, 'run', { sonar_model: 'EK80', cruise_id: 'HB1603' }),
    ).toBe(
      'aa-recipe run /home/user/recipes/r.yaml --input sonar_model=EK80 --input cruise_id=HB1603',
    );
  });

  it('treats an empty-list default as blank, so typed values emit', () => {
    const r = recipe({
      inputs: [{ name: 'raw_file_names', type: 'list', default: [], required: false }],
    });
    expect(buildRecipeCommand(r, 'run', { raw_file_names: '' })).toBe(
      'aa-recipe run /home/user/recipes/r.yaml',
    );
    // The comma sits outside the shared quote() allow-list, so the pair is
    // quoted — harmless to a shell, and consistent with the NCEI previews
    // that use the same helper.
    expect(buildRecipeCommand(r, 'run', { raw_file_names: 'a.raw,b.raw' })).toBe(
      'aa-recipe run /home/user/recipes/r.yaml --input "raw_file_names=a.raw,b.raw"',
    );
  });

  it('quotes NAME=VALUE when the value carries spaces', () => {
    const r = recipe({
      inputs: [{ name: 'record_author', type: 'str', required: true }],
    });
    expect(buildRecipeCommand(r, 'run', { record_author: 'B. Layman' })).toBe(
      'aa-recipe run /home/user/recipes/r.yaml --input "record_author=B. Layman"',
    );
  });

  it('never emits wired (dataset/echodata) inputs, whatever the form holds', () => {
    const r = recipe({
      inputs: [{ name: 'echodata', type: 'echodata', required: true }],
    });
    expect(buildRecipeCommand(r, 'run', { echodata: 'nonsense' })).toBe(
      'aa-recipe run /home/user/recipes/r.yaml',
    );
  });

  it('appends extra flags verbatim, after the inputs', () => {
    const r = recipe();
    expect(
      buildRecipeCommand(r, 'run', {}, '--output-dir ./cache --checkpoint-mode explicit'),
    ).toBe(
      'aa-recipe run /home/user/recipes/r.yaml --output-dir ./cache --checkpoint-mode explicit',
    );
  });

  it('covers all three verbs the UI offers', () => {
    const r = recipe();
    for (const verb of RECIPE_VERBS.map((v) => v.id)) {
      expect(buildRecipeCommand(r, verb, {})).toBe(
        `aa-recipe ${verb} /home/user/recipes/r.yaml`,
      );
    }
  });
});

describe('required-input rules', () => {
  const r = recipe({
    inputs: [
      { name: 'raw_input_folder', type: 'path', required: true },
      { name: 'sonar_model', type: 'str', default: 'EK60', required: false },
      { name: 'echodata', type: 'echodata', required: true },
    ],
  });

  it('counts required inputs without a value, ignoring wired ones', () => {
    expect(missingRequiredInputs(r, {}).map((d) => d.name)).toEqual([
      'raw_input_folder',
    ]);
    // Whitespace is not a value.
    expect(missingRequiredInputs(r, { raw_input_folder: '  ' })).toHaveLength(1);
    expect(missingRequiredInputs(r, { raw_input_folder: '/data' })).toHaveLength(0);
  });

  it('identifies sub-recipe-only inputs', () => {
    expect(wiredOnlyInputs(r).map((d) => d.name)).toEqual(['echodata']);
  });
});

describe('controlKindFor', () => {
  it('maps every aa-recipe-manager input type seen in the wild', () => {
    expect(controlKindFor('path')).toBe('path');
    expect(controlKindFor('str')).toBe('string');
    expect(controlKindFor('string')).toBe('string');
    expect(controlKindFor('int')).toBe('number');
    expect(controlKindFor('float')).toBe('number');
    expect(controlKindFor('bool')).toBe('boolean');
    expect(controlKindFor('list')).toBe('list');
  });

  it('routes composition-only and unknown types to the wired row', () => {
    expect(controlKindFor('dataset')).toBe('wired');
    expect(controlKindFor('echodata')).toBe('wired');
    expect(controlKindFor('SomethingNew')).toBe('wired');
  });
});

describe('display helpers', () => {
  it('labels op steps by op and include steps by file', () => {
    expect(stepLabel({ id: 'x', op: 'compute_mvbs' })).toBe('compute_mvbs');
    expect(stepLabel({ include: 'visualization.yaml' })).toBe('visualization.yaml');
    expect(stepLabel({ id: 'only-id' })).toBe('only-id');
  });

  it('summarises steps, includes and inputs', () => {
    const r = recipe({
      inputs: [{ name: 'a', type: 'str', required: true }],
      steps: [{ op: 'one' }, { include: 'sub.yaml' }],
    });
    expect(recipeSummaryLine(r)).toBe('2 steps · 1 include · 1 input');
  });
});

describe('configuration focus arbiter', () => {
  beforeEach(() => setConfigurationFocus('pipelines'));

  it('holds the last-written system', () => {
    expect(getConfigurationFocus()).toBe('pipelines');
    setConfigurationFocus('recipes');
    expect(getConfigurationFocus()).toBe('recipes');
  });
});

describe('mock data fidelity', () => {
  it('serves recipes whose inputs the form can all render', async () => {
    const listing = await mockRecipesSource.list();
    expect(listing.recipes.length).toBeGreaterThan(0);
    const ids = listing.recipes.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const entry of listing.recipes) {
      if (entry.error) continue;
      for (const decl of entry.inputs) {
        // Every declared type must land somewhere the widget understands —
        // including 'wired', which renders as an explanation, not a control.
        expect([
          'path',
          'string',
          'number',
          'boolean',
          'list',
          'wired',
        ]).toContain(controlKindFor(decl.type));
      }
    }
  });

  it('includes one broken entry so the error card is exercised', async () => {
    const listing = await mockRecipesSource.list();
    expect(listing.recipes.some((r) => r.error)).toBe(true);
  });

  it('declares its paths as not on disk, so Run stays a preview', async () => {
    expect(mockRecipesSource.capabilities.filesOnDisk).toBe(false);
  });
});
