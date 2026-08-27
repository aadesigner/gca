import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  PaginationInfo,
} from "@workspace/providers";
import { USA, moneyListing } from "./us-common";
import { findVinInListing, parseYear, vehicleFromParts } from "./kr-common";
import { asPhotos, collectHttpImages, extractNextData, fetchHtml, firstRegEvent, num, str, asRecord, deepGet } from "./web-html";

export const CARSANDBIDS_PARSER_VERSION = "carsandbids-v1.0.0";
const BASE = "https://carsandbids.com";

export function carsandbidsDetailUrl(id: string): string {
  if (id.startsWith("http")) return id;
  if (id.startsWith("/")) return `${BASE}${id}`;
  return `${BASE}/auctions/${id}`;
}

export class CarsandbidsHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "carsandbids";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const fetched = await fetchHtml(`${BASE}/past-auctions/?page=${page}`);
    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const match of fetched.text.matchAll(/href="(\/auctions\/[a-z0-9-]+\/?)"/g)) {
      const path = match[1]!.replace(/\/$/, "");
      const id = path.replace("/auctions/", "");
      if (!id || seen.has(id) || id === "past" || id === "live") continue;
      seen.add(id);
      listings.push({ sourceId: id, url: `${BASE}${path}` });
    }
    return { listings, pagination: { currentPage: page, hasMore: listings.length >= 12 } };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url);
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const next = extractNextData(html);
    const auction = asRecord(deepGet(next, "props.pageProps.auction")) ?? asRecord(deepGet(next, "props.pageProps"));
    const sourceId = fetched.url.split("/auctions/")[1]?.replace(/\/$/, "") ?? "unknown";
    const title = str(auction?.title) ?? html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const vin = findVinInListing(str(auction?.vin), str(auction?.description), html);
    const mileage = num(auction?.mileage) ?? num(auction?.miles);
    const price = num(auction?.sold_price) ?? num(auction?.high_bid) ?? num(auction?.price);
    const sold = Boolean(auction?.sold ?? /sold/i.test(str(auction?.status) ?? ""));
    const photos = vin ? asPhotos(collectHttpImages(html, "carsandbids", 40)) : [];
    const firstReg = firstRegEvent(auction?.year);
    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title,
      price,
      currency: "USD",
      mileage,
      mileageUnit: "mi",
      location: USA,
      country: USA,
      sold,
      vehicle: vehicleFromParts({
        vin,
        make: str(auction?.make),
        model: str(auction?.model),
        year: num(auction?.year) ?? parseYear(title),
        country: USA,
      }),
      photos,
      events: firstReg ? [firstReg] : undefined,
    });
  }
}
