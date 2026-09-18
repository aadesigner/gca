/**
 * Japanese Used Cars (japaneseusedcars.com / Autospecs).
 * Public fixed-price WordPress catalogs. Chassis numbers are usually masked (****);
 * only unmasked chassis persist to VIN history.
 */
import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  PaginationInfo,
} from "@workspace/providers";
import { JAPAN } from "../geo";
import {
  normalizeJpChassis,
  parseYear,
  resolveHistoryVehicleId,
  vehicleFromParts,
} from "./kr-common";
import { extraSpecEvent } from "./title-enrichment";
import { moneyListing } from "./us-common";
import { asPhotos, fetchHtml, firstRegEvent, num } from "./web-html";

export const JAPANESEUSEDCARS_PARSER_VERSION = "japaneseusedcars-v1.0.0";
const BASE = "https://japaneseusedcars.com";

const CATALOG_PATHS = [
  "/japan-domestic-dealer-cars-at-a-fixed-price/",
  "/low-cost-fixed-price-cars/",
  "/preauction-cars-at-a-fixed-price/",
] as const;

const JUC_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${BASE}/`,
};

export function japaneseusedcarsDetailUrl(idOrUrl: string): string {
  const raw = String(idOrUrl ?? "").trim();
  if (!raw) return BASE;
  if (/^https?:\/\//i.test(raw)) return raw.split("#")[0]!;
  if (raw.startsWith("/")) return `${BASE}${raw}`;
  return `${BASE}/vehicle/${raw}/`;
}

function infoValue(html: string, label: string): string | undefined {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `info-heading[^>]*>\\s*${escaped}\\s*<\\/p>\\s*<p[^>]*class=["']info-value["'][^>]*>\\s*([^<]+)`,
    "i",
  );
  const m = html.match(re);
  const val = m?.[1]?.replace(/\s+/g, " ").trim();
  if (!val || /^unknown$/i.test(val)) return undefined;
  return val;
}

function extractChassis(html: string): string | undefined {
  const raw =
    infoValue(html, "Chassis") ??
    html.match(/>\s*Chassis\s*<[\s\S]{0,120}?>([A-HJ-NPR-Z0-9*]{8,24})</i)?.[1] ??
    html.match(/Chassis[^A-HJ-NPR-Z0-9*]{0,40}([A-HJ-NPR-Z0-9*]{8,24})/i)?.[1];
  if (!raw || /\*/.test(raw)) return undefined;
  return resolveHistoryVehicleId(raw) ?? normalizeJpChassis(raw);
}

/** AJES CDN thumbs in document order; strip size query for a stable larger URL when possible. */
export function collectJucPhotos(html: string, max = 40): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const match of html.matchAll(/https?:\/\/(?:\d+\.)?ajes\.com\/[^"'\\\s>]+/gi)) {
    let url = match[0]!;
    // Prefer wider renders when the query allows.
    if (/[?&]w=\d+/i.test(url)) {
      url = url.replace(/([?&]w=)\d+/i, "$11200");
    }
    const key = url.split("?")[0]!.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url);
    if (out.length >= max) break;
  }
  return out;
}

function parseTitle(html: string): { title?: string; make?: string; model?: string; trim?: string } {
  const h =
    html
      .match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
      ?.replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim() ||
    html
      .match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1]
      ?.replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  if (!h) return {};
  const trimMatch = h.match(/\(([^)]+)\)\s*$/);
  const trim = trimMatch?.[1]?.replace(/\s+/g, " ").trim();
  const base = h.replace(/\([^)]+\)\s*$/, "").replace(/\s+/g, " ").trim();
  const parts = base.split(/\s+/).filter(Boolean);
  const make = parts[0];
  const model = parts.slice(1).join(" ") || undefined;
  return { title: h.replace(/\s+/g, " ").trim(), make, model, trim };
}

export class JapaneseusedcarsHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "japaneseusedcars";
  constructor(
    private _baseUrl?: string,
    private _filters: Record<string, unknown> = {},
  ) {}

  async discoverListings(
    page: number,
  ): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const p = Math.max(1, page);
    const path = CATALOG_PATHS[(p - 1) % CATALOG_PATHS.length]!;
    const cycle = Math.floor((p - 1) / CATALOG_PATHS.length) + 1;
    // Fixed-price pages are single-shot catalogs (no ?page=); after one pass per path, stop.
    if (cycle > 1) {
      return { listings: [], pagination: { currentPage: p, hasMore: false } };
    }

    const fetched = await fetchHtml(`${BASE}${path}`, JUC_HEADERS);
    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const match of fetched.text.matchAll(/href="(\/vehicle\/([A-Za-z0-9]+)[^"]*)"/gi)) {
      const href = match[1]!;
      const id = match[2]!;
      if (seen.has(id)) continue;
      seen.add(id);
      const url = `${BASE}${href.split("#")[0]}`;
      listings.push({ sourceId: id, url });
    }

    return {
      listings,
      pagination: {
        currentPage: p,
        hasMore: p < CATALOG_PATHS.length,
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const detailUrl = japaneseusedcarsDetailUrl(url);
    const fetched = await fetchHtml(detailUrl, JUC_HEADERS);
    return {
      url: fetched.finalUrl,
      html: fetched.text,
      statusCode: fetched.status,
      headers: {},
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const sourceId =
      fetched.url.match(/\/vehicle\/([A-Za-z0-9]+)/i)?.[1] ??
      "unknown";

    const vin = extractChassis(html);
    const { title, make, model, trim } = parseTitle(html);
    const year =
      parseYear(infoValue(html, "manufactured")) ??
      parseYear(title) ??
      parseYear(html.match(/\b((?:19|20)\d{2})\b/)?.[1]);
    const mileage = num(infoValue(html, "Mileage")?.replace(/[^\d]/g, ""));
    const price = num(html.match(/US\$\s*([\d,]+)/i)?.[1]);
    const fuelType = infoValue(html, "Fuel");
    const transmission = infoValue(html, "AT/MT");
    const engine = infoValue(html, "cubic capacity");
    const steering = infoValue(html, "Hand driving");

    // Detail pages often omit AJES imgs — also accept any same-page car photos.
    const photoUrls = collectJucPhotos(html);
    const photos = vin ? asPhotos(photoUrls, 40) : [];

    const events = [
      firstRegEvent(year),
      extraSpecEvent("japaneseusedcars", "steering", "Steering", steering),
      extraSpecEvent("japaneseusedcars", "auction_no", "Auction No", sourceId),
    ].filter((e): e is NonNullable<typeof e> => Boolean(e));

    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title: title ?? [year, make, model].filter(Boolean).join(" "),
      price,
      currency: "USD",
      mileage: mileage && mileage > 0 ? mileage : undefined,
      mileageUnit: "km",
      location: JAPAN,
      country: JAPAN,
      vehicle: vehicleFromParts({
        vin,
        year,
        make,
        model,
        trim,
        fuelType,
        transmission,
        engineDisplacement: engine,
        country: JAPAN,
      }),
      photos,
      events: events.length ? events : undefined,
    });
  }
}
