/**
 * A tiny, dependency-free fuzzy matcher.
 *
 * `aa-find` lets you "start typing to fuzzy-search" long lists of vessels,
 * surveys, and files; this reproduces that feel for the panel's search box and
 * for the searchable dropdowns (via `fuzzyFilterOptions`). It is a subsequence
 * matcher with bonuses for consecutive hits and word-boundary starts — good
 * enough for filtering names client-side without pulling in a search library.
 */

/** Returns a score (higher is better), or null if `query` isn't a subsequence. */
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const t = target.toLowerCase();

  let qi = 0;
  let score = 0;
  let streak = 0;
  let lastMatch = -2;

  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      streak = ti === lastMatch + 1 ? streak + 1 : 0;
      let points = 1 + streak * 2;
      const prev = ti > 0 ? t[ti - 1] : '';
      if (ti === 0 || /[^a-z0-9]/.test(prev)) points += 3; // word-boundary bonus
      score += points;
      lastMatch = ti;
      qi++;
    }
  }

  if (qi < q.length) return null; // not all query characters were consumed
  return score - t.length * 0.01; // gently prefer shorter targets
}

/** Filter + rank `items` by fuzzy match of `query` against `key(item)`. */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  key: (item: T) => string,
): T[] {
  if (!query.trim()) return [...items];
  const scored: Array<{ item: T; score: number }> = [];
  for (const item of items) {
    const score = fuzzyScore(query, key(item));
    if (score !== null) scored.push({ item, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.item);
}

/**
 * Adapter for MUI Autocomplete's `filterOptions` prop, so the dropdowns filter
 * fuzzily instead of by plain substring.
 */
export function fuzzyFilterOptions<T>(getLabel: (option: T) => string) {
  return (options: T[], state: { inputValue: string }): T[] =>
    fuzzyFilter(options, state.inputValue, getLabel);
}
