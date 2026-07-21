import { describe, expect, it } from 'vitest';

import {
  MAX_HIGHLIGHT_LENGTH,
  escapeHtml,
  highlight,
} from '../src/components/panels/editor/highlight';
import type { Language } from '../src/components/panels/editor/language';

/**
 * The highlighter's output goes through `dangerouslySetInnerHTML`, so these are
 * the tests that keep that safe, plus the one structural invariant the editor
 * depends on.
 */

const LANGUAGES: Language[] = [
  'python',
  'json',
  'markdown',
  'shell',
  'javascript',
  'yaml',
  'plain',
];

/** Recover the visible text from highlighted HTML. */
function textOf(html: string): string {
  return html
    .replace(/<span class="tok-[a-z]+">/g, '')
    .replace(/<\/span>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

describe('escapeHtml', () => {
  it('neutralises the three characters that can open a tag or entity', () => {
    expect(escapeHtml('<script>')).toBe('&lt;script&gt;');
    expect(escapeHtml('a & b')).toBe('a &amp; b');
  });

  it('escapes the ampersand first, so entities are not double-decoded', () => {
    // If & were escaped last, "&lt;" would come back out as a literal "<".
    expect(escapeHtml('&lt;')).toBe('&amp;lt;');
  });
});

describe('highlight — injection safety', () => {
  const hostile = [
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(1)">',
    '"><svg/onload=alert(1)>',
    "# <iframe src='javascript:alert(1)'></iframe>",
    '</span><script>alert(1)</script><span class="tok-kw">',
  ];

  for (const language of LANGUAGES) {
    it(`never emits a raw tag for ${language}`, () => {
      for (const source of hostile) {
        const html = highlight(source, language);
        const tags = html.match(/<[^>]*>/g) ?? [];
        // Every '<' in the output opens one of the highlighter's own spans, so
        // no attacker-supplied text can be parsed as markup. (The *escaped*
        // text may still read "onerror" — that's inert, and the point.)
        expect((html.match(/</g) ?? []).length).toBe(tags.length);
        for (const tag of tags) {
          expect(tag).toMatch(/^(<span class="tok-[a-z]+">|<\/span>)$/);
        }
      }
    });
  }

  it('escapes hostile input even inside a token it recognises', () => {
    // The string literal is a token, so it takes the escaping path *inside* a
    // span rather than the plain-text path between them.
    const html = highlight('x = "<script>alert(1)</script>"', 'python');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});

describe('highlight — text preservation', () => {
  /* The editor lays a transparent textarea over this HTML. If highlighting ever
     added, dropped, or reordered a character, the two layers would drift apart
     and the caret would stop landing where it appears to. */
  const samples: Array<[Language, string]> = [
    ['python', 'def f(x):\n    # comment\n    return "a" + str(x)  # trailing\n'],
    ['json', '{\n  "a": [1, 2.5, true, null],\n  "b": {"c": "d"}\n}'],
    ['markdown', '# Title\n\nSome *text* with `code` and a [link](http://x).\n'],
    ['shell', '#!/bin/bash\nexport A=1\nif [ -f "$A" ]; then echo hi; fi\n'],
    ['javascript', 'const x = 1; // note\nfunction f() { return `t${x}`; }\n'],
    ['yaml', 'key: value  # note\nlist:\n  - one\n  - 2\n'],
    ['plain', 'no rules here <>&\n'],
  ];

  for (const [language, source] of samples) {
    it(`round-trips ${language} unchanged`, () => {
      expect(textOf(highlight(source, language))).toBe(source);
    });
  }

  it('preserves unusual whitespace and unicode', () => {
    const source = 'a\t\tb\n\n\u00e9\u4e2d\u6587 \u2014 ok\n   trailing   \n';
    expect(textOf(highlight(source, 'python'))).toBe(source);
  });

  it('preserves an empty document', () => {
    expect(highlight('', 'python')).toBe('');
  });
});

describe('highlight — very large files', () => {
  it('gives up on colour but still escapes', () => {
    const huge = `${'x'.repeat(MAX_HIGHLIGHT_LENGTH)}<script>`;
    const html = highlight(huge, 'python');
    expect(html).not.toContain('tok-');
    expect(html).toContain('&lt;script&gt;');
  });
});
