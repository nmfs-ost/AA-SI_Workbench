import { describe, expect, it } from 'vitest';
import type { DockviewApi } from 'dockview';

import {
  buildHorizontalLayout,
  buildLayout,
  buildVerticalLayout,
} from '../src/components/layout/defaultLayout';

/**
 * The layout builders are imperative Dockview calls, so they're exercised
 * against a fake that records what was asked for. That can't prove the result
 * looks right — nothing without a browser can — but it does prove the two
 * arrangements hold the same panels, and it pins the one difference between
 * them, which is invisible in the finished grid: *when* the tools dock is
 * added. Add it while the centre still owns the whole grid and it spans the
 * full width; add it after the sides are carved out and it sits under the
 * centre column alone.
 */

interface Recorded {
  id: string;
  direction?: string;
  reference?: string;
  initialWidth?: number;
  initialHeight?: number;
}

function fakeApi() {
  const added: Recorded[] = [];
  let cleared = 0;
  const api = {
    clear: () => {
      cleared += 1;
      added.length = 0;
    },
    addPanel: (options: {
      id: string;
      position?: { referencePanel?: string; direction?: string };
      initialWidth?: number;
      initialHeight?: number;
    }) => {
      added.push({
        id: options.id,
        direction: options.position?.direction,
        reference: options.position?.referencePanel,
        initialWidth: options.initialWidth,
        initialHeight: options.initialHeight,
      });
    },
    getPanel: (id: string) =>
      added.some((entry) => entry.id === id)
        ? { api: { setActive: () => undefined } }
        : undefined,
  };
  return {
    api: api as unknown as DockviewApi,
    added,
    clearCount: () => cleared,
    ids: () => added.map((entry) => entry.id),
    find: (id: string) => added.find((entry) => entry.id === id),
  };
}

const ALL_PANELS = [
  'pipelines',
  'recipes',
  'ncei',
  'files',
  'derived',
  'omao',
  'metadata',
  'configuration',
  'calibration',
  'processingQueue',
  'terminal',
  'log',
  'progress',
  'console',
  'map',
];

describe('both layouts', () => {
  it('start from a clean slate', () => {
    const h = fakeApi();
    buildHorizontalLayout(h.api);
    expect(h.clearCount()).toBe(1);

    const v = fakeApi();
    buildVerticalLayout(v.api);
    expect(v.clearCount()).toBe(1);
  });

  it('hold exactly the same panels — switching monitors loses nothing', () => {
    const h = fakeApi();
    const v = fakeApi();
    buildHorizontalLayout(h.api);
    buildVerticalLayout(v.api);

    expect([...h.ids()].sort()).toEqual([...ALL_PANELS].sort());
    expect([...v.ids()].sort()).toEqual([...h.ids()].sort());
  });

  it('add each panel once', () => {
    for (const build of [buildHorizontalLayout, buildVerticalLayout]) {
      const f = fakeApi();
      build(f.api);
      expect(new Set(f.ids()).size).toBe(f.ids().length);
    }
  });

  it('anchor everything to the centre panel, which is added first', () => {
    for (const build of [buildHorizontalLayout, buildVerticalLayout]) {
      const f = fakeApi();
      build(f.api);
      expect(f.ids()[0]).toBe('pipelines');
      // Every later panel references one that already exists.
      const seen = new Set<string>();
      for (const entry of f.added) {
        if (entry.reference) expect(seen.has(entry.reference)).toBe(true);
        seen.add(entry.id);
      }
    }
  });

  it('group the four sources together', () => {
    for (const build of [buildHorizontalLayout, buildVerticalLayout]) {
      const f = fakeApi();
      build(f.api);
      for (const id of ['files', 'derived', 'omao']) {
        expect(f.find(id)).toMatchObject({ reference: 'ncei', direction: 'within' });
      }
    }
  });
});

describe('horizontal layout', () => {
  const f = fakeApi();
  buildHorizontalLayout(f.api);

  it('puts sources left and the inspector right', () => {
    expect(f.find('ncei')).toMatchObject({ direction: 'left', reference: 'pipelines' });
    expect(f.find('metadata')).toMatchObject({
      direction: 'right',
      reference: 'pipelines',
    });
  });

  it('tabs Recipes into the centre group beside Pipelines', () => {
    // 'within' is what makes it a *tab* rather than a split; anchoring to a
    // side panel instead would move it out of the centre entirely.
    expect(f.find('recipes')).toMatchObject({
      direction: 'within',
      reference: 'pipelines',
    });
  });

  it('puts the tools dock under the centre, not under the inspector', () => {
    expect(f.find('terminal')).toMatchObject({
      direction: 'below',
      reference: 'pipelines',
    });
  });

  it('adds the tools dock last, so the side docks run past it to the floor', () => {
    const order = f.ids();
    expect(order.indexOf('terminal')).toBeGreaterThan(order.indexOf('ncei'));
    expect(order.indexOf('terminal')).toBeGreaterThan(order.indexOf('metadata'));
  });

  it('sizes the side docks by width', () => {
    expect(f.find('ncei')?.initialWidth).toBeGreaterThan(0);
    expect(f.find('metadata')?.initialWidth).toBeGreaterThan(0);
  });
});

describe('vertical layout', () => {
  const f = fakeApi();
  buildVerticalLayout(f.api);

  it('adds the tools dock first — this is what makes it full width', () => {
    // The grid is nested splits: splitting the centre downwards while it still
    // owns everything gives a band the width of the window. Reorder these and
    // the layout silently becomes the landscape one.
    const order = f.ids();
    expect(order.indexOf('terminal')).toBeLessThan(order.indexOf('ncei'));
    expect(order.indexOf('terminal')).toBeLessThan(order.indexOf('metadata'));
  });

  it('places the side docks exactly where the landscape layout does', () => {
    expect(f.find('ncei')).toMatchObject({ direction: 'left', reference: 'pipelines' });
    expect(f.find('metadata')).toMatchObject({
      direction: 'right',
      reference: 'pipelines',
    });
  });

  it('anchors the tools dock to the centre, never to a side dock', () => {
    // Anchoring it to a side dock would split that dock instead of the root,
    // which is the same bug as adding it too late.
    expect(f.find('terminal')).toMatchObject({
      direction: 'below',
      reference: 'pipelines',
    });
  });

  it('sizes the sides by width and the tools dock by height', () => {
    expect(f.find('ncei')?.initialWidth).toBeGreaterThan(0);
    expect(f.find('metadata')?.initialWidth).toBeGreaterThan(0);
    expect(f.find('terminal')?.initialHeight).toBeGreaterThan(0);
  });

  it('leaves the centre unconstrained so it takes the remaining space', () => {
    expect(f.find('pipelines')?.initialHeight).toBeUndefined();
    expect(f.find('pipelines')?.initialWidth).toBeUndefined();
  });
});

describe('buildLayout', () => {
  it('dispatches on the variant', () => {
    // Both place the sides identically, so the discriminator is the ordering
    // that decides how wide the tools dock ends up.
    const v = fakeApi();
    buildLayout(v.api, 'vertical');
    expect(v.ids().indexOf('terminal')).toBeLessThan(v.ids().indexOf('ncei'));

    const h = fakeApi();
    buildLayout(h.api, 'horizontal');
    expect(h.ids().indexOf('terminal')).toBeGreaterThan(h.ids().indexOf('ncei'));
  });
});
