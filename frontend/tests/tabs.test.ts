import { describe, expect, it } from 'vitest';

import { tabPresentation } from '../src/components/layout/tabPresentation';

/**
 * Tabs label themselves with an icon or with text. The half of that rule worth
 * a test is the text half: an editor tab's title is the filename, which is the
 * only thing distinguishing it from every other open file. Reduce those to
 * icons and a dock full of files becomes a row of identical document glyphs
 * with no way to tell which is which.
 *
 * Definitions are stand-ins rather than the real registry, which eagerly
 * imports every panel component — including xterm, whose UMD wrapper reaches
 * for `self` and takes the whole suite down under Node.
 */

const tool = { dynamic: undefined };
const document_ = { dynamic: true };

describe('tabPresentation', () => {
  it('gives a registered tool its icon', () => {
    expect(tabPresentation(tool)).toBe('icon');
    expect(tabPresentation({ dynamic: false })).toBe('icon');
  });

  it('keeps the filename on an editor tab', () => {
    expect(tabPresentation(document_)).toBe('text');
  });

  it('falls back to text for a panel the registry does not know', () => {
    // A runtime-registered panel has no icon to draw, and a blank tab is worse
    // than a wide one.
    expect(tabPresentation(undefined)).toBe('text');
  });
});
