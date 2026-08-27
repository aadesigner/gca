import { load } from "cheerio";
import type { FetchedListing, ListingReference, NormalizedListing, NormalizedPhoto } from "@workspace/providers";
import { KrHtmlAdapter, type KrDiscoverResult } from "./kr-adapter";
import { krFetch } from "./kr-http";
import {
  findVinInText,
  normalizeKrVin,
  pagerMax,
  parseKm,
  parseMoney,
  parseYear,
  specFromTable,
  usdListing,
  vehicleFromParts,
} from "./kr-common";

export const CARPOOLKR_PARSER_VERSION = "carpoolkr-v1.2.0";
export const CARPOOLKR_WEB_BASE = "https://www.carpoolkr.com";

export function carpoolDetailUrl(id: string, slug = ""): string {
  const path = slug ? `/Cars/Show/${id}/${slug}` : `/Cars/Show/${id}`;
  return `${CARPOOLKR_WEB_BASE}${path}`;
}

function absCarpoolHref(href: string): string {
  try {
    return new URL(href, CARPOOLKR_WEB_BASE).toString().split("#")[0]!;
  } catch {
    return `${CARPOOLKR_WEB_BASE}${href.startsWith("/") ? "" : "/"}${href}`;
  }
}

/** Spec cells put the value in a following <th><label>…</label></th>, not a sibling <td>. */
function extractCarpoolMileage(html: string, $: ReturnType<typeof load>): number | undefined {
  const fromLabel =
    html.match(
      /Odometer(?:\s*Reading)?\s*:?<\/[^>]+>[\s\S]{0,280}?<label>\s*([\d,]+)\s*<\/label>/i,
    )?.[1] ??
    html.match(
      /class="title_spec">\s*Odometer(?:\s*Reading)?\s*:[\s\S]{0,280}?<label>\s*([\d,]+)\s*<\/label>/i,
    )?.[1];
  const fromTach = html.match(/fa-tachometer[\s\S]{0,80}?([\d,]+)\s*K\.?M\.?\b/i)?.[1];
  const candidates = [
    parseKm(fromLabel),
    parseKm(fromTach),
    parseKm(specFromTable($, "Odometer Reading")),
    parseKm(specFromTable($, "Odometer")),
    parseKm(specFromTable($, "Mileage")),
  ];
  for (const n of candidates) {
    if (n != null && n > 1) return n;
  }
  return undefined;
}

/**
 * Real listing photos live under /assets/car/cars/ (img.carpoolkr.com).
 * /make/ and /type/ are brand/body icons used site-wide — never store those.
 */
function extractCarpoolPhotos(html: string): NormalizedPhoto[] {
  const seen = new Set<string>();
  const cars: string[] = [];
  const thumbs: string[] = [];

  const push = (raw: string) => {
    let url = raw.replace(/&amp;/g, "&").split("#")[0]!.split("?")[0]!;
    if (url.startsWith("//")) url = `https:${url}`;
    if (!/^https?:\/\//i.test(url)) return;
    if (!/(?:img|media)\.carpoolkr\.com\/assets\/car\/(?:cars|thumbnail)\//i.test(url)) return;
    if (/\/make\/|\/type\//i.test(url)) return;
    if (seen.has(url)) return;
    seen.add(url);
    if (/\/cars\//i.test(url)) cars.push(url);
    else thumbs.push(url);
  };

  for (const m of html.matchAll(
    /https?:\/\/(?:img|media)\.carpoolkr\.com\/assets\/car\/(?:cars|thumbnail)\/[^"'\\\s>]+/gi,
  )) {
    push(m[0]!);
  }

  const urls = (cars.length > 0 ? cars : thumbs).slice(0, 40);
  return urls.map((sourceUrl, index) => ({
    sourceUrl,
    isPrimary: index === 0,
    sortOrder: index,
  }));
}

export class CarpoolkrHistoricalAdapter extends KrHtmlAdapter {
  readonly internalName = "carpoolkr";

  async discoverListings(page: number): Promise<KrDiscoverResult> {
    const url = `${CARPOOLKR_WEB_BASE}/Search?type=Car&vehicle=Car&Submit=Submit&page=${page}`;
    const fetched = await krFetch(url, { referer: `${CARPOOLKR_WEB_BASE}/Search?type=Car` });
    const $ = load(fetched.text);
    const seen = new Set<string>();
    const listings: ListingReference[] = [];
    $('a[href*="/Cars/Show/"]').each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const match = href.match(/\/Cars\/Show\/(CAR\d+)(?:\/([^"?#]*))?/i);
      if (!match) return;
      const id = match[1]!.toUpperCase();
      if (seen.has(id)) return;
      seen.add(id);
      listings.push({
        sourceId: id,
        url: absCarpoolHref(href.split("?")[0]!),
      });
    });
    const lastPage = pagerMax(fetched.text, "page", page);
    return {
      listings,
      pagination: { currentPage: page, totalPages: lastPage, hasMore: listings.length > 0 && page < lastPage },
    };
  }

  protected extractSourceId(url: string): string | undefined {
    return url.match(/\/Cars\/Show\/(CAR\d+)/i)?.[1]?.toUpperCase();
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const $ = load(html);
    const sourceId = this.extractSourceId(fetched.url) || specFromTable($, "Item No") || "unknown";
    const vin = normalizeKrVin(specFromTable($, "VIN")) || findVinInText(html);
    const make = specFromTable($, "Maker");
    const model = specFromTable($, "Model");
    const trim = specFromTable($, "M Detail") || specFromTable($, "Grade");
    const year = parseYear(specFromTable($, "Year"));
    const mileage = extractCarpoolMileage(html, $);
    const price =
      parseMoney($(".price, .car-price, h3:contains($)").first().text()) ||
      parseMoney($("p.price").first().text());
    const sold = /sold\s*out/i.test($("body").text().slice(0, 4000)) || /class="new-price">\s*Sold/i.test(html);
    const vehicle = vehicleFromParts({
      vin,
      make,
      model,
      trim,
      year,
      fuelType: specFromTable($, "Fuel Type"),
      transmission: specFromTable($, "Transmission"),
      driveType: specFromTable($, "D Type") || specFromTable($, "Drive Type"),
      bodyType: specFromTable($, "Vehicle Type"),
      color: specFromTable($, "Color") || specFromTable($, "Exterior Color"),
      engineDisplacement: specFromTable($, "Eng Volume") || specFromTable($, "Engine Volume"),
    });
    const title = $("h1, h2, title").first().text().replace(/\s+/g, " ").trim();
    return usdListing({
      sourceId,
      sourceUrl: fetched.url,
      title,
      price,
      mileage,
      sold,
      vehicle,
      photos: extractCarpoolPhotos(html),
    });
  }
}
