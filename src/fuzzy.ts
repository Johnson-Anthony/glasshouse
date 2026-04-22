// Small subsequence-based fuzzy matcher. Returns null for no match,
// or a positive score where higher = better.
export interface FuzzyResult<T> { item: T; score: number; }

const WORD_SEPS = new Set([" ", "-", "_", "/", "\\", "."]);

export function fuzzyMatch(query: string, target: string): number | null {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  let qi = 0;
  let score = 0;
  let skipped = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += 10;
      const atWordStart = ti === 0 || WORD_SEPS.has(t[ti - 1]);
      if (atWordStart) score += 15;
      if (target[ti] === query[qi]) score += 5;
      if (qi === 0 && ti === 0) score += 20;
      qi++;
    } else {
      skipped++;
    }
  }
  if (qi < q.length) return null;
  score -= skipped * 2;
  return score;
}

export function fuzzyFilter<T>(
  query: string,
  items: T[],
  getText: (item: T) => string,
): FuzzyResult<T>[] {
  const scored: Array<FuzzyResult<T> & { _i: number }> = [];
  items.forEach((item, i) => {
    const s = fuzzyMatch(query, getText(item));
    if (s !== null) scored.push({ item, score: s, _i: i });
  });
  scored.sort((a, b) => b.score - a.score || a._i - b._i);
  return scored.map(({ item, score }) => ({ item, score }));
}
