import { load } from "cheerio";
import type { NormalizedListing, NormalizedPhoto, NormalizedVehicle } from "@workspace/providers";
import { SOUTH_KOREA } from "../geo";

export function normalizeKrVin(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const clean = raw.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (clean.length !== 17) return undefined;
  if (!/[0-9X]/.test(clean[8] ?? "")) return undefined;
  if (/^(.)\1{16}$/.test(clean)) return undefined;
  if (/(\d)\1{8,}$/.test(clean)) return undefined;
  // Real VINs always contain letters — reject all-numeric strings (e.g. image file IDs)
  if (/^\d+$/.test(clean)) return undefined;
  return clean;
}

const VIN_TRANSLIT: Record<string, number> = {
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
};
const VIN_WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function vinCheckDigitOk(vin: string): boolean {
  if (vin.length !== 17) return false;
  let sum = 0;
  for (let i = 0; i < 17; i++) {
    const ch = vin[i]!;
    const n = /\d/.test(ch) ? Number(ch) : VIN_TRANSLIT[ch];
    if (n == null) return false;
    sum += n * VIN_WEIGHTS[i]!;
  }
  const cd = sum % 11;
  const expect = cd === 10 ? "X" : String(cd);
  return vin[8] === expect;
}

export function findVinInText(text: string): string | undefined {
  const matches = text.toUpperCase().match(/\b[A-HJ-NPR-Z0-9]{17}\b/g) ?? [];
  for (const candidate of matches) {
    const vin = normalizeKrVin(candidate);
    if (vin) return vin;
  }
  return undefined;
}

