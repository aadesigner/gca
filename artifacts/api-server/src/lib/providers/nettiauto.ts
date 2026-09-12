import { load } from "cheerio";
import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  PaginationInfo,
} from "@workspace/providers";
import { FINLAND } from "../geo";
import { normalizeEuFuel, normalizeEuTransmission } from "./eu-locale";
import { findVinInListing, findVinInText, parseYear, vehicleFromParts } from "./kr-common";
import { moneyListing } from "./us-common";
import { asPhotos, collectHttpImages, fetchHtml, firstRegEvent, num } from "./web-html";

export const NETTIAUTO_PARSER_VERSION = "nettiauto-v1.0.0";
const BASE = "https://www.nettiauto.com";
const SEARCH = `${BASE}/vaihtoautot`;

export function nettiautoDetailUrl(pathOrId: string): string {
  if (pathOrId.startsWith("http")) return pathOrId;
  if (pathOrId.startsWith("/")) return `${BASE}${pathOrId}`;
  // Numeric id alone is not enough for a canonical path — callers should pass sourceUrl.
  if (/^\d+$/.test(pathOrId)) return `${BASE}/id/${pathOrId}`;
  return `${BASE}/${pathOrId}`;
}

function dtLike($: ReturnType<typeof load>, label: RegExp): string | undefined {
  let found: string | undefined;
  $("th, dt, .dt, .info-label, .listing-info dt, td").each((_, el) => {
    if (found) return;
    const key = $(el).text().replace(/\s+/g, " ").trim();
    if (!label.test(key)) return;
    const tag = (el.tagName ?? "").toLowerCase();
    if (tag === "dt") {
      found = $(el).next("dd").text().replace(/\s+/g, " ").trim();
      return;
    }
    if (tag === "th") {
      found = $(el).next("td").text().replace(/\s+/g, " ").trim();
      return;
    }
    found =
      $(el).parent().find("dd, .dd, .info-value, strong").first().text().replace(/\s+/g, " ").trim() ||
      undefined;
  });
  // Labeled "VIN … VALUE" in plain blocks
  if (!found) {
    const body = $.root().text().replace(/\s+/g, " ");
    const m = body.match(new RegExp(`${label.source}[^A-HJ-NPR-Z0-9]{0,40}([A-HJ-NPR-Z0-9]{17})`, "i"));
    if (m?.[1]) found = m[1];
  }
  return found || undefined;
}

function collectNettiautoPhotos(html: string): string[] {
  const preferred = collectHttpImages(html, "nettiauto", 50);
  if (preferred.length) return preferred;
  return collectHttpImages(html, "ndn.fi", 40).concat(collectHttpImages(html, "images", 20));
}

export class NettiautoHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "nettiauto";
  constructor(
    private _baseUrl?: string,
    private _filters: Record<string, unknown> = {},
  ) {}

  async discoverListings(
    page: number,
  ): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const p = Math.max(1, page);
    // Use ?page=N — ?pageId=N triggers SSO refresh loops.
    const url = p <= 1 ? SEARCH : `${SEARCH}?page=${p}`;
    const fetched = await fetchHtml(url, {
      Referer: BASE,
      "Accept-Language": "fi-FI,fi;q=0.9,en;q=0.8",
    });
    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const match of fetched.text.matchAll(/href="(\/[a-z0-9-]+\/[a-z0-9-]+\/(\d{6,}))"/gi)) {
      const path = match[1]!;
      const id = match[2]!;
      if (seen.has(id)) continue;
      // Skip non-vehicle chrome paths
      if (/^\/(sso|static|assets|info|help)\b/i.test(path)) continue;
      seen.add(id);
      listings.push({ sourceId: id, url: nettiautoDetailUrl(path) });
    }
    return {
      listings,
      pagination: { currentPage: p, hasMore: listings.length >= 25 },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url, {
      Referer: SEARCH,
      "Accept-Language": "en-US,en;q=0.9,fi;q=0.8",
    });
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const $ = load(html);
    const sourceId = fetched.url.match(/\/(\d{6,})(?:\?|$)/)?.[1] ?? "unknown";

    const title =
      $("h1").first().text().replace(/\s+/g, " ").trim() ||
      $('meta[property="og:title"]').attr("content")?.replace(/\s+/g, " ").trim() ||
      $("title").text().replace(/\s*[-|].*$/, "").trim();

    const vinLabeled = dtLike($, /\bvin\b|alustanumero|chassis/i);
    const vin =
      findVinInListing(vinLabeled ?? "", html, title) ??
      (vinLabeled && vinLabeled.length === 17 ? findVinInText(vinLabeled) : undefined) ??
      findVinInText(html);

    const mileageRaw =
      dtLike($, /mileage|mittarilukema|km/i) ??
      html.match(/"mileage"\s*:\s*"?(\d+)/i)?.[1] ??
      html.match(/([\d\s]{2,9})\s*km\b/i)?.[1];
    const mileage = num(String(mileageRaw ?? "").replace(/[^\d]/g, ""));

    const priceRaw =
      $('[itemprop="price"], .price, .OfferPrice').first().attr("content") ||
      $('[itemprop="price"], .price, .OfferPrice').first().text() ||
      html.match(/"price"\s*:\s*(\d+)/i)?.[1];
    const price = num(String(priceRaw ?? "").replace(/[^\d]/g, ""));

    const year = parseYear(dtLike($, /year|vuosimalli|model year/i)) ?? parseYear(title);
    const fuel = dtLike($, /fuel|käyttövoima|drivmedel/i);
    const transmission = dtLike($, /transmission|vaihteisto|gearbox/i);
    const location =
      $('[itemprop="address"], .seller-location, .location').first().text().replace(/\s+/g, " ").trim() ||
      FINLAND;

    const pathParts = fetched.url.replace(BASE, "").split("/").filter(Boolean);
    const make = pathParts[0] ? pathParts[0].replace(/-/g, " ") : title.split(/\s+/)[0];
    const model =
      pathParts[1] && !/^\d+$/.test(pathParts[1])
        ? pathParts[1].replace(/-/g, " ")
        : title.split(/\s+/).slice(1).join(" ") || undefined;

    const photos = vin ? asPhotos(collectNettiautoPhotos(html), 40) : [];
    const firstReg = firstRegEvent(dtLike($, /first registration|ensirekisteröinti|1\.\s*reg/i));

    return moneyListing({
      sourceId,
      sourceUrl: fetched.url.startsWith("http") ? fetched.url : nettiautoDetailUrl(fetched.url),
      title,
      price,
      currency: "EUR",
      mileage,
      mileageUnit: "km",
      location: location || FINLAND,
      country: FINLAND,
      vehicle: vehicleFromParts({
        vin,
        make: make ? make.charAt(0).toUpperCase() + make.slice(1) : undefined,
        model: model ? model.charAt(0).toUpperCase() + model.slice(1) : undefined,
        year,
        fuelType: normalizeEuFuel(fuel),
        transmission: normalizeEuTransmission(transmission),
        country: FINLAND,
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
