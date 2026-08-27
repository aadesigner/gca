import { load } from "cheerio";
import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  NormalizedVehicle,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import { normalizeVin, usMiListing } from "./us-common";
import { vehicleFromParts, findVinInText } from "./kr-common";

export const BAT_PARSER_VERSION = "bat-v1.4.2";
const BASE = "https://bringatrailer.com";
const FILTER_API = `${BASE}/wp-json/bringatrailer/1.0/data/listings-filter`;
const PER_PAGE = 45;
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

const BAT_PHOTO_JUNK =
  /favicon|logo|sprite|placeholder|icon[-_]|Widget(?:Desktop|Mobile)|marketing|Concours|weekly-weird|BaT-Vintage|title-for-schedule|LOESHOW|carfest|Screenshot|QoTW|Swig20|image20\d{4}|TC6_marketing|latest-feature|current-auction/i;

export function batDetailUrl(slug: string): string {
  return `${BASE}/listing/${slug}/`;
}

function batFetch(url: string): Promise<{ text: string; status: number; finalUrl: string }> {
  return fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" }).then(async (r) => ({
    text: await r.text(),
    status: r.status,
    finalUrl: r.url,
  }));
}

function slugFromUrl(url: string, fallback: string): string {
  return url.match(/\/listing\/([a-z0-9-]+)/i)?.[1] ?? fallback;
}

const BAT_MAX_MILEAGE = 2_000_000;

function sanitizeBatMileage(n: number | undefined): number | undefined {
  if (n == null || !Number.isFinite(n)) return undefined;
  if (n <= 1 || n > BAT_MAX_MILEAGE) return undefined;
  return Math.round(n);
}

type BatMileageParsed = { value: number; unit: "mi" | "km" };

function toStoredMiles(parsed: BatMileageParsed | undefined): number | undefined {
  if (!parsed) return undefined;
  if (parsed.unit === "km") return sanitizeBatMileage(parsed.value * 0.621371);
  return parsed.value;
}

/** Parse BaT mileage strings like "130k miles", "~65,000 miles", "3,200 Kilometers (~2k Miles)". */
export function parseBatMileageText(text: string): number | undefined {
  return toStoredMiles(parseBatMileageParts(text));
}

export function parseBatMileageParts(text: string): BatMileageParsed | undefined {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return undefined;
  // Ignore "~2k Miles" conversion notes inside parentheses
  const beforeParen = t.split("(")[0]?.trim() || t;

  const commaKm = beforeParen.match(/([\d]{1,3}(?:,\d{3})+|\d{1,7})\s*kilometers?\b/i);
  if (commaKm) {
    const value = sanitizeBatMileage(Number(commaKm[1].replace(/,/g, "")));
    if (value != null) return { value, unit: "km" };
  }
  const commaMi = beforeParen.match(/([\d]{1,3}(?:,\d{3})+|\d{1,7})\s*miles?\b/i);
  if (commaMi) {
    const value = sanitizeBatMileage(Number(commaMi[1].replace(/,/g, "")));
    if (value != null) return { value, unit: "mi" };
  }

  const kKm = beforeParen.match(/([\d]+(?:\.\d+)?)\s*k\s*(?:[- ]?kilometers?|km)?\b/i);
  if (kKm && /kilometer|\bkm\b/i.test(beforeParen)) {
    const value = sanitizeBatMileage(Number(kKm[1]) * 1000);
    if (value != null) return { value, unit: "km" };
  }
  const kMi = beforeParen.match(/([\d]+(?:\.\d+)?)\s*k\s*(?:[- ]?miles?)?\b/i);
  if (kMi) {
    const value = sanitizeBatMileage(Number(kMi[1]) * 1000);
    if (value != null) return { value, unit: "mi" };
  }

  return undefined;
}

/**
 * BaT titles often encode mileage: "46k-Mile …", "3,800-Mile …", "3-Mile …".
 * Prefer comma groups / Nk forms so "3,800-Mile" is not read as 800.
 */
export function parseBatTitleMileage(title: string): number | undefined {
  return toStoredMiles(parseBatTitleMileageParts(title));
}

export function parseBatTitleMileageParts(title: string): BatMileageParsed | undefined {
  const t = title.replace(/\s+/g, " ").trim();
  if (!t) return undefined;

  const kKm = t.match(/\b([\d]+(?:\.\d+)?)\s*k[- ]?kilometers?\b/i);
  if (kKm) {
    const value = sanitizeBatMileage(Number(kKm[1]) * 1000);
    if (value != null) return { value, unit: "km" };
  }

  const kMi = t.match(/\b([\d]+(?:\.\d+)?)\s*k[- ]?miles?\b/i);
  if (kMi) {
    const value = sanitizeBatMileage(Number(kMi[1]) * 1000);
    if (value != null) return { value, unit: "mi" };
  }

  const commaKm = t.match(/\b([\d]{1,3}(?:,\d{3})+)\s*[- ]?kilometers?\b/i);
  if (commaKm) {
    const value = sanitizeBatMileage(Number(commaKm[1].replace(/,/g, "")));
    if (value != null) return { value, unit: "km" };
  }

  const commaMi = t.match(/\b([\d]{1,3}(?:,\d{3})+)\s*[- ]?miles?\b/i);
  if (commaMi) {
    const value = sanitizeBatMileage(Number(commaMi[1].replace(/,/g, "")));
    if (value != null) return { value, unit: "mi" };
  }

  const plainKm = t.match(/\b(\d{1,5})\s*[- ]?kilometers?\b/i);
  if (plainKm) {
    const value = sanitizeBatMileage(Number(plainKm[1]));
    if (value != null) return { value, unit: "km" };
  }

  const plainMi = t.match(/\b(\d{1,5})\s*[- ]?miles?\b/i);
  if (plainMi) {
    const value = sanitizeBatMileage(Number(plainMi[1]));
    if (value != null) return { value, unit: "mi" };
  }

  return undefined;
}

