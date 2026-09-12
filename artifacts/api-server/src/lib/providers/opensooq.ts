import { load } from "cheerio";
import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  PaginationInfo,
} from "@workspace/providers";
import { UNITED_ARAB_EMIRATES } from "../geo";
import { normalizeEuFuel, normalizeEuTransmission } from "./eu-locale";
import { findVinInListing, findVinInText, parseYear, vehicleFromParts } from "./kr-common";
import { moneyListing } from "./us-common";
import { asPhotos, collectHttpImages, fetchHtml, firstRegEvent, num } from "./web-html";

export const OPENSOOQ_PARSER_VERSION = "opensooq-v1.0.0";
const BASE = "https://ae.opensooq.com";
const SEARCH = `${BASE}/en/cars`;

export function opensooqDetailUrl(id: string): string {
  if (id.startsWith("http")) return id;
  if (id.startsWith("/")) return `${BASE}${id}`;
  return `${BASE}/en/search/${id}`;
}

function collectOpensooqPhotos(html: string): string[] {
  const urls = collectHttpImages(html, "opensooq-images", 50);
  if (urls.length) return urls;
  return collectHttpImages(html, "os-cdn.com", 40);
}

function ldVehicles(html: string): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const json = JSON.parse(match[1]!);
      const stack = Array.isArray(json) ? json : [json];
      for (const node of stack) {
        if (!node || typeof node !== "object") continue;
        const rec = node as Record<string, unknown>;
        if (rec["@type"] === "ItemList" && Array.isArray(rec.itemListElement)) {
          for (const el of rec.itemListElement) {
            const item = (el as { item?: unknown })?.item;
            if (item && typeof item === "object") out.push(item as Record<string, unknown>);
          }
        }
        if (String(rec["@type"] ?? "").toLowerCase().includes("vehicle")) {
          out.push(rec);
        }
      }
    } catch {
      /* ignore bad ld+json */
    }
  }
  return out;
}

export class OpensooqHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "opensooq";
  constructor(
    private _baseUrl?: string,
    private _filters: Record<string, unknown> = {},
  ) {}

  async discoverListings(
    page: number,
  ): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const p = Math.max(1, page);
    const url = p <= 1 ? SEARCH : `${SEARCH}?page=${p}`;
    const fetched = await fetchHtml(url, {
      Referer: BASE,
      "Accept-Language": "en-US,en;q=0.9,ar;q=0.5",
    });
    const seen = new Set<string>();

    // Prefer LD+JSON Vehicle urls (often carry VIN in description).
    const vinFirst: ListingReference[] = [];
    const rest: ListingReference[] = [];
    for (const vehicle of ldVehicles(fetched.text)) {
      const href = String(vehicle.url ?? "");
      const id = href.match(/\/(?:en\/)?search\/(\d+)/)?.[1];
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const vin =
        findVinInListing(String(vehicle.description ?? ""), String(vehicle.name ?? "")) ??
        findVinInText(String(vehicle.description ?? ""));
      const row = {
        sourceId: id,
        url: opensooqDetailUrl(id),
        metadata: vin
          ? { vin, title: String(vehicle.name ?? "") }
          : { title: String(vehicle.name ?? "") },
      };
      if (vin) vinFirst.push(row);
      else rest.push(row);
    }

    for (const match of fetched.text.matchAll(/\/en\/search\/(\d+)/g)) {
      const id = match[1]!;
      if (seen.has(id)) continue;
      seen.add(id);
      rest.push({ sourceId: id, url: opensooqDetailUrl(id) });
    }

    const listings = [...vinFirst, ...rest];
    return {
      listings,
      pagination: { currentPage: p, hasMore: listings.length >= 30 },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url, {
      Referer: SEARCH,
      "Accept-Language": "en-US,en;q=0.9,ar;q=0.5",
    });
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const $ = load(html);
    const sourceId = fetched.url.match(/\/search\/(\d+)/)?.[1] ?? "unknown";

    const vehicles = ldVehicles(html);
    const self =
      vehicles.find((v) => String(v.url ?? "").includes(sourceId)) ?? vehicles[0] ?? {};

    const title =
      $("h1").first().text().replace(/\s+/g, " ").trim() ||
      String(self.name ?? "") ||
      $('meta[property="og:title"]').attr("content")?.replace(/\s+/g, " ").trim() ||
      $("title").text().replace(/\s*[-|].*$/, "").trim();

    const description = String(self.description ?? "") || $("meta[name='description']").attr("content") || "";
    const metaVin =
      typeof fetched.metadata === "object" && fetched.metadata
        ? String((fetched.metadata as { vin?: unknown }).vin ?? "")
        : "";
    // Prefer labeled VIN / LD+JSON — never unlabeled full-HTML scrape (placeholder VINs).
    const vin =
      (metaVin.length === 17 ? findVinInText(metaVin) : undefined) ??
      findVinInListing(description, title, html.replace(/placeholder\s*=\s*["'][^"']*["']/gi, "")) ??
      findVinInText(`${description}\n${title}`);

    const offers =
      self.offers && typeof self.offers === "object"
        ? (self.offers as Record<string, unknown>)
        : undefined;
    const price =
      num(offers?.price) ??
      num($('[itemprop="price"]').attr("content")) ??
      num($(".price").first().text().replace(/[^\d]/g, ""));

    const mileage =
      num(String(self.mileageFromOdometer ?? "").replace(/[^\d]/g, "")) ||
      num(description.match(/([\d,.\s]+)\s*(?:km|كم)/i)?.[1]?.replace(/[^\d]/g, "")) ||
      num(html.match(/([\d,]+)\s*km/i)?.[1]?.replace(/[^\d]/g, ""));

    const year =
      parseYear(String(self.vehicleModelDate ?? self.modelDate ?? "")) ||
      parseYear(title) ||
      parseYear(description);

    const brandRaw = self.brand;
    const brandName =
      typeof brandRaw === "object" && brandRaw
        ? String((brandRaw as { name?: unknown }).name ?? "")
        : String(brandRaw ?? self.manufacturer ?? "");
    const make = brandName.trim() || title.split(/\s+/)[0];
    const model =
      String(self.model ?? "").trim() ||
      title.split(/\s+/).slice(1).join(" ") ||
      undefined;

    const fuel = String(self.fuelType ?? "");
    const transmission = String(self.vehicleTransmission ?? "");
    const location =
      String(
        (offers?.areaServed as { address?: { addressLocality?: string } } | undefined)?.address
          ?.addressLocality ?? "",
      ) ||
      $(".location, .city").first().text().replace(/\s+/g, " ").trim() ||
      UNITED_ARAB_EMIRATES;

    const photos = vin ? asPhotos(collectOpensooqPhotos(html), 40) : [];
    const firstReg = firstRegEvent(String(self.dateVehicleFirstRegistered ?? ""));

    return moneyListing({
      sourceId,
      sourceUrl: opensooqDetailUrl(sourceId),
      title,
      price,
      currency: "AED",
      mileage: mileage || undefined,
      mileageUnit: "km",
      location: location || UNITED_ARAB_EMIRATES,
      country: UNITED_ARAB_EMIRATES,
      vehicle: vehicleFromParts({
        vin,
        make: make || undefined,
        model,
        year,
        fuelType: normalizeEuFuel(fuel),
        transmission: normalizeEuTransmission(transmission),
        country: UNITED_ARAB_EMIRATES,
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
