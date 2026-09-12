import { load } from "cheerio";
import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  PaginationInfo,
} from "@workspace/providers";
import { NORWAY } from "../geo";
import { normalizeEuFuel, normalizeEuTransmission } from "./eu-locale";
import { findVinInListing, findVinInText, parseYear, vehicleFromParts } from "./kr-common";
import { moneyListing } from "./us-common";
import { asPhotos, fetchHtml, firstRegEvent, num, str } from "./web-html";

export const FINN_PARSER_VERSION = "finn-v1.0.0";
const BASE = "https://www.finn.no";
const SEARCH = `${BASE}/mobility/search/car`;

export function finnDetailUrl(id: string): string {
  if (id.startsWith("http")) return id;
  if (id.startsWith("/")) return `${BASE}${id}`;
  return `${BASE}/mobility/item/${id}`;
}

function dtDd($: ReturnType<typeof load>, label: RegExp): string | undefined {
  let found: string | undefined;
  $("dt").each((_, el) => {
    if (found) return;
    const key = $(el).text().replace(/\s+/g, " ").trim();
    if (!label.test(key)) return;
    found = $(el).next("dd").text().replace(/\s+/g, " ").trim() || undefined;
  });
  return found;
}

/** Finn CDN URLs have no file extension — collect `/item/{id}/{uuid}` shots. */
export function collectFinnPhotos(html: string, sourceId: string): string[] {
  const best = new Map<string, { url: string; score: number }>();
  const normalized = html.replace(/\\u002F/g, "/").replace(/\\\//g, "/");
  const re =
    /https?:\/\/images\.finncdn\.no\/dynamic\/([^/"'\s]+)\/item\/(\d+)\/([a-f0-9-]{20,})/gi;
  for (const match of normalized.matchAll(re)) {
    const sizeToken = match[1] ?? "";
    const itemId = match[2] ?? "";
    const uuid = match[3] ?? "";
    if (sourceId && itemId !== sourceId) continue;
    if (/profile_placeholders/i.test(sizeToken)) continue;
    const score =
      sizeToken === "default"
        ? 2000
        : sizeToken.endsWith("w")
          ? Number(sizeToken.replace(/\D/g, "")) || 0
          : 100;
    const url = `https://images.finncdn.no/dynamic/1600w/item/${itemId}/${uuid}`;
    const prev = best.get(uuid);
    if (!prev || score > prev.score) best.set(uuid, { url, score });
  }
  if (best.size) return [...best.values()].sort((a, b) => b.score - a.score).map((r) => r.url);
  const og =
    normalized.match(/property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] ??
    normalized.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
  return og ? [og] : [];
}

export class FinnHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "finn";
  constructor(
    private _baseUrl?: string,
    private _filters: Record<string, unknown> = {},
  ) {}

  async discoverListings(
    page: number,
  ): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const p = Math.max(1, page);
    const fetched = await fetchHtml(`${SEARCH}?registration_class=1&page=${p}`, {
      Referer: `${BASE}/`,
    });
    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const match of fetched.text.matchAll(/\/mobility\/item\/(\d+)/g)) {
      const id = match[1]!;
      if (seen.has(id)) continue;
      seen.add(id);
      listings.push({ sourceId: id, url: finnDetailUrl(id) });
    }
    return {
      listings,
      pagination: { currentPage: p, hasMore: listings.length >= 40 },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url, { Referer: SEARCH });
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const $ = load(html);
    const sourceId =
      fetched.url.match(/\/mobility\/item\/(\d+)/)?.[1] ??
      fetched.url.match(/finnkode=(\d+)/i)?.[1] ??
      "unknown";

    const title =
      $("h1").first().text().replace(/\s+/g, " ").trim() ||
      $('meta[property="og:title"]').attr("content")?.replace(/\s+/g, " ").trim() ||
      $("title").text().replace(/\s*[-|].*$/, "").trim();

    const vin =
      findVinInListing(dtDd($, /chassis|understell|\bvin\b/i) ?? "", html, title) ??
      findVinInText(html);

    const mileageRaw =
      dtDd($, /mileage|kilometerstand|km\.?\s*stand/i) ??
      str(html.match(/"key"\s*:\s*"mileage"\s*,\s*"value"\s*:\s*\[\s*"?(\d+)/i)?.[1]);
    const mileage = num(String(mileageRaw ?? "").replace(/[^\d]/g, ""));

    const priceRaw =
      $('[data-testid="object-price"]').first().text() ||
      $('meta[property="product:price:amount"]').attr("content") ||
      str(html.match(/"key"\s*:\s*"price"\s*,\s*"value"\s*:\s*\[\s*"?(\d+)/i)?.[1]);
    const price = num(String(priceRaw ?? "").replace(/[^\d]/g, ""));

    const year =
      parseYear(dtDd($, /model year|årsmodell|^year$/i)) ??
      parseYear(str(html.match(/"key"\s*:\s*"year"\s*,\s*"value"\s*:\s*\[\s*"?(\d{4})/i)?.[1])) ??
      parseYear(title);

    const fuel = dtDd($, /fuel|drivstoff/i);
    const transmission = dtDd($, /gearbox|girkasse|transmission/i);
    const location =
      $('[data-testid="object-address"]').first().text().replace(/\s+/g, " ").trim() || NORWAY;

    const parts = title.split(/\s+/).filter(Boolean);
    const make = parts[0];
    const model = parts.slice(1).join(" ") || undefined;

    const photos = vin ? asPhotos(collectFinnPhotos(html, sourceId), 40) : [];
    const firstReg = firstRegEvent(dtDd($, /1\.\s*registration|førstegangsreg|first reg/i));

    return moneyListing({
      sourceId,
      sourceUrl: finnDetailUrl(sourceId),
      title,
      price,
      currency: "NOK",
      mileage,
      mileageUnit: "km",
      location: location || NORWAY,
      country: NORWAY,
      vehicle: vehicleFromParts({
        vin,
        make,
        model,
        year,
        fuelType: normalizeEuFuel(fuel),
        transmission: normalizeEuTransmission(transmission),
        country: NORWAY,
      }),
      photos,
      events: firstReg ? [firstReg] : undefined,
    });
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin;
  }

  extractPhotos(listing: NormalizedListing) {
    return listing.photos ?? [];
  }
}
