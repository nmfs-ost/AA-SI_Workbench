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
 * arrangements hold the same panels and that the portrait one never splits the
 * screen sideways, which is its entire reason to exist.
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

  it('puts the tools dock under the centre, not under the inspector', () => {
    expect(f.find('terminal')).toMatchObject({
      direction: 'below',
      reference: 'pipelines',
    });
  });

  it('sizes the side docks by width', () => {
    expect(f.find('ncei')?.initialWidth).toBeGreaterThan(0);
    expect(f.find('metadata')?.initialWidth).toBeGreaterThan(0);
  });
});

describe('vertical layout', () => {
  const f = fakeApi();
  buildVerticalLayout(f.api);

  it('never splits the screen sideways — the whole point', () => {
    for (const entry of f.added) {
      expect(entry.direction === 'left' || entry.direction === 'right').toBe(false);
    }
  });

  it('stacks sources, workspace, inspector, tools in that order', () => {
    expect(f.find('ncei')).toMatchObject({ direction: 'above', reference: 'pipelines' });
    expect(f.find('metadata')).toMatchObject({
      direction: 'below',
      reference: 'pipelines',
    });
    // Below the *inspector*, not the centre — otherwise the tools band would
    // land between the centre and the inspector.
    expect(f.find('terminal')).toMatchObject({
      direction: 'below',
      reference: 'metadata',
    });
  });

  it('sizes every band by height', () => {
    for (const id of ['ncei', 'metadata', 'terminal']) {
      expect(f.find(id)?.initialHeight).toBeGreaterThan(0);
      expect(f.find(id)?.initialWidth).toBeUndefined();
    }
  });

  it('leaves the centre unconstrained so it takes the remaining height', () => {
    expect(f.find('pipelines')?.initialHeight).toBeUndefined();
  });
});

describe('buildLayout', () => {
  it('dispatches on the variant', () => {
    const v = fakeApi();
    buildLayout(v.api, 'vertical');
    expect(v.find('ncei')?.direction).toBe('above');

    const h = fakeApi();
    buildLayout(h.api, 'horizontal');
    expect(h.find('ncei')?.direction).toBe('left');
  });
});
