import type { NormalizedPhoto } from "@workspace/providers";

export const MARKET_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export async function fetchHtml(
  url: string,
  extraHeaders: Record<string, string> = {},
): Promise<{ text: string; status: number; finalUrl: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": MARKET_UA,
      Accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...extraHeaders,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") || "";
  // Prefer HTTP charset when present; otherwise read HTML/XML meta (mobile.bg serves
  // windows-1251 with no Content-Type charset — UTF-8 decode garbles Cyrillic fields).
  const headerCharset = ct.match(/charset=([\w-]+)/i)?.[1];
  const headLatin1 = buf.subarray(0, Math.min(buf.length, 4096)).toString("latin1");
  const metaCharset =
    headLatin1.match(/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i)?.[1] ||
    headLatin1.match(/<meta[^>]+content=["'][^"']*charset=([\w-]+)/i)?.[1] ||
    headLatin1.match(/<\?xml[^>]+encoding=["']([\w-]+)/i)?.[1];
  const charset = (headerCharset || metaCharset || "utf-8").toLowerCase().replace(/utf-8/i, "utf-8");
  let text: string;
  if (charset === "utf-8" || charset === "utf8") {
    text = buf.toString("utf8");
  } else if (charset === "iso-8859-1" || charset === "latin1") {
    text = buf.toString("latin1");
  } else {
    try {
      text = new TextDecoder(charset).decode(buf);
    } catch {
      text = buf.toString("utf8");
    }
  }
  return { text, status: res.status, finalUrl: res.url };
}

export function extractNextData(html: string): unknown {
  const match = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

export function extractNuxtData(html: string): unknown {
  const match =
    html.match(/window\.__NUXT__\s*=\s*([\s\S]*?);\s*<\/script>/) ||
    html.match(/<script>window\.__NUXT__=([\s\S]*?)<\/script>/);
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

export function mentionsVinLabel(text: string): boolean {
  return /(?:\bvin\b|chassis(?:\s*(?:no\.?|number|#))?|fahrgestell|차대번호|vehicle identification|numer\s*(?:vin|nadwozia)|n[o°]\s*(?:de\s*)?chassis)/i.test(
    text,
  );
}

/** Third-party / chrome assets that are never listing car photos. */
const PHOTO_JUNK_HOST =
  /mcusercontent\.com|mailchimp\.com|list-manage\.com|doubleclick\.net|googlesyndication\.com|googleadservices\.com|google-analytics\.com|facebook\.com|fbcdn\.net|twitter\.com|twimg\.com|linkedin\.com|pinterest\.com|tiktok\.com|hotjar\.com|clarity\.ms|cdninstagram\.com/i;

const PHOTO_JUNK_PATH =
  /logo|favicon|sprite|placeholder|nophoto|no[_-]?photo|badge|avatar|icon[-_/]|\/icons?\/|apple-touch|social|pixel|tracking|newsletter|banner[-_]?ad|btn[-_]|button|watermark|spinner|loader|emoji|carpoolkr\.com\/assets\/car\/(?:make|type)\//i;

/** Prefer same-site images; strip size variants so the same shot is not stored twice. */
export function photoIdentityKey(url: string): string {
  const raw = url.trim();
  // IAAI resizer / 360 retriever: identity lives in query params, not the path.
  try {
    const parsed = new URL(raw);
    const host = parsed.hostname.replace(/^www\./i, "");
    if (/vis\.iaai\.com$/i.test(host) && /\/resizer/i.test(parsed.pathname)) {
      const keys = parsed.searchParams.get("imageKeys") || "";
      if (keys) return `iaai-vis:${keys.toLowerCase()}`;
    }
    if (/mediaretriever\.iaai\.com$/i.test(host)) {
      const pk = (parsed.searchParams.get("partitionKey") || "").toLowerCase();
      const order = parsed.searchParams.get("imageOrder") || "";
      if (/threesixtyimageretriever/i.test(parsed.pathname) && pk) {
        return `iaai-360:${pk}:${order || "0"}`;
      }
      if (/interiorimageretriever/i.test(parsed.pathname) && pk) {
        return `iaai-pano:${pk}`;
      }
    }
  } catch {
    /* fall through */
  }

  let u = raw.split("#")[0]!.split("?")[0]!.trim().replace(/\/+$/, "").toLowerCase();
  u = u.replace(/\/w_\d+x\d+\//g, "/");
  u = u.replace(/\/\d{2,4}x\d{2,4}\//g, "/");
  u = u.replace(/\/(?:thumb|small|medium|large|preview|resized?)\//g, "/");
  // Dubicars CDN: /images/{hash}/dealer/file.jpeg → /images/dealer/file.jpeg
  u = u.replace(/\/images\/[a-f0-9]{4,12}\//g, "/images/");
  // Encar / Autowini style size suffixes in filename
  u = u.replace(/_(?:thumb|small|medium|large|orig)\.(jpe?g|webp|png)$/i, ".$1");

  // Import Motor CDN: cars vs cars2 + rotating lot folders all host the same VIN-N shot.
  // https://cars2.import-motor.com/copart/chevrolet/equinox/2025/61303996/3GN7…-1.webp
  const imShot = u.match(
    /cars2?\.import-motor\.com\/(encar|copart|iaa)\/.+?\/([a-hj-npr-z0-9]{17})-(\d+)\.(jpe?g|webp|png)$/i,
  );
  if (imShot) {
    return `im-cdn:${imShot[1]}:${imShot[2]}:${imShot[3]}.${imShot[4]}`;
  }
  // Collapse cars / cars2 host for any other IM media path.
  u = u.replace(/\/\/cars2\.import-motor\.com\//i, "//cars.import-motor.com/");
  // Seobuk / Carmanager host aliases for the same temp/photo hash.
  u = u.replace(/\/\/(?:www\.)?myshop-img\d*\.carmanager\.co\.kr\//i, "//img.carmanager.co.kr/");

  return u;
}

/** IAAI (and similar) hosts put the real image id in the query string — never strip it. */
export function keepPhotoQueryParams(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^www\./i, "");
    if (/vis\.iaai\.com$/i.test(host)) return true;
    if (/mediaretriever\.iaai\.com$/i.test(host)) return true;
  } catch {
    /* fall through */
  }
  return false;
}

/** Normalize a candidate photo URL while preserving query identity where required. */
export function cleanPhotoUrl(url: string): string {
  const raw = url.replace(/&amp;/g, "&").trim();
  if (!raw) return "";
  const noHash = raw.split("#")[0]!.trim();
  if (keepPhotoQueryParams(noHash)) return noHash;
  return noHash.split("?")[0]!.trim();
}

export function isJunkPhotoUrl(url: string): boolean {
  if (!url || !/^https?:\/\//i.test(url)) return true;
  if (/\.(svg)(\?|$)/i.test(url)) return true;
  // Bare IAAI deepzoom / viewer shells are not real image assets.
  if (/vis\.iaai\.com\/deepzoom\/?$/i.test(url.split("?")[0]!)) return true;
  if (/Home\/ThreeSixtyView/i.test(url)) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./i, "");
    // Bare resizer without imageKeys is not a car photo (all lots collapse to this path).
    if (/vis\.iaai\.com$/i.test(host) && /\/resizer\/?$/i.test(parsed.pathname)) {
      if (!parsed.searchParams.get("imageKeys")) return true;
    }
    if (PHOTO_JUNK_HOST.test(host) || PHOTO_JUNK_HOST.test(parsed.hostname)) return true;
  } catch {
    return true;
  }
  if (PHOTO_JUNK_PATH.test(url)) return true;
  // Autoplac workshop promos / dealer logos are not listing gallery shots.
  if (/cdn\.autoplac\.pl\/warsztaty\//i.test(url)) return true;
  if (/cdn\.autoplac\.pl\/v1\/p\/dl\//i.test(url)) return true;
  if (/cdn\.autoplac\.pl\/assets\//i.test(url)) return true;
  return false;
}

function photoSizeScore(url: string): number {
  const m = url.match(/\/(?:w_)?(\d{2,4})x(\d{2,4})\//i);
  if (!m) return 0;
  return Number(m[1]) * Number(m[2]);
}

export function asPhotos(urls: string[], max = 40): NormalizedPhoto[] {
  const best = new Map<string, { url: string; score: number }>();
  for (const raw of urls) {
    if (!raw || isJunkPhotoUrl(raw)) continue;
    const url = cleanPhotoUrl(raw);
    if (!url || isJunkPhotoUrl(url)) continue;
    // Identity must see the full URL (IAAI imageKeys live in the query).
    const key = photoIdentityKey(url);
    const score = photoSizeScore(url) || (keepPhotoQueryParams(url) ? 1 : 0);
    const prev = best.get(key);
    if (!prev || score > prev.score) best.set(key, { url, score });
  }
  const out: NormalizedPhoto[] = [];
  for (const { url } of best.values()) {
    out.push({ sourceUrl: url, isPrimary: out.length === 0, sortOrder: out.length });
    if (out.length >= max) break;
  }
  return out;
}

/**
 * Carpages CDN paths are `images.carpages.ca/inventory/{listingId}.{imageId}.jpg`.
 * Detail pages also embed related-vehicle thumbs — keep only this listing's id.
 */
export function carpagesInventoryId(sourceIdOrUrl: string): string | undefined {
  const path = sourceIdOrUrl.split("?")[0]!.replace(/\/+$/, "");
  // OntarioCars: .../2005-freightliner-mt45/12699705
  const slash = path.match(/\/(\d{5,})$/);
  if (slash?.[1]) return slash[1];
  // Carpages: .../2024-dodge-durango-14749844
  const dash = path.match(/-(\d{5,})$/);
  if (dash?.[1]) return dash[1];
  return undefined;
}

/** Extract only CDN images belonging to this Carpages/OntarioCars inventory id. */
export function extractCarpagesInventoryPhotos(html: string, inventoryId: string, max = 40): string[] {
  if (!inventoryId || !/^\d{5,}$/.test(inventoryId)) return [];
  const urls: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(
    /https?:\/\/images\.carpages\.ca\/inventory\/(\d+)\.([A-Za-z0-9._-]+)/gi,
  )) {
    if (match[1] !== inventoryId) continue;
    const url = `https://images.carpages.ca/inventory/${match[1]}.${match[2]}`;
    const key = photoIdentityKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
    if (urls.length >= max) break;
  }
  return urls;
}

export function collectHttpImages(html: string, hostHint?: string, max = 40): string[] {
  const preferred: string[] = [];
  const other: string[] = [];
  const seen = new Set<string>();
  const push = (raw?: string) => {
    if (!raw) return;
    let cleaned = raw.replace(/\\u002F/g, "/").replace(/\\\//g, "/").split("?")[0]!.trim();
    if (cleaned.startsWith("//")) cleaned = `https:${cleaned}`;
    if (!/^https?:\/\//i.test(cleaned)) return;
    if (isJunkPhotoUrl(cleaned)) return;
    const key = photoIdentityKey(cleaned);
    if (seen.has(key)) {
      // Keep the larger size variant when we see the same shot again.
      const list = hostHint && cleaned.toLowerCase().includes(hostHint.toLowerCase()) ? preferred : other;
      const idx = list.findIndex((u) => photoIdentityKey(u) === key);
      if (idx >= 0 && photoSizeScore(cleaned) > photoSizeScore(list[idx]!)) list[idx] = cleaned;
      return;
    }
    seen.add(key);
    if (hostHint && cleaned.toLowerCase().includes(hostHint.toLowerCase())) preferred.push(cleaned);
    else other.push(cleaned);
  };
  for (const match of html.matchAll(
    /(?:https?:)?\/\/[^"'\\\s>]+\.(?:jpe?g|webp|png)(?:\?[^"'\\\s>]*)?/gi,
  )) {
    push(match[0]);
    if (preferred.length + other.length >= max * 4) break;
  }
  // When a host hint is set, never fall back to random third-party PNGs/icons.
  const picked = hostHint ? preferred : preferred.concat(other);
  return picked.slice(0, max);
}

export function deepGet(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value.replace(/[^\d.]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function str(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

const MAX_REG_YEAR = () => new Date().getUTCFullYear() + 1;

function isPlausibleRegYear(year: number): boolean {
  return year >= 1980 && year <= MAX_REG_YEAR();
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** How much of the calendar date is known (occurredAt may still be YYYY-01-01). */
function datePrecisionOf(label: string): "year" | "month" | "day" {
  if (/^\d{4}$/.test(label)) return "year";
  if (/^\d{4}-\d{2}$/.test(label)) return "month";
  return "day";
}

/**
 * Parse a first-registration date into a delivery event.
 * Accepts YYYY, YYYY-MM, YYYY-MM-DD, YYYY.MM.DD, MM/YYYY, and bare year numbers.
 * Description always uses "First registration: …" so auction-sales can extract it.
 */
export function firstRegEvent(
  raw: unknown,
): { eventType: "delivery"; description: string; occurredAt: Date; metadata: Record<string, unknown> } | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return productionFirstRegEvent(Math.trunc(raw));
  }
  const text = str(raw);
  if (!text) return undefined;

  // Bare year: "2009" / "Year 2009"
  const bare = text.match(/^(?:year[:\s]*)?((?:19|20)\d{2})$/i);
  if (bare) return productionFirstRegEvent(Number(bare[1]));

  const ymd = text.match(/((?:19|20)\d{2})[.\/-](\d{1,2})(?:[.\/-](\d{1,2}))?/);
  const ymEu = text.match(/(\d{1,2})\/((?:19|20)\d{2})/);
  let year: number | undefined;
  let month = 1;
  let day = 1;
  if (ymd) {
    year = Number(ymd[1]);
    month = Number(ymd[2]);
    day = Number(ymd[3] ?? "1");
  } else if (ymEu) {
    year = Number(ymEu[2]);
    month = Number(ymEu[1]);
  }
  if (year == null || !isPlausibleRegYear(year) || month < 1 || month > 12 || day < 1 || day > 31) {
    return undefined;
  }
  const label =
    ymd?.[3] || day > 1
      ? `${year}-${pad2(month)}-${pad2(day)}`
      : month > 1 || ymd?.[2] || ymEu
        ? `${year}-${pad2(month)}`
        : `${year}`;
  const occurredAt = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(occurredAt.getTime())) return undefined;
  return {
    eventType: "delivery",
    description: `First registration: ${label}`,
    occurredAt,
    metadata: {
      kind: "firstRegistration",
      field: "firstRegistration",
      value: label,
      datePrecision: datePrecisionOf(label),
    },
  };
}

/** First registration fallback from production / model year (month/day optional). */
export function productionFirstRegEvent(
  year?: number | null,
  month?: number | null,
  day?: number | null,
): { eventType: "delivery"; description: string; occurredAt: Date; metadata: Record<string, unknown> } | undefined {
  if (year == null || !Number.isFinite(year) || !isPlausibleRegYear(Math.trunc(year))) return undefined;
  const y = Math.trunc(year);
  const m = month != null && month >= 1 && month <= 12 ? Math.trunc(month) : 1;
  const d = day != null && day >= 1 && day <= 31 ? Math.trunc(day) : 1;
  const label =
    month != null && month >= 1 && month <= 12
      ? day != null && day >= 1 && day <= 31
        ? `${y}-${pad2(m)}-${pad2(d)}`
        : `${y}-${pad2(m)}`
      : `${y}`;
  return {
    eventType: "delivery",
    description: `First registration: ${label}`,
    occurredAt: new Date(Date.UTC(y, m - 1, d)),
    metadata: {
      kind: "firstRegistration",
      field: "firstRegistration",
      value: label,
      source: "productionYear",
      datePrecision: datePrecisionOf(label),
    },
  };
}

/** True when an event is a real first-registration delivery (not an undated history label). */
export function isFirstRegistrationEvent(event: {
  eventType?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown> | null;
}): boolean {
  if (event.eventType !== "delivery") return false;
  const meta = event.metadata ?? {};
  const field = String(meta.field ?? meta.kind ?? "");
  if (/firstRegistration|firstDate|first_reg/i.test(field)) return true;
  return /first registration/i.test(event.description ?? "");
}

export function walkFind<T>(root: unknown, pred: (key: string, value: unknown) => T | undefined): T | undefined {
  const seen = new Set<unknown>();
  const stack: unknown[] = [root];
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== "object" || seen.has(cur)) continue;
    seen.add(cur);
    if (Array.isArray(cur)) {
      for (const item of cur) stack.push(item);
      continue;
    }
    for (const [key, value] of Object.entries(cur as Record<string, unknown>)) {
      const hit = pred(key, value);
      if (hit !== undefined) return hit;
      if (value && typeof value === "object") stack.push(value);
    }
  }
  return undefined;
}
