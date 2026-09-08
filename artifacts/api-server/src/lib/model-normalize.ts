/**
 * Careful model label unification for filters/facets.
 * Folds cosmetic spelling only (5-Series / 5er / 5 er ↔ 5 Series, C Class ↔ C-Class).
 * Does not merge distinct models (M3 ≠ 3 Series, X5 ≠ 5 Series).
 */

const MERCEDES_CLASS =
  /^(A|B|C|E|S|G|CLA|CLS|GLA|GLB|GLC|GLE|GLS|EQA|EQB|EQC|EQE|EQS|AMG)$/i;

/** Canonical display form for a model string. */
export function canonicalizeModelLabel(raw?: string | null): string | undefined {
  if (raw == null) return undefined;
  let s = String(raw).replace(/\s+/g, " ").trim();
  if (!s) return undefined;

  // BMW / alike: "5-series", "5Series", "5 series" → "5 Series"
  s = s.replace(/\b(\d)\s*[-_/]?\s*series\b/gi, (_, d: string) => `${d} Series`);
  // German BMW shorthand: "5er", "5 er", "5-er", "3ER" → "5 Series" / "3 Series"
  // Whole-token "er" only — never touches M3, X5, 530i, Tourer, etc.
  s = s.replace(/\b(\d)\s*[-_/]?\s*er\b/gi, (_, d: string) => `${d} Series`);

  // Mercedes-style class names: "c class", "CClass", "GLC class" → "C-Class" / "GLC-Class"
  s = s.replace(/\b([A-Za-z]{1,3})\s*[-_/]?\s*class\b/gi, (full, letters: string) => {
    if (!MERCEDES_CLASS.test(letters)) return full;
    return `${letters.toUpperCase()}-Class`;
  });

  return s;
}

/** DB values that should match when a facet option is selected. */
export function modelFilterValues(selected: string): string[] {
  const trimmed = selected.trim();
  if (!trimmed) return [];
  const canon = canonicalizeModelLabel(trimmed) ?? trimmed;
  const variants = new Set<string>([trimmed, canon]);

  const series = canon.match(/^(\d) Series$/i);
  if (series) {
    const n = series[1]!;
    variants.add(`${n}-Series`);
    variants.add(`${n}-series`);
    variants.add(`${n} series`);
    variants.add(`${n}Series`);
    variants.add(`${n}er`);
    variants.add(`${n} er`);
    variants.add(`${n}-er`);
    variants.add(`${n}ER`);
    variants.add(`${n} Er`);
  }

  const cls = canon.match(/^([A-Z]{1,3})-Class$/i);
  if (cls) {
    const L = cls[1]!.toUpperCase();
    variants.add(`${L} Class`);
    variants.add(`${L}-class`);
    variants.add(`${L} class`);
    variants.add(`${L}Class`);
  }

  return [...variants].filter(Boolean);
}

/** Merge facet rows that only differ by cosmetic model spelling. */
export function mergeModelCounts(
  rows: Array<{ model: string | null; count: number }>,
  limit = 200,
): Array<{ model: string; count: number }> {
  const map = new Map<string, { model: string; count: number }>();
  for (const row of rows) {
    if (row.model == null || !String(row.model).trim()) continue;
    const canon = canonicalizeModelLabel(String(row.model)) ?? String(row.model).trim();
    const key = canon.toLowerCase();
    const prev = map.get(key);
    if (prev) {
      prev.count += Number(row.count) || 0;
    } else {
      map.set(key, { model: canon, count: Number(row.count) || 0 });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.model.localeCompare(b.model)).slice(0, limit);
}
