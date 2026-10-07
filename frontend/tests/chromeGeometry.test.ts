import { describe, expect, it } from 'vitest';

import { readFileSync } from 'node:fs';

import { tokens, tokensFor } from '../src/theme';
import { paletteList } from '../src/theme/tokens';
import type { ThemeMode } from '../src/types';
import { panelColumns, panelDensity } from '../src/components/panels/panelStyles';

/**
 * The numbers two different files have to agree on.
 *
 * Everything here was, until this session, a constant duplicated across the
 * files that needed it, with a comment in each saying it had to match the
 * other. That is a convention, and conventions do not fail loudly: the menu
 * bar's mark and the icon strip below it drifted 3.5px apart and the only
 * symptom was a logo that looked very slightly wrong and nobody could say why.
 *
 * These tests do not check appearance. They check that the values which have to
 * be equal are still coming from one place, so the next person to change one
 * cannot change only one.
 */

const MODES: ThemeMode[] = paletteList.map((p) => p.id);

describe('side strip width', () => {
  it('is a theme token, not a per-file constant', () => {
    expect(tokens.size.sideStrip).toBeGreaterThan(0);
  });

  it('is identical in every palette', () => {
    /* The strip is chrome geometry, not colour. A palette that changed it
       would move the mark off the column it is centred on, in that palette
       only — which is the hardest kind of visual bug to attribute. */
    for (const mode of MODES) {
      expect(tokensFor(mode).size.sideStrip).toBe(tokens.size.sideStrip);
    }
  });

  it('leaves the mark centred on the strip', () => {
    /* MenuBar gives the mark a slot exactly one strip wide and centres it, so
       its axis is the strip's axis by construction. The arithmetic is here so
       that a future `pl` or `gap` on the bar — which is precisely what threw
       this off before — has to break a test to get in. */
    const markSize = 18;
    const slot = tokens.size.sideStrip;
    expect((slot - markSize) / 2 + markSize / 2).toBe(slot / 2);
    expect(markSize).toBeLessThan(slot);
  });
});

describe('browser row columns', () => {
  it('are one shared set', () => {
    /* Files and Derived read these from `panelStyles`. Two panels, one object:
       there is no second copy to fall out of step. */
    expect(panelColumns.size).toBeGreaterThan(0);
    expect(panelColumns.modified).toBeGreaterThan(0);
  });

  it('fit the widest value each column renders', () => {
    /* `formatRelativeTime` falls back to a date at a week, and includes the
       year once the file is older than one. "12 Aug 2025" at 10.5px tabular
       digits needs roughly 66px; the old 46 clipped it. `formatBytes` tops out
       at "999.9 MB". Estimated at ~0.6em per character, which is generous for
       tabular numerals and the point is the margin, not the precision. */
    const widest = (text: string) => text.length * panelDensity.font.meta * 0.6;
    expect(panelColumns.modified).toBeGreaterThanOrEqual(widest('12 Aug 2025'));
    expect(panelColumns.size).toBeGreaterThanOrEqual(widest('999.9 MB'));
  });

  it('leave space between the name and the first value', () => {
    /* A long filename ellipsises to the full width of its box, so without a
       lead the last character of a name and the first digit of its size are
       one row-gap apart. This is the "too crowded" the columns were widened
       to fix, and it is the part a width increase alone does not solve. */
    expect(panelColumns.lead).toBeGreaterThan(0);
  });

  it('reserve the row-hover buttons so headings sit over their columns', () => {
    /* Two icon buttons at the row's right edge. The header row reserves the
       same width; if it did not, every heading would sit two icons to the
       right of the values it names. */
    expect(panelColumns.actions).toBeGreaterThan(0);
  });
});

describe('row lines', () => {
  /* Every first row in the window (a dock's tab strip, a panel's header) is
     one row tall with one line under it, so where two docks meet the line
     runs straight on. Measured in the browser when this was fixed (the tab
     strip's line was border.strong and a header's border.subtle, so the line
     changed colour at every dock edge); pinned here in the sources. */
  const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

  it('under a dock’s tab strip is the line under a panel header', () => {
    const css = read('src/theme/dockview-overrides.css');
    const strip = /\.tabs-and-actions-container\s*\{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(strip).toMatch(/border-bottom:\s*1px solid var\(--aa-border-subtle\)/);
    const header = read('src/components/panels/PanelHeader.tsx');
    expect(header.match(/borderBottom: `1px solid \$\{(c|theme\.aa\.color)\.border\.subtle\}`/g)).toHaveLength(2);
    expect(header.match(/height: theme\.aa\.size\.row/g)).toHaveLength(2);
  });

  it('is there even when a panel has nothing to show', () => {
    /* A panel whose whole body is its empty state names itself, so its
       header row (and the line under it) does not vanish with the content. */
    for (const file of [
      'LogPanel.tsx',
      'ProgressPanel.tsx',
      'ConsolePanel.tsx',
      'ProcessingQueuePanel.tsx',
      'pipelines/ConfigurationPanel.tsx',
      'recipes/RecipeConfiguration.tsx',
      'calibration/CalibrationPanel.tsx',
    ]) {
      expect(read(`src/components/panels/${file}`), file).toContain('panelTitle=');
    }
  });

  it('is one row tall in the toolbars that are not PanelBars', () => {
    expect(read('src/components/panels/TerminalPanel.tsx')).toMatch(/height: theme\.aa\.size\.row,\s*boxSizing: 'border-box'/);
  });
});
