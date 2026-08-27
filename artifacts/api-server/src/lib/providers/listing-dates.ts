/**
 * Prefer site publish / update timestamps over collector clock time.
 */

import type { NormalizedListing } from "@workspace/providers";

const MIN_REASONABLE = Date.parse("1990-01-01T00:00:00Z");
const MAX_FUTURE_MS = 2 * 24 * 60 * 60 * 1000;

export function isReasonableDate(d: Date | undefined | null): d is Date {
  if (!d || Number.isNaN(d.getTime())) return false;
  const t = d.getTime();
  if (t < MIN_REASONABLE) return false;
  if (t > Date.now() + MAX_FUTURE_MS) return false;
  return true;
}

/** Parse YYYYMMDD or YYMMDD (as local Korea midnight → UTC preserved as date). */
export function parseYmd(raw: string | undefined | null, opts?: { twoDigitYear?: boolean }): Date | undefined {
  if (!raw) return undefined;
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0));
    return isReasonableDate(d) ? d : undefined;
  }
  if (opts?.twoDigitYear) {
    m = s.match(/^(\d{2})(\d{2})(\d{2})$/);
    if (m) {
      const yy = Number(m[1]);
      const year = yy >= 70 ? 1900 + yy : 2000 + yy;
      const d = new Date(Date.UTC(year, Number(m[2]) - 1, Number(m[3]), 0, 0, 0));
      return isReasonableDate(d) ? d : undefined;
    }
  }
  return undefined;
}

export function parseIsoDate(raw: unknown): Date | undefined {
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  const d = new Date(raw.trim());
  return isReasonableDate(d) ? d : undefined;
}

/** Autowini itemCode like CI202608060005181701 → 2026-08-06. */
export function listedAtFromAutowiniItemCode(code: unknown): Date | undefined {
  if (typeof code !== "string") return undefined;
  const m = code.trim().match(/^CI(\d{4})(\d{2})(\d{2})/i);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0));
  return isReasonableDate(d) ? d : undefined;
}

/** Mongo ObjectId → creation time (Auctionauto `_id`). */
export function listedAtFromMongoObjectId(id: unknown): Date | undefined {
  if (typeof id !== "string" || !/^[a-f0-9]{24}$/i.test(id.trim())) return undefined;
  const sec = Number.parseInt(id.trim().slice(0, 8), 16);
  if (!Number.isFinite(sec)) return undefined;
  const d = new Date(sec * 1000);
  return isReasonableDate(d) ? d : undefined;
}

/** First CIYYYYMMDD… token found in text (image URLs, etc.). */
export function listedAtFromCiToken(text: unknown): Date | undefined {
  if (typeof text !== "string") return undefined;
  const m = text.match(/CI(\d{4})(\d{2})(\d{2})/i);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 0, 0, 0));
  return isReasonableDate(d) ? d : undefined;
}

/** Kolon goods id like PT260820-0010399 → 2026-08-20. */
export function listedAtFromKolonGoodsId(id: unknown): Date | undefined {
  if (typeof id !== "string") return undefined;
  const m = id.trim().match(/^PT(\d{2})(\d{2})(\d{2})(?:-|$)/i);
  if (!m) return undefined;
  return parseYmd(`${m[1]}${m[2]}${m[3]}`, { twoDigitYear: true });
}

/**
 * Business date for a history row:
 * sold → publish → last site update → crawl time.
 */
export function resolveObservationAt(listing: NormalizedListing, fallback = new Date()): Date {
  const status = listing.listingStatus ?? (listing.isActive === false ? "inactive" : "active");
  if (status === "sold" && isReasonableDate(listing.soldAt)) return listing.soldAt;
  if (isReasonableDate(listing.sourceListedAt)) return listing.sourceListedAt;
  if (isReasonableDate(listing.sourceModifiedAt)) return listing.sourceModifiedAt;
  return fallback;
}

export function resolveListingFirstSeenAt(listing: NormalizedListing, fallback = new Date()): Date {
  if (isReasonableDate(listing.sourceListedAt)) return listing.sourceListedAt;
  if (isReasonableDate(listing.sourceModifiedAt)) return listing.sourceModifiedAt;
  return fallback;
}

export function resolveListingLastSeenAt(listing: NormalizedListing, fallback = new Date()): Date {
  if (isReasonableDate(listing.sourceModifiedAt)) return listing.sourceModifiedAt;
  if (isReasonableDate(listing.sourceListedAt)) return listing.sourceListedAt;
  return fallback;
}

export function earlierDate(a: Date | null | undefined, b: Date | null | undefined): Date | undefined {
  const okA = isReasonableDate(a) ? a : undefined;
  const okB = isReasonableDate(b) ? b : undefined;
  if (!okA) return okB;
  if (!okB) return okA;
  return okA.getTime() <= okB.getTime() ? okA : okB;
}

export function laterDate(a: Date | null | undefined, b: Date | null | undefined): Date | undefined {
  const okA = isReasonableDate(a) ? a : undefined;
  const okB = isReasonableDate(b) ? b : undefined;
  if (!okA) return okB;
  if (!okB) return okA;
  return okA.getTime() >= okB.getTime() ? okA : okB;
}
