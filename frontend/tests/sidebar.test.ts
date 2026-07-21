import { describe, expect, it } from 'vitest';

import { dockSideOfGroup } from '../src/components/layout/sidebarChrome';
import type { PanelRegion } from '../src/types';

/**
 * Every edge dock renders without a tab strip. This is what decides which group
 * that applies to, and getting it wrong in the permissive direction would strip
 * the tabs from the *centre* group — where every open file lives — leaving no
 * way to switch between them.
 */

const group = (...ids: string[]) => ({ panels: ids.map((id) => ({ id })) });

/** Stands in for the panel registry, without importing it. */
const REGIONS: Record<string, PanelRegion> = {
  ncei: 'left',
  files: 'left',
  derived: 'left',
  omao: 'left',
  pipelines: 'center',
  editor: 'center',
  terminal: 'bottom',
  log: 'bottom',
  metadata: 'right',
  configuration: 'right',
  calibration: 'right',
  processingQueue: 'right',
};
const regionOf = (id: string) =>
  REGIONS[id.startsWith('editor:') ? 'editor' : id];

describe('dockSideOfGroup', () => {
  it('names the sources dock', () => {
    expect(dockSideOfGroup(group('ncei', 'files', 'derived', 'omao'), regionOf)).toBe(
      'left',
    );
    expect(dockSideOfGroup(group('files'), regionOf)).toBe('left');
  });

  it('names the inspector dock', () => {
    expect(
      dockSideOfGroup(
        group('metadata', 'configuration', 'calibration', 'processingQueue'),
        regionOf,
      ),
    ).toBe('right');
    expect(dockSideOfGroup(group('metadata'), regionOf)).toBe('right');
  });

  it('leaves the centre group alone, tabs and all', () => {
    expect(dockSideOfGroup(group('pipelines', 'editor:/home/u/a.py'), regionOf)).toBe(
      null,
    );
    expect(dockSideOfGroup(group('pipelines'), regionOf)).toBe(null);
  });

  it('names the tools dock, which has a strip of its own now', () => {
    // It was excluded while its tabs were its only label; hiding them would
    // have left a collapsed dock with nothing to reopen it.
    expect(dockSideOfGroup(group('terminal', 'log'), regionOf)).toBe('bottom');
  });

  it('leaves a mixed group alone, so a dragged-in panel stays reachable', () => {
    expect(dockSideOfGroup(group('ncei', 'files', 'terminal'), regionOf)).toBe(null);
    expect(dockSideOfGroup(group('files', 'metadata'), regionOf)).toBe(null);
    expect(
      dockSideOfGroup(group('metadata', 'editor:/home/u/notes.txt'), regionOf),
    ).toBe(null);
  });

  it('leaves an empty group alone rather than treating it as a sidebar', () => {
    expect(dockSideOfGroup(group(), regionOf)).toBe(null);
  });

  it('leaves ids that are not registered panels alone', () => {
    expect(dockSideOfGroup(group('files', 'not-a-real-panel'), regionOf)).toBe(null);
    expect(dockSideOfGroup(group('not-a-real-panel'), regionOf)).toBe(null);
  });

  it('treats an unknown region as not-a-sidebar', () => {
    // A panel the lookup can't place must never silently join a dock strip.
    expect(dockSideOfGroup(group('files'), () => undefined)).toBe(null);
  });
});