/**
 * Prefer Listing Details, then title, then post excerpt.
 * Never scan arbitrary page LIs / comments / sidebar auctions — those cause
 * cross-listing mileage contamination (e.g. another car's "1,328 Miles").
 */
export function extractBatMileage($: ReturnType<typeof load>, title?: string): number | undefined {
  const detailLis = $(".item strong")
    .filter((_, el) => /listing details/i.test($(el).text()))
    .first()
    .closest(".item")
    .find("li")
    .toArray()
    .map((el) => $(el).text().replace(/\s+/g, " ").trim());

  for (const li of detailLis) {
    if (!/mile|km|odometer/i.test(li)) continue;
    // Prefer short mileage bullets; allow "15 Miles on Replacement Odometer"
    if (li.length > 80) continue;
    const n = parseBatMileageText(li);
    if (n != null) return n;
  }

  const fromTitle = parseBatTitleMileage(title ?? $("h1.post-title").first().text());
  if (fromTitle != null) return fromTitle;

  const postExcerpt = $(".post-excerpt").first().text().replace(/\s+/g, " ");
  const fromExcerpt =
    parseBatMileageText(postExcerpt.match(/odometer (?:indicates|shows|reads)\s+([^.;]+)/i)?.[1] ?? "") ??
    parseBatMileageText(postExcerpt.match(/\bshows\s+(?:about\s+)?([^.;]{0,40}?(?:miles?|kilometers?|km))\b/i)?.[1] ?? "") ??
    parseBatMileageText(postExcerpt.match(/\bhas\s+(~?[\d.,]+\s*k?\s*(?:miles?|kilometers?|km))\b/i)?.[1] ?? "") ??
    parseBatMileageText(postExcerpt.match(/(~?[\d]{1,3}(?:,\d{3})+\s*(?:miles?|kilometers?|km))\b/i)?.[1] ?? "") ??
    parseBatMileageText(postExcerpt.match(/(~?[\d.]+\s*k\s*(?:miles?|kilometers?|km))\b/i)?.[1] ?? "");
  if (fromExcerpt != null) return fromExcerpt;

  return undefined;
}

function cleanBatPhotoUrl(raw: string): string | undefined {
  const url = raw
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .split("?")[0]
    ?.trim();
  if (!url || !/^https:\/\/bringatrailer\.com\/wp-content\/uploads\//i.test(url)) return undefined;
  if (!/\.(?:jpe?g|png|webp)$/i.test(url)) return undefined;
  if (BAT_PHOTO_JUNK.test(url)) return undefined;
  return url;
}

/** Prefer the listing Photo Gallery JSON; fall back to post body / hero only. */
export function extractBatPhotos(html: string): NormalizedPhoto[] {
  const seen = new Set<string>();
  const out: NormalizedPhoto[] = [];

  const push = (raw?: string) => {
    const url = raw ? cleanBatPhotoUrl(raw) : undefined;
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ sourceUrl: url, isPrimary: out.length === 0, sortOrder: out.length });
  };

  // 1) Official gallery payload on #bat_listing_page_photo_gallery
  // Inner quotes are HTML-entity encoded, so the attribute value has no raw ".
  const galleryAttr = html.match(/data-gallery-items="([^"]*)"/i)?.[1];
  if (galleryAttr) {
    try {
      const decoded = galleryAttr
        .replace(/&quot;/g, '"')
        .replace(/&#039;/g, "'")
        .replace(/&amp;/g, "&")
        .replace(/\\\//g, "/");
      const items = JSON.parse(decoded) as Array<{
        large?: { url?: string };
        url?: string;
        title?: string;
      }>;
      if (Array.isArray(items)) {
        for (const item of items) push(item.large?.url ?? item.url);
      }
    } catch {
      // fall through to DOM heuristics
    }
  }

  if (out.length > 0) return out.slice(0, 60);

  // 2) Schema.org Product image + hero + in-post size-large images (not sidebar features)
  const og = html.match(/property="og:image"[^>]+content="([^"]+)"/i)?.[1];
  push(og);
  const productImage = html.match(
    /"@type"\s*:\s*"Product"[\s\S]{0,400}?"image"\s*:\s*"([^"]+)"/i,
  )?.[1];
  push(productImage?.replace(/\\\//g, "/"));

  for (const m of html.matchAll(
    /<(?:img|IMG)\b[^>]*class="[^"]*(?:size-large|post-image)[^"]*"[^>]*>/gi,
  )) {
    const tag = m[0];
    if (/latest-feature-image|current-auction-image|attachment-media-block/i.test(tag)) continue;
    const src = tag.match(/\bsrc="([^"]+)"/i)?.[1];
    push(src);
  }

  return out.slice(0, 60);
}

