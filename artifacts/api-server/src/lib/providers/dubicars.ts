import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  PaginationInfo,
} from "@workspace/providers";
import { UNITED_ARAB_EMIRATES } from "../geo";
import { findVinInListing, parseYear, vehicleFromParts } from "./kr-common";
import { moneyListing } from "./us-common";
import { asPhotos, collectHttpImages, fetchHtml, firstRegEvent, num } from "./web-html";

export const DUBICARS_PARSER_VERSION = "dubicars-v1.1.0";
const BASE = "https://www.dubicars.com";

/** Gallery shots only — ignore Mailchimp icons and other third-party chrome. */
function collectDubicarsGallery(html: string): string[] {
  const best = new Map<string, { url: string; score: number }>();
  const re =
    /(?:https?:)?\/\/(?:www\.)?dubicars\.com\/images\/[a-f0-9]+\/(?:w_)?(\d+)x(\d+)\/([^"'\\\s>]+\.(?:jpe?g|webp|png))/gi;
  for (const match of html.matchAll(re)) {
    const url = match[0]!.startsWith("http") ? match[0]! : `https:${match[0]!}`;
    const score = Number(match[1]) * Number(match[2]);
    const id = match[3]!.toLowerCase();
    const prev = best.get(id);
    if (!prev || score > prev.score) best.set(id, { url, score });
  }
  if (best.size > 0) {
    return [...best.values()]
      .sort((a, b) => b.score - a.score)
      .map((row) => row.url);
  }
  // Fallback: same-host only (shared filter drops junk CDNs).
  return collectHttpImages(html, "dubicars.com", 40);
}

export function dubicarsDetailUrl(id: string): string {
  if (id.startsWith("http")) return id;
  if (id.startsWith("/")) return `${BASE}${id}`;
  return `${BASE}/${id}.html`;
}

export class DubicarsHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "dubicars";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const fetched = await fetchHtml(`${BASE}/uae/used-cars?page=${page}`);
    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const match of fetched.text.matchAll(/href="(https:\/\/www\.dubicars\.com\/\d{4}-[^"]+\.html)"/g)) {
      const url = match[1]!;
      const slug = url.replace(BASE + "/", "").replace(/\.html$/, "");
      if (seen.has(slug)) continue;
      seen.add(slug);
      listings.push({ sourceId: slug, url });
    }
    if (!listings.length) {
      for (const match of fetched.text.matchAll(/href="(\/\d{4}-[a-z0-9-]+\.html)"/g)) {
        const path = match[1]!;
        const slug = path.replace(/^\//, "").replace(/\.html$/, "");
        if (seen.has(slug)) continue;
        seen.add(slug);
        listings.push({ sourceId: slug, url: `${BASE}${path}` });
      }
    }
    return { listings, pagination: { currentPage: page, hasMore: listings.length >= 12 } };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url);
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const slug = fetched.url.replace(/\.html.*/, "").split("/").pop() ?? "unknown";
    const descMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);
    const jsonLd = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((m) => m[1]!);
    const vin = findVinInListing(html, ...jsonLd, descMatch?.[1]);
    const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const year = parseYear(slug) ?? parseYear(title);
    const km = html.match(/([\d,]+)\s*(?:km|kilometers)/i);
    const price = html.match(/(?:AED|Dhs)\s*([\d,]+)/i);
    const photos = vin ? asPhotos(collectDubicarsGallery(html)) : [];
    const firstReg = firstRegEvent(html.match(/year[^0-9]{0,12}((?:19|20)\d{2})/i)?.[1]);
    return moneyListing({
      sourceId: slug,
      sourceUrl: fetched.url,
      title,
      price: price ? num(price[1]) : undefined,
      currency: "AED",
      mileage: km ? num(km[1]) : undefined,
      mileageUnit: "km",
      location: UNITED_ARAB_EMIRATES,
      country: UNITED_ARAB_EMIRATES,
      vehicle: vehicleFromParts({
        vin,
        year,
        make: title?.split(" ")[1],
        model: title?.split(" ").slice(2, 4).join(" "),
        country: UNITED_ARAB_EMIRATES,
      }),
      photos,
      events: firstReg ? [firstReg] : undefined,
    });
  }
}
