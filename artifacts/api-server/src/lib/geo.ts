export const SOUTH_KOREA = "South Korea";
export const UNITED_STATES = "United States";
export const CANADA = "Canada";
export const UNITED_ARAB_EMIRATES = "United Arab Emirates";
export const UNITED_KINGDOM = "United Kingdom";
export const POLAND = "Poland";
export const AUSTRIA = "Austria";
export const EUROPE = "Europe";
export const GEORGIA = "Georgia";
export const GERMANY = "Germany";
export const FRANCE = "France";
export const JAPAN = "Japan";

const KOREA_ONLY_RE = /^(s\.?\s*)?korea$/i;
const HAS_SOUTH_KOREA_RE = /south\s+korea/i;
const HAS_KOREA_RE = /(south\s+)?korea/i;

/** Lowercased aliases → canonical display name. Codes like kr/us mix with full names. */
const COUNTRY_ALIASES: Record<string, string> = {
  kr: SOUTH_KOREA,
  kor: SOUTH_KOREA,
  korea: SOUTH_KOREA,
  "s korea": SOUTH_KOREA,
  "s. korea": SOUTH_KOREA,
  "south korea": SOUTH_KOREA,
  "republic of korea": SOUTH_KOREA,
  rok: SOUTH_KOREA,
  us: UNITED_STATES,
  usa: UNITED_STATES,
  "u.s.": UNITED_STATES,
  "u.s.a.": UNITED_STATES,
  "united states": UNITED_STATES,
  "united states of america": UNITED_STATES,
  america: UNITED_STATES,
  ca: CANADA,
  can: CANADA,
  canada: CANADA,
  ae: UNITED_ARAB_EMIRATES,
  uae: UNITED_ARAB_EMIRATES,
  "united arab emirates": UNITED_ARAB_EMIRATES,
  gb: UNITED_KINGDOM,
  uk: UNITED_KINGDOM,
  "united kingdom": UNITED_KINGDOM,
  "great britain": UNITED_KINGDOM,
  ge: GEORGIA,
  geo: GEORGIA,
  georgia: GEORGIA,
  de: GERMANY,
  deu: GERMANY,
  germany: GERMANY,
  fr: FRANCE,
  fra: FRANCE,
  france: FRANCE,
  pl: POLAND,
  pol: POLAND,
  poland: POLAND,
  at: AUSTRIA,
  aut: AUSTRIA,
  austria: AUSTRIA,
  eu: EUROPE,
  europe: EUROPE,
  jp: JAPAN,
  jpn: JAPAN,
  japan: JAPAN,
};

function aliasKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/[.]/g, "")
    .replace(/\s+/g, " ");
}

/** API slug for country (e.g. `south_korea`, `united_states`). */
export function countryApiSlug(value: string | null | undefined): string | null {
  const canonical = canonicalCountry(value);
  if (!canonical) return null;
  return canonical
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Map KR/US/CA (and similar) onto a single display name. Unknown values are trimmed as-is. */
export function canonicalCountry(value: string | null | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = String(value).trim();
  if (!trimmed) return undefined;
  return COUNTRY_ALIASES[aliasKey(trimmed)] ?? trimmed;
}

/** All stored spellings that should match a country filter (code or full name). */
export function countryFilterValues(input: string): string[] {
  const canonical = canonicalCountry(input);
  if (!canonical) return [];
  const out = new Set<string>([canonical, input.trim()]);
  for (const [alias, name] of Object.entries(COUNTRY_ALIASES)) {
    if (name !== canonical) continue;
    out.add(alias.toUpperCase());
    out.add(name);
    if (alias.includes(" ")) out.add(alias.replace(/\b\w/g, (c) => c.toUpperCase()));
  }
  return [...out].filter(Boolean);
}

export function isKoreaCountry(value: unknown): boolean {
  return canonicalCountry(String(value ?? "")) === SOUTH_KOREA;
}

export function isUsOrCanadaCountry(value: unknown): boolean {
  const name = canonicalCountry(String(value ?? ""));
  return name === UNITED_STATES || name === CANADA;
}

export function mergeCountryCounts(
  rows: Array<{ country: string | null; count: number }>,
  limit = 20,
): Array<{ country: string | null; count: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = canonicalCountry(row.country) ?? (row.country?.trim() || "Unknown");
    map.set(key, (map.get(key) ?? 0) + Number(row.count));
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([country, count]) => ({ country, count }));
}

/** Append a country to a city/region string without duplicating it. */
export function withCountry(
  location: string | undefined | null,
  country: string,
): string | undefined {
  const loc = location?.trim();
  const canon = canonicalCountry(country) ?? country;
  if (!loc) return canon || undefined;

  if (canon === SOUTH_KOREA || /korea/i.test(country)) {
    if (KOREA_ONLY_RE.test(loc) || /^kr$/i.test(loc)) return SOUTH_KOREA;
    if (HAS_SOUTH_KOREA_RE.test(loc)) return loc;
    if (HAS_KOREA_RE.test(loc)) {
      return loc
        .replace(/\bS\.?\s*Korea\b/gi, SOUTH_KOREA)
        .replace(/\bKorea\b/gi, (match, offset, whole: string) => {
          const before = whole.slice(Math.max(0, offset - 6), offset);
          if (/south\s$/i.test(before)) return match;
          return SOUTH_KOREA;
        });
    }
    return `${loc}, ${SOUTH_KOREA}`;
  }

  const escaped = canon.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${escaped}\\b`, "i").test(loc)) return loc;
  if (country && country !== canon && new RegExp(`\\b${country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(loc)) {
    return loc;
  }
  return `${loc}, ${canon}`;
}

/** Strip a trailing country token so provider search mappers can use city/region only. */
export function stripCountrySuffix(location: string | undefined | null): string | undefined {
  if (!location?.trim()) return undefined;
  const cleaned = location
    .trim()
    .replace(/,?\s*(south\s+)?korea$/i, "")
    .replace(/,?\s*\bKR\b$/i, "")
    .replace(/,?\s*united states( of america)?$/i, "")
    .replace(/,?\s*\bUSA\b$/i, "")
    .replace(/,?\s*\bUS\b$/i, "")
    .trim();
  return cleaned || undefined;
}
