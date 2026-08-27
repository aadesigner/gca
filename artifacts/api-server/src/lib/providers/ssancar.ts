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

export const SSANCAR_PARSER_VERSION = "ssancar-v1.1.0";
export const SSANCAR_WEB_BASE = "https://www.ssancar.com";

export function ssancarDetailUrl(id: string): string {
  return `${SSANCAR_WEB_BASE}/page/stock_car_view.php?c_no=${id}`;
}

export class SsancarHistoricalAdapter extends KrHtmlAdapter {
  readonly internalName = "ssancar";

  async discoverListings(page: number): Promise<KrDiscoverResult> {
    await krFetch(`${SSANCAR_WEB_BASE}/page/stock_list.php`, { referer: SSANCAR_WEB_BASE });
    const body = new URLSearchParams({
      maker: "",
      model: "",
      gearbox: "",
      fuel: "",
      color: "",
      yearFrom: "",
      yearTo: "",
      priceFrom: "",
      priceTo: "",
      millageFrom: "",
      millageTo: "",
      list: "15",
      pages: String(Math.max(1, page)),
      page: String(Math.max(1, page)),
      no: "",
      sorts: "",
      isSoldout: "",
      idmatch: "1",
    });
    let html = "";
    try {
      const ajax = await krFetch(`${SSANCAR_WEB_BASE}/page/ajax_car_list.php`, {
        method: "POST",
        body,
        referer: `${SSANCAR_WEB_BASE}/page/stock_list.php`,
      });
      html = ajax.text;
    } catch {
      const fallback = await krFetch(`${SSANCAR_WEB_BASE}/page/stock_list.php?page=${page}`, { referer: SSANCAR_WEB_BASE });
      html = fallback.text;
    }
    const seen = new Set<string>();
    const listings: ListingReference[] = [];
    for (const match of html.matchAll(/stock_car_view\.php\?c_no=(\d+)/g)) {
      const id = match[1]!;
      if (seen.has(id)) continue;
      seen.add(id);
      listings.push({ sourceId: id, url: ssancarDetailUrl(id) });
    }
    return {
      listings,
      pagination: { currentPage: page, hasMore: listings.length >= 15 },
    };
  }

  protected extractSourceId(url: string): string | undefined {
    return url.match(/c_no=(\d+)/i)?.[1];
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const $ = load(fetched.html ?? "");
    const sourceId = this.extractSourceId(fetched.url) || "unknown";
    const title = $("h1, h2, title").first().text().replace(/\s+/g, " ").trim();
    const vin = normalizeKrVin(specFromTable($, "VIN")) || findVinInText(fetched.html ?? "");
    const price =
      parseMoney($('[itemprop="price"]').attr("content")) ||
      parseMoney(fetched.html?.match(/\$[\s]*[\d,]+/)?.[0]) ||
      parseMoney($(".price, .scv2").text());
    const mileage = parseKm(specFromTable($, "Mileage") || $('[itemprop="mileageFromOdometer"]').text());
    const year = parseYear(specFromTable($, "Year") || title);
    const sold = /sold\s*out|isSoldout/i.test(fetched.html ?? "");
    const vehicle = vehicleFromParts({
      vin,
      make: specFromTable($, "Maker") || specFromTable($, "Make"),
      model: specFromTable($, "Model"),
      year,
      fuelType: specFromTable($, "Fuel") || $('[itemprop="fuelType"]').text().trim(),
      transmission: specFromTable($, "Transmission") || $('[itemprop="vehicleTransmission"]').text().trim(),
    });
    const photos = collectImgs($, SSANCAR_WEB_BASE, [
      `${SSANCAR_WEB_BASE}/data/stock_img/${sourceId}_0.jpg`,
    ]);
    return usdListing({
      sourceId,
      sourceUrl: ssancarDetailUrl(sourceId),
      title,
      price,
      mileage,
      sold,
      vehicle,
      photos,
    });
  }
}
