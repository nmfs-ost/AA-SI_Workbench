/**
 * A small syntax highlighter.
 *
 * Why not CodeMirror or Monaco: the bundle is already 1.1 MB and xterm.js is
 * 300 kB of it. A code editor library would roughly double that for every user
 * of the app, including the ones who only ever browse NCEI — a poor trade for
 * colouring the occasional parameter file. This is a few hundred bytes and
 * covers the handful of languages a Workbench user actually edits.
 *
 * What it deliberately isn't: a parser. It's a single-pass regex scan, so a
 * pathological string can be mis-tinted. That's an acceptable cost for text
 * whose meaning is carried by the characters, not the colours. If real editing
 * ergonomics are needed later (folding, multi-cursor, LSP), swap this module
 * for CodeMirror behind the same `highlight()` signature.
 *
 * **Every token's text is HTML-escaped before it is wrapped.** The output goes
 * through `dangerouslySetInnerHTML`, so this is the one property in the module
 * that isn't cosmetic — there is a test for it.
 */

import type { Language } from './language';

/** Token classes. Kept short — they end up as CSS class names on every span. */
export type TokenClass =
  | 'com' // comment
  | 'str' // string literal
  | 'kw' // keyword
  | 'num' // number
  | 'fn' // function name / heading
  | 'var' // variable / property key
  | 'op'; // decorator, punctuation worth tinting

interface Rule {
  cls: TokenClass;
  /** Must contain no capturing groups — the scanner counts them. */
  pattern: string;
}

const NUMBER = String.raw`\b(?:0[xXbBoO][0-9a-fA-F_]+|\d[\d_]*\.?[\d_]*(?:[eE][+-]?\d+)?)\b`;
const DQ_STRING = String.raw`"(?:\\[\s\S]|[^"\\])*"`;
const SQ_STRING = String.raw`'(?:\\[\s\S]|[^'\\])*'`;

const PYTHON_KEYWORDS =
  'False|None|True|and|as|assert|async|await|break|class|continue|def|del|elif|' +
  'else|except|finally|for|from|global|if|import|in|is|lambda|nonlocal|not|or|' +
  'pass|raise|return|try|while|with|yield|self|cls';

const JS_KEYWORDS =
  'async|await|break|case|catch|class|const|continue|default|delete|do|else|' +
  'export|extends|finally|for|from|function|if|import|in|instanceof|interface|' +
  'let|new|of|return|super|switch|this|throw|try|type|typeof|var|void|while|' +
  'yield|true|false|null|undefined';

const SHELL_KEYWORDS =
  'if|then|elif|else|fi|for|while|until|do|done|case|esac|function|in|return|' +
  'export|local|readonly|source|set|unset|shift|trap|exit';