/** VIN only when labeled (description / JSON fields), not random 17-char tokens. */
const VIN_LABEL_RE =
  /(?:\bvin\b|chassis(?:\s*(?:no\.?|number|#))?|fahrgestell(?:nummer)?|차대번호|vehicle identification(?:\s*number)?|n(?:um[eé]ro|o|°)\s*(?:de\s*)?chassis|numer\s*(?:vin|nadwozia)|vin\s*(?:code|number)|chassis no|номер кузова)\s*[:#=\s/-]*([A-HJ-NPR-Z0-9]{17})/gi;

export function findVinInListing(...parts: Array<string | null | undefined>): string | undefined {
  const text = parts.filter(Boolean).join("\n");
  if (!text) return undefined;
  for (const match of text.matchAll(VIN_LABEL_RE)) {
    const vin = normalizeKrVin(match[1]);
    if (vin && vinCheckDigitOk(vin)) return vin;
  }
  for (const match of text.matchAll(
    /"(?:vin|vinNumber|vin_number|chassisNumber|chassis|vehicleIdentificationNumber|cnumber)"\s*:\s*"([A-HJ-NPR-Z0-9]{17})"/gi,
  )) {
    const vin = normalizeKrVin(match[1]);
    if (vin && vinCheckDigitOk(vin)) return vin;
  }
  for (const match of text.matchAll(
    /(?:\bvin\b|chassis(?:\s*(?:no\.?|number))?|fahrgestellnummer|차대번호)[\s\S]{0,80}?([A-HJ-NPR-Z0-9]{17})/gi,
  )) {
    const vin = normalizeKrVin(match[1]);
    if (vin && vinCheckDigitOk(vin)) return vin;
  }
  return undefined;
}

export function parseMoney(raw?: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number(String(raw).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parseKm(raw?: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number(String(raw).replace(/[^\d]/g, ""));
  // 0 is almost always "unknown" on KR/auction feeds — treat as missing.
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

export function parseYear(raw?: string | null): number | undefined {
  if (!raw) return undefined;
  const m = String(raw).match(/(19|20)\d{2}/);
  if (!m) return undefined;
  const year = Number(m[0]);
  return year >= 1980 && year <= 2035 ? year : undefined;
}

export function absUrl(base: string, href?: string | null): string | undefined {
  if (!href) return undefined;
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

export function textOf($: ReturnType<typeof load>, sel: string): string {
  return $(sel).first().text().replace(/\s+/g, " ").trim();
}

export function specFromTable($: ReturnType<typeof load>, label: string): string | undefined {
  const needle = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`^\\s*${needle}\\s*:?\\s*$`, "i");
  const needleLower = label.toLowerCase();
  let found: string | undefined;
  $("th, td, dt, label").each((_, el) => {
    if (found) return;
    const labelText = $(el).text().replace(/\s+/g, " ").trim();
    const lower = labelText.toLowerCase();
    const matches =
      re.test(labelText) ||
      lower === needleLower ||
      lower.startsWith(`${needleLower}:`) ||
      lower.startsWith(`${needleLower}/`) ||
      lower.startsWith(`${needleLower} `);
    if (!matches) return;
    const tag = (el.tagName ?? "").toLowerCase();
    if (tag === "dt") {
      found = $(el).next("dd").text().replace(/\s+/g, " ").trim();
      return;
    }
    if (tag === "label") {
      found = labelText.replace(new RegExp(`^${needle}\\s*:?\\s*`, "i"), "").trim() || $(el).parent().text().replace(/\s+/g, " ").trim();
      return;
    }
    const next = $(el).next("td, th, dd");
    const nested = next.find("label, span").first().text().replace(/\s+/g, " ").trim();
    found = nested || next.text().replace(/\s+/g, " ").trim();
  });
  return found || undefined;
}

export function pagerMax(html: string, key: string, current: number): number {
  const re = new RegExp(`${key}=(\\d+)`, "gi");
  let max = current;
  for (const match of html.matchAll(re)) {
    const n = Number(match[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

const EXCLUDED_PHOTO_CONTAINERS =
  '[class*="similar"],[class*="related"],[class*="recommend"],[class*="other-lot"],[class*="also-like"]';

export function collectImgs(
  $: ReturnType<typeof load>,
  base: string,
  extra?: string[],
  opts?: { scope?: string; exclude?: string },
): NormalizedPhoto[] {
  const urls: string[] = [];
  const push = (raw?: string | null) => {
    const url = absUrl(base, raw);
    if (!url || url.startsWith("data:")) return;
    if (/\.(svg)(\?|$)/i.test(url)) return;
    if (urls.includes(url)) return;
    urls.push(url);
  };
  for (const extraUrl of extra ?? []) push(extraUrl);
  const root = opts?.scope ? $(opts.scope) : $.root();
  const excludeSel = opts?.exclude ?? EXCLUDED_PHOTO_CONTAINERS;
  root.find("img").each((_, el) => {
    if ($(el).closest(excludeSel).length > 0) return;
    const src = $(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-img");
    if (!src) return;
    if (/logo|icon|favicon|blank_photo|default\.webp|placeholder|visa-mastercard|mcusercontent|mailchimp|sprite|badge|avatar/i.test(src)) return;
    push(src);
  });
  return urls.slice(0, 40).map((sourceUrl, index) => ({
    sourceUrl,
    isPrimary: index === 0,
    sortOrder: index,
  }));
}

export function listingStatusFromFlags(opts: {
  sold?: boolean;
  reserved?: boolean;
  inactive?: boolean;
}): { isActive: boolean; listingStatus: "active" | "sold" | "reserved" | "inactive" } {
  if (opts.sold) return { isActive: false, listingStatus: "sold" };
  if (opts.reserved) return { isActive: false, listingStatus: "reserved" };
  if (opts.inactive) return { isActive: false, listingStatus: "inactive" };
  return { isActive: true, listingStatus: "active" };
}

export function vehicleFromParts(parts: {
  vin?: string;
  make?: string;
  model?: string;
  trim?: string;
  year?: number;
  fuelType?: string;
  transmission?: string;
  bodyType?: string;
  driveType?: string;
  engineDisplacement?: string;
  color?: string;
  country?: string;
}): NormalizedVehicle {
  return {
    vin: parts.vin,
    make: parts.make,
    model: parts.model,
    trim: parts.trim,
    year: parts.year,
    fuelType: parts.fuelType,
    transmission: parts.transmission,
    bodyType: parts.bodyType,
    driveType: parts.driveType,
    engineDisplacement: parts.engineDisplacement,
    color: parts.color,
    country: parts.country,
  };
}

export function usdListing(base: {
  sourceId: string;
  sourceUrl: string;
  title?: string;
  price?: number;
  mileage?: number;
  location?: string;
  sold?: boolean;
  reserved?: boolean;
  vehicle: NormalizedVehicle;
  photos: NormalizedPhoto[];
  sourceListedAt?: Date;
  sourceModifiedAt?: Date;
  soldAt?: Date;
}): NormalizedListing {
  const activity = listingStatusFromFlags(base);
  return {
    sourceId: base.sourceId,
    sourceUrl: base.sourceUrl,
    title: base.title,
    priceAmount: base.price,
    priceCurrency: "USD",
    mileage: base.mileage,
    mileageUnit: "km",
    location: base.location ? `${base.location}, ${SOUTH_KOREA}` : SOUTH_KOREA,
    country: SOUTH_KOREA,
    isActive: activity.isActive,
    listingStatus: activity.listingStatus,
    soldAt:
      activity.listingStatus === "sold"
        ? (base.soldAt ?? new Date())
        : undefined,
    sourceListedAt: base.sourceListedAt,
    sourceModifiedAt: base.sourceModifiedAt,
    vehicle: { ...base.vehicle, country: base.vehicle.country ?? SOUTH_KOREA },
    photos: base.photos,
  };
}

export function krwListing(base: {
  sourceId: string;
  sourceUrl: string;
  title?: string;
  /** Price in KRW (won), not 만원. */
  price?: number;
  mileage?: number;
  location?: string;
  sold?: boolean;
  reserved?: boolean;
  vehicle: NormalizedVehicle;
  photos: NormalizedPhoto[];
  sourceListedAt?: Date;
  sourceModifiedAt?: Date;
  soldAt?: Date;
}): NormalizedListing {
  const activity = listingStatusFromFlags(base);
  return {
    sourceId: base.sourceId,
    sourceUrl: base.sourceUrl,
    title: base.title,
    priceAmount: base.price,
    priceCurrency: "KRW",
    mileage: base.mileage,
    mileageUnit: "km",
    location: base.location ? `${base.location}, ${SOUTH_KOREA}` : SOUTH_KOREA,
    country: SOUTH_KOREA,
    isActive: activity.isActive,
    listingStatus: activity.listingStatus,
    soldAt:
      activity.listingStatus === "sold"
        ? (base.soldAt ?? new Date())
        : undefined,
    sourceListedAt: base.sourceListedAt,
    sourceModifiedAt: base.sourceModifiedAt,
    vehicle: { ...base.vehicle, country: base.vehicle.country ?? SOUTH_KOREA },
    photos: base.photos,
  };
}

export type KrFilterParams = {
  brand?: string;
  make?: string;
  model?: string;
  yearFrom?: number;
  yearTo?: number;
  maxPages?: number;
  maxListings?: number;
  delayMs?: number;
  concurrency?: number;
  pageSize?: number;
  skipRecentHours?: number;
  repeatHours?: number;
  nextRunAt?: string;
  detailLevel?: string;
  /** Import Motor buyer-location country codes (e.g. ["al","us"]). */
  countries?: string[];
};
