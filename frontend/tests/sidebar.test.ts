import { describe, expect, it } from 'vitest';

import { isSourceGroup } from '../src/components/layout/sidebarChrome';
import type { PanelRegion } from '../src/types';

/**
 * The sources sidebar renders without a tab strip. This predicate is what
 * decides which group that applies to, and getting it wrong in the permissive
 * direction would strip the tabs from the *centre* group — where every open
 * file lives — leaving no way to switch between them.
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
  metadata: 'right',
};
const regionOf = (id: string) =>
  REGIONS[id.startsWith('editor:') ? 'editor' : id];

describe('isSourceGroup', () => {
  it('accepts a group of nothing but sources', () => {
    expect(isSourceGroup(group('ncei', 'files', 'derived', 'omao'), regionOf)).toBe(true);
    expect(isSourceGroup(group('files'), regionOf)).toBe(true);
  });

  it('rejects the centre group, tabs and all', () => {
    expect(isSourceGroup(group('pipelines', 'editor:/home/u/a.py'), regionOf)).toBe(false);
    expect(isSourceGroup(group('pipelines'), regionOf)).toBe(false);
  });

  it('rejects a mixed group, so a dragged-in panel stays reachable', () => {
    expect(isSourceGroup(group('ncei', 'files', 'terminal'), regionOf)).toBe(false);
    expect(isSourceGroup(group('files', 'editor:/home/u/notes.txt'), regionOf)).toBe(false);
  });

  it('rejects an empty group rather than treating it as a sidebar', () => {
    expect(isSourceGroup(group(), regionOf)).toBe(false);
  });

  it('rejects ids that are not registered panels at all', () => {
    expect(isSourceGroup(group('files', 'not-a-real-panel'), regionOf)).toBe(false);
  });

  it('treats an unknown region as not-a-source', () => {
    // A panel the lookup can't place must never silently join the sidebar.
    expect(isSourceGroup(group('files'), () => undefined)).toBe(false);
  });
});