const RULES: Record<Language, Rule[]> = {
  python: [
    { cls: 'com', pattern: String.raw`#[^\n]*` },
    // Triple-quoted first: it must win over the single-quote rule.
    { cls: 'str', pattern: String.raw`(?:[rbfuRBFU]{0,2})(?:"""[\s\S]*?"""|'''[\s\S]*?''')` },
    { cls: 'str', pattern: String.raw`(?:[rbfuRBFU]{0,2})(?:${DQ_STRING}|${SQ_STRING})` },
    { cls: 'op', pattern: String.raw`@[A-Za-z_][\w.]*` },
    { cls: 'kw', pattern: String.raw`\b(?:${PYTHON_KEYWORDS})\b` },
    { cls: 'num', pattern: NUMBER },
    { cls: 'fn', pattern: String.raw`\b[A-Za-z_]\w*(?=\s*\()` },
  ],
  json: [
    // A quoted string followed by a colon is a key, not a value.
    { cls: 'var', pattern: String.raw`"(?:\\[\s\S]|[^"\\])*"(?=\s*:)` },
    { cls: 'str', pattern: DQ_STRING },
    { cls: 'kw', pattern: String.raw`\b(?:true|false|null)\b` },
    { cls: 'num', pattern: String.raw`-?${NUMBER}` },
  ],
  markdown: [
    { cls: 'str', pattern: String.raw`(?:^|\n)\x60\x60\x60[\s\S]*?(?:\n\x60\x60\x60|$)` },
    { cls: 'fn', pattern: String.raw`(?:^|\n)#{1,6}[^\n]*` },
    { cls: 'str', pattern: String.raw`\x60[^\x60\n]+\x60` },
    { cls: 'kw', pattern: String.raw`\*\*(?:[^*\n]|\*(?!\*))+\*\*` },
    { cls: 'var', pattern: String.raw`\[[^\]\n]*\]\([^)\n]*\)` },
    { cls: 'com', pattern: String.raw`(?:^|\n)>[^\n]*` },
    { cls: 'op', pattern: String.raw`(?:^|\n)\s*(?:[-*+]|\d+\.)(?=\s)` },
  ],
  shell: [
    { cls: 'com', pattern: String.raw`#[^\n]*` },
    { cls: 'str', pattern: String.raw`${DQ_STRING}|${SQ_STRING}` },
    { cls: 'var', pattern: String.raw`\$(?:\{[^}\n]*\}|[A-Za-z_]\w*|[@?#*!$0-9])` },
    { cls: 'kw', pattern: String.raw`\b(?:${SHELL_KEYWORDS})\b` },
    { cls: 'num', pattern: NUMBER },
  ],
  javascript: [
    { cls: 'com', pattern: String.raw`//[^\n]*|/\*[\s\S]*?\*/` },
    { cls: 'str', pattern: String.raw`\x60(?:\\[\s\S]|[^\x60\\])*\x60|${DQ_STRING}|${SQ_STRING}` },
    { cls: 'kw', pattern: String.raw`\b(?:${JS_KEYWORDS})\b` },
    { cls: 'num', pattern: NUMBER },
    { cls: 'fn', pattern: String.raw`\b[A-Za-z_$][\w$]*(?=\s*\()` },
  ],
  yaml: [
    { cls: 'com', pattern: String.raw`#[^\n]*` },
    { cls: 'var', pattern: String.raw`(?:^|\n)\s*(?:-\s*)?[A-Za-z_][\w.-]*(?=\s*:)` },
    { cls: 'str', pattern: String.raw`${DQ_STRING}|${SQ_STRING}` },
    { cls: 'kw', pattern: String.raw`\b(?:true|false|null|yes|no|on|off)\b` },
    { cls: 'num', pattern: NUMBER },
  ],
  plain: [],
};

/** Compiled scanners, built once per language on first use. */
const scanners = new Map<Language, RegExp>();

function scannerFor(language: Language): RegExp | null {
  const rules = RULES[language];
  if (!rules || rules.length === 0) return null;
  const existing = scanners.get(language);
  if (existing) return existing;
  const source = rules.map((rule) => `(${rule.pattern})`).join('|');
  const compiled = new RegExp(source, 'g');
  scanners.set(language, compiled);
  return compiled;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Above this many characters, colouring is skipped and the text is escaped and
 * returned as-is. A regex scan on every keystroke of a 300 kB file is the
 * difference between an editor and a slideshow, and nobody is reading colour
 * in a file that size anyway.
 */
export const MAX_HIGHLIGHT_LENGTH = 120_000;

/** Turn source text into HTML with token spans. Always safe to inject. */
export function highlight(text: string, language: Language): string {
  const scanner = scannerFor(language);
  if (!scanner || text.length > MAX_HIGHLIGHT_LENGTH) return escapeHtml(text);

  const rules = RULES[language];
  const out: string[] = [];
  let cursor = 0;

  scanner.lastIndex = 0;
  let match = scanner.exec(text);
  while (match !== null) {
    // Find which alternative matched; group i+1 belongs to rule i.
    let ruleIndex = -1;
    for (let i = 0; i < rules.length; i += 1) {
      if (match[i + 1] !== undefined) {
        ruleIndex = i;
        break;
      }
    }
    if (ruleIndex === -1) {
      match = scanner.exec(text);
      continue;
    }

    if (match.index > cursor) out.push(escapeHtml(text.slice(cursor, match.index)));
    out.push(
      `<span class="tok-${rules[ruleIndex].cls}">${escapeHtml(match[0])}</span>`,
    );
    cursor = match.index + match[0].length;

    // A zero-length match would spin forever; step past it.
    if (match[0].length === 0) scanner.lastIndex += 1;
    match = scanner.exec(text);
  }

  if (cursor < text.length) out.push(escapeHtml(text.slice(cursor)));
  return out.join('');
}