export class BatHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "bringatrailer";

  constructor(private _baseUrl?: string, private filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(PER_PAGE),
      get_items: "1",
      get_stats: "0",
    });
    const fetched = await batFetch(`${FILTER_API}?${params}`);
    if (fetched.status >= 400) {
      throw new Error(`BaT listings-filter HTTP ${fetched.status}`);
    }

    let data: {
      items?: Array<{ id?: number | string; url?: string; title?: string }>;
      page_current?: number;
      pages_total?: number;
      items_total?: number;
      items_per_page?: number;
    };
    try {
      data = JSON.parse(fetched.text) as typeof data;
    } catch {
      throw new Error("BaT listings-filter returned non-JSON");
    }

    const seen = new Set<string>();
    const listings: ListingReference[] = [];
    for (const item of data.items ?? []) {
      const url = typeof item.url === "string" ? item.url : undefined;
      if (!url) continue;
      const sourceId = slugFromUrl(url, String(item.id ?? ""));
      if (!sourceId || seen.has(sourceId)) continue;
      seen.add(sourceId);
      listings.push({ sourceId, url: url.endsWith("/") ? url : `${url}/` });
    }

    const currentPage = data.page_current ?? page;
    const totalPages = data.pages_total;
    const hasMore =
      listings.length > 0 &&
      (totalPages != null ? currentPage < totalPages : listings.length >= PER_PAGE);

    return {
      listings,
      pagination: {
        currentPage,
        totalPages,
        hasMore,
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await batFetch(url);
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const $ = load(fetched.html ?? "");
    const slug = fetched.url.match(/\/listing\/([a-z0-9-]+)/)?.[1] ?? "unknown";

    const title =
      $("h1.post-title").first().text().replace(/\s+/g, " ").trim() ||
      $("h1").first().text().replace(/\s+/g, " ").trim() ||
      $("title").text().replace(/ - Bring a Trailer.*$/, "").trim();

    const vin = normalizeVin(findVinInText(fetched.html ?? ""));

    const postExcerpt = $(".post-excerpt").first().text().replace(/\s+/g, " ");

    const mileage = extractBatMileage($, title);

    const statsText = $(".listing-stats, #listing-bid").text().replace(/\s+/g, " ");
    const soldMatch = statsText.match(/(?:Winning Bid|Sold for|Final Bid|Bid to)\s*(?:USD\s*)?\$([\d,]+)/i);
    const highBidMatch = statsText.match(/(?:High Bid)\s*(?:USD\s*)?\$([\d,]+)/i);
    const price = soldMatch
      ? Number(soldMatch[1].replace(/,/g, ""))
      : highBidMatch
        ? Number(highBidMatch[1].replace(/,/g, ""))
        : undefined;

    const sold = /winning bid|sold for/i.test(statsText);
    const reserveNotMet = /reserve not met/i.test(statsText);

    const yearMatch = title.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? Number(yearMatch[0]) : undefined;
    const titleParts = title.split(/\s+/);
    const yearIdx = yearMatch ? titleParts.indexOf(yearMatch[0]) : -1;
    const make = yearIdx >= 0 ? titleParts[yearIdx + 1] : titleParts[0];
    const model = yearIdx >= 0 ? titleParts.slice(yearIdx + 2).join(" ") : titleParts.slice(1).join(" ");

    const engineMatch = postExcerpt.match(/(\d+\.\d+[- ]?[Ll]iter)\s+(\w+)/);
    const transmissionMatch = postExcerpt.match(/(manual|automatic|dual[- ]clutch|CVT|sequential)/i);
    const driveMatch = postExcerpt.match(/(front|rear|all)[- ]wheel[- ]drive/i);

    const vehicle = vehicleFromParts({
      vin,
      make,
      model,
      year,
      fuelType: postExcerpt.match(/(electric|hybrid|diesel)/i)?.[1],
      transmission: transmissionMatch?.[1],
      driveType: driveMatch?.[1],
      engineDisplacement: engineMatch?.[1]?.match(/([\d.]+)/)?.[1],
    });

    const photos = extractBatPhotos(fetched.html ?? "");

    const location = $(".listing-location").text().trim() || undefined;

    return usMiListing({
      sourceId: slug,
      sourceUrl: fetched.url,
      title,
      price,
      mileage,
      location,
      sold: sold && !reserveNotMet,
      vehicle,
      photos,
    });
  }

  async normalizeVehicle(listing: NormalizedListing): Promise<NormalizedVehicle> {
    return listing.vehicle ?? {};
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin ? normalizeVin(listing.vehicle.vin) : undefined;
  }

  extractPhotos(listing: NormalizedListing): NormalizedPhoto[] {
    return listing.photos ?? [];
  }
}
