export const SOUTH_KOREA = "South Korea";
export const UNITED_ARAB_EMIRATES = "United Arab Emirates";
export const POLAND = "Poland";
export const AUSTRIA = "Austria";
export const EUROPE = "Europe";

const KOREA_ONLY_RE = /^(s\.?\s*)?korea$/i;
const HAS_SOUTH_KOREA_RE = /south\s+korea/i;
const HAS_KOREA_RE = /(south\s+)?korea/i;

/** Append a country to a city/region string without duplicating it. */
export function withCountry(
  location: string | undefined | null,
  country: string,
): string | undefined {
  const loc = location?.trim();
  if (!loc) return country || undefined;

  if (country === SOUTH_KOREA || /korea/i.test(country)) {
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

  const escaped = country.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (new RegExp(`\\b${escaped}\\b`, "i").test(loc)) return loc;
  return `${loc}, ${country}`;
}

/** Strip a trailing country token so provider search mappers can use city/region only. */
export function stripCountrySuffix(location: string | undefined | null): string | undefined {
  if (!location?.trim()) return undefined;
  const cleaned = location
    .trim()
    .replace(/,?\s*(south\s+)?korea$/i, "")
    .replace(/,?\s*\bKR\b$/i, "")
    .trim();
  return cleaned || undefined;
}
