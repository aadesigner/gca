import { load } from "cheerio";
import type { FetchedListing, ListingReference, NormalizedListing } from "@workspace/providers";
import { KrHtmlAdapter, type KrDiscoverResult } from "./kr-adapter";
import { krFetch } from "./kr-http";
import {
  collectImgs,
  findVinInText,
  normalizeKrVin,
  parseKm,
  parseMoney,
  parseYear,
  specFromTable,
  usdListing,
  vehicleFromParts,
} from "./kr-common";

export const SEOBUK_PARSER_VERSION = "seobuk-v1.1.0";
export const SEOBUK_WEB_BASE = "https://www.seobuk.org";

export function seobukDetailUrl(id: string): string {
  return `${SEOBUK_WEB_BASE}/search/detail/${id}`;
}

export class SeobukHistoricalAdapter extends KrHtmlAdapter {
  readonly internalName = "seobuk";

  async discoverListings(page: number): Promise<KrDiscoverResult> {
    const url =
      `${SEOBUK_WEB_BASE}/search/model/all/${page}` +
      `?order=&ascending=desc&view=image&customSelect=24&country=all&tab=model`;
    const fetched = await krFetch(url, { referer: `${SEOBUK_WEB_BASE}/search/model/all` });
    const $ = load(fetched.text);
    const seen = new Set<string>();
    const listings: ListingReference[] = [];
    $('a[href*="/search/detail/"]').each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const id = href.match(/\/search\/detail\/([A-F0-9]{32})/i)?.[1]?.toUpperCase();
      if (!id || seen.has(id)) return;
      seen.add(id);
      listings.push({ sourceId: id, url: seobukDetailUrl(id) });
    });
    const pagerPages = [...fetched.text.matchAll(/\/search\/model\/all\/(\d+)/g)]
      .map((m) => Number(m[1]))
      .filter((n) => Number.isFinite(n) && n > 0);
    const totalPages = Math.max(page, ...pagerPages, listings.length >= 24 ? page + 1 : page);
    return {
      listings,
      pagination: {
        currentPage: page,
        totalPages,
        hasMore: listings.length >= 24 || (listings.length > 0 && page < totalPages),
      },
    };
  }

  protected extractSourceId(url: string): string | undefined {
    return url.match(/\/search\/detail\/([A-F0-9]{32})/i)?.[1]?.toUpperCase();
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const $ = load(fetched.html ?? "");
    const sourceId =
      $("#car-no").attr("data-car-no")?.toUpperCase() ||
      this.extractSourceId(fetched.url) ||
      "unknown";
    const title = $("title").first().text().replace(/\s+/g, " ").trim() || $(".car_name p").first().text().trim();
    const make = title.match(/\[([^\]]+)\]/)?.[1]?.trim();
    const model = specFromTable($, "Model name") || $("#car-name").text().trim();
    const year = parseYear(specFromTable($, "Vehicle year"));
    const mileage = parseKm(specFromTable($, "Mileage"));
    const price = parseMoney($(".car_price .representativeColor").first().text());
    const vin = normalizeKrVin(specFromTable($, "Vehicle identification number")) || findVinInText(fetched.html ?? "");
    const plate = $("#car-no").attr("data-car-plate-number") || specFromTable($, "The car's number");
    const vehicle = vehicleFromParts({
      vin,
      make,
      model,
      year,
      fuelType: specFromTable($, "Fuel"),
      transmission: specFromTable($, "Transmission"),
      color: specFromTable($, "Color"),
    });
    const mainImg = $("#main_img").attr("value");
    return usdListing({
      sourceId,
      sourceUrl: seobukDetailUrl(sourceId),
      title,
      price,
      mileage,
      location: plate,
      vehicle,
      photos: collectImgs($, SEOBUK_WEB_BASE, mainImg ? [mainImg] : []),
    });
  }
}
