/**
 * Canonical fuel labels for facets, filters, and public API responses.
 * Provider ingest still varies (Diesel / diesel / DIESEL / Gas / Petrol…) —
 * normalize at read time so UI + API show one bucket each.
 */

export const CANONICAL_FUELS = [
  "Gasoline",
  "Diesel",
  "Hybrid",
  "Plug-in Hybrid",
  "Electric",
  "LPG",
  "CNG",
  "Hydrogen",
  "Flex Fuel",
  "Other",
] as const;

export type CanonicalFuel = (typeof CANONICAL_FUELS)[number];

const FUEL_RULES: Array<{ re: RegExp; out: CanonicalFuel }> = [
  { re: /plug[\s-]?in|phev|hybryda\s*plug/i, out: "Plug-in Hybrid" },
  { re: /gas\s*\/\s*electric|gasoline\+electric|petrol\+electric|hybrid\s*petrol|hybrid\s*engine|mhev|hev\b/i, out: "Hybrid" },
  { re: /\bhybrid\b/i, out: "Hybrid" },
  { re: /diesel|nafta|motorina|gasolio|gas[oó]leo|дизел|디젤|light\s*oil|tdi\b|cdi\b|hdi\b|dci\b|crdi\b/i, out: "Diesel" },
  { re: /electricit|electric|\bev\b|elektro|elektr|електр/i, out: "Electric" },
  { re: /hydrogen|wasserstoff|vod[ií]k|fuel\s*cell/i, out: "Hydrogen" },
  { re: /\blpg\b|autogas|\bgpl\b|gasoline\+lpg|petrol\+lpg|пропан|propan/i, out: "LPG" },
  { re: /\bcng\b|erdgas|metano|zemní\s*plyn|zemny\s*plyn|natural\s*gas|compressed\s*natural/i, out: "CNG" },
  { re: /flex(?:ible)?(?:\s*fuel)?|e85|ethanol/i, out: "Flex Fuel" },
  { re: /benz[ií]n|petrol|gasoline|gasolina|benzin|benzina|essence|бензин|\bgas\b/i, out: "Gasoline" },
  { re: /гибрид/i, out: "Hybrid" },
  { re: /дизел/i, out: "Diesel" },
  { re: /other|unsure|unknown|n\/a|gaseous\s*powered/i, out: "Other" },
];

/** Map any stored fuel string → one of CANONICAL_FUELS (or undefined if empty). */
export function normalizeFuelType(raw?: string | null): CanonicalFuel | undefined {
  if (raw == null) return undefined;
  const t = String(raw).trim();
  if (!t) return undefined;
  for (const { re, out } of FUEL_RULES) {
    if (re.test(t)) return out;
  }
  // Already canonical (case-insensitive).
  const hit = CANONICAL_FUELS.find((c) => c.toLowerCase() === t.toLowerCase());
  return hit;
}

/** Postgres ~* (ARE) patterns — use \y for word bounds (\b is backspace in PG). */
const FUEL_MATCH_RE: Record<CanonicalFuel, string> = {
  "Plug-in Hybrid": "plug[\\s-]?in|phev|hybryda\\s*plug",
  Hybrid: "hybrid|gas\\s*/\\s*electric|mhev|\\yhev\\y",
  Diesel: "diesel|nafta|motorina|gasolio|gas[oó]leo|дизел|디젤|light\\s*oil|\\ytdi\\y|\\ycdi\\y|\\yhdi\\y|\\ydci\\y|\\ycrdi\\y",
  Electric: "electricit|electric|\\yev\\y|elektro|elektr|електр",
  Hydrogen: "hydrogen|wasserstoff|vod[ií]k|fuel\\s*cell",
  LPG: "\\ylpg\\y|autogas|\\ygpl\\y|gasoline\\+lpg|petrol\\+lpg",
  CNG: "\\ycng\\y|erdgas|metano|zemní\\s*plyn|zemny\\s*plyn|natural\\s*gas|compressed\\s*natural",
  "Flex Fuel": "flex(ible)?(\\s*fuel)?|e85|ethanol",
  Gasoline: "benz[ií]n|petrol|gasoline|gasolina|benzin|benzina|essence|бензин|\\ygas\\y",
  Other: "other|unsure|unknown|n/a",
};

/** Case-insensitive regex for SQL `fuel_type ~* …` when filtering by a facet value. */
export function fuelTypeMatchRegex(selected: string): string | null {
  const canonical = normalizeFuelType(selected);
  if (!canonical) return null;
  return FUEL_MATCH_RE[canonical] ?? null;
}

/**
 * Exact-string matchers for a selected fuel facet (legacy OR-eq path).
 * Prefer fuelTypeMatchRegex for filtering; keep needles for simple equality tests.
 */
export function fuelTypeFilterNeedles(selected: string): string[] {
  const canonical = normalizeFuelType(selected) ?? selected.trim();
  const needles = new Set<string>([canonical, selected.trim()]);
  switch (normalizeFuelType(selected) ?? "") {
    case "Gasoline":
      ["Gasoline", "gasoline", "GASOLINE", "Petrol", "petrol", "PETROL", "Gas", "GAS", "Gasolina", "Benzin", "Benzine"].forEach(
        (x) => needles.add(x),
      );
      break;
    case "Diesel":
      ["Diesel", "diesel", "DIESEL", "Nafta", "Gasolio", "디젤"].forEach((x) => needles.add(x));
      break;
    case "Hybrid":
      ["Hybrid", "hybrid", "HYBRID", "HYBRID ENGINE", "Hybrid Engine", "Gas/Electric Hybrid", "HYBRID PETROL"].forEach(
        (x) => needles.add(x),
      );
      break;
    case "Plug-in Hybrid":
      ["Plug-in Hybrid", "Plug-In Hybrid", "Hybryda Plug-in", "PHEV"].forEach((x) => needles.add(x));
      break;
    case "Electric":
      ["Electric", "electric", "ELECTRIC", "ELECTRICITY", "electric vehicle (ev)", "EV"].forEach((x) => needles.add(x));
      break;
    case "Flex Fuel":
      ["Flexible", "FLEXIBLE FUEL", "Flexiblefuel", "Flex Fuel", "Flexible Fuel"].forEach((x) => needles.add(x));
      break;
    case "LPG":
      ["LPG", "Gasoline+LPG", "GPL"].forEach((x) => needles.add(x));
      break;
    case "CNG":
      ["CNG", "cng"].forEach((x) => needles.add(x));
      break;
    case "Hydrogen":
      ["Hydrogen", "HYDROGEN+ELECTRICITY"].forEach((x) => needles.add(x));
      break;
    case "Other":
      ["Other", "Other / Unsure", "others"].forEach((x) => needles.add(x));
      break;
    default:
      break;
  }
  return [...needles].filter(Boolean);
}

/** Merge raw { fuelType, count } rows into canonical buckets. */
export function mergeFuelCounts(
  rows: Array<{ fuelType: string | null; count: number }>,
): Array<{ fuelType: string; count: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const raw = row.fuelType?.trim();
    if (!raw) continue;
    const key = normalizeFuelType(raw) ?? raw;
    map.set(key, (map.get(key) ?? 0) + Number(row.count ?? 0));
  }
  return [...map.entries()]
    .map(([fuelType, count]) => ({ fuelType, count }))
    .sort((a, b) => b.count - a.count || a.fuelType.localeCompare(b.fuelType));
}
