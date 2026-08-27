import { load } from "cheerio";
import type { FetchedListing, ListingReference, NormalizedListing } from "@workspace/providers";
import { KrHtmlAdapter, type KrDiscoverResult } from "./kr-adapter";
import { krFetch } from "./kr-http";
import {
  collectImgs,
  findVinInText,
  normalizeKrVin,
  pagerMax,
  parseKm,
  parseMoney,
  parseYear,
  usdListing,
  vehicleFromParts,
} from "./kr-common";

export const KOREAUSEDCARS_PARSER_VERSION = "koreausedcars-v1.2.0";
export const KOREAUSEDCARS_WEB_BASE = "https://koreausedcars.net";
const LIST_PAGE = 551;
const DETAIL_PAGE = 548;

export function koreaUsedCarsDetailUrl(seqno: string): string {
  return `${KOREAUSEDCARS_WEB_BASE}/web_basic/car/view.php?pagen=${DETAIL_PAGE}&seqno=${seqno}`;
}

function specMap($: ReturnType<typeof load>): Map<string, string> {
  const map = new Map<string, string>();
  $("dt").each((_, el) => {
    const key = $(el).text().replace(/\s+/g, " ").trim().toLowerCase();
    const value = $(el).next("dd").text().replace(/\s+/g, " ").trim();
    if (!key || !value || map.has(key)) return;
    map.set(key, value);
  });
  return map;
}

function spec(map: Map<string, string>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = map.get(key.toLowerCase());
    if (value) return value;
  }
  return undefined;
}

function parseMakerBrand(raw?: string): { make?: string; model?: string } {
  if (!raw) return {};
  const [make, model] = raw.split("/").map((part) => part.trim()).filter(Boolean);
  return { make, model };
}

function parseMileage(raw?: string, html?: string, notes?: string): number | undefined {
  const fromLabel = parseKm(raw);
  if (fromLabel != null && fromLabel > 0) return fromLabel;
  const blob = `${raw ?? ""} ${notes ?? ""} ${html ?? ""}`;
  const named = blob.match(/(?:mileage|odometer|주행거리)\s*[:.]?\s*([\d,]+)\s*(?:km|miles)?/i);
  if (named) return parseKm(named[1]);
  const km = blob.match(/\b([\d,]{4,7})\s*km\b/i);
  if (km) return parseKm(km[1]);
  return undefined;
}

export class KoreaUsedCarsHistoricalAdapter extends KrHtmlAdapter {
  readonly internalName = "koreausedcars";

  async discoverListings(page: number): Promise<KrDiscoverResult> {
    const url = `${KOREAUSEDCARS_WEB_BASE}/web_basic/car/list.php?paging=${page}&pagen=${LIST_PAGE}&searchBtn=0&resultsearch=0`;
    const fetched = await krFetch(url, { referer: `${KOREAUSEDCARS_WEB_BASE}/web_basic/car/list.php?pagen=${LIST_PAGE}` });
    const $ = load(fetched.text);
    const seen = new Set<string>();
    const listings: ListingReference[] = [];
    $('a[href*="view.php"][href*="seqno="], a[href*="car/view"][href*="seqno="]').each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const id = href.match(/seqno=(\d+)/i)?.[1];
      if (!id || seen.has(id)) return;
      seen.add(id);
      const sold = $(el).closest("li, article, div").find(".soldoutText").length > 0;
      listings.push({
        sourceId: id,
        url: koreaUsedCarsDetailUrl(id),
        metadata: { sold },
      });
    });
    if (listings.length === 0) {
      for (const match of fetched.text.matchAll(/view\.php\?[^"' ]*seqno=(\d+)/gi)) {
        const id = match[1]!;
        if (seen.has(id)) continue;
        seen.add(id);
        listings.push({ sourceId: id, url: koreaUsedCarsDetailUrl(id) });
      }
    }
    const lastPage = pagerMax(fetched.text, "paging", page);
    return {
      listings,
      pagination: {
        currentPage: page,
        totalPages: lastPage,
        hasMore: listings.length > 0 && page < lastPage,
      },
    };
  }

  protected extractSourceId(url: string): string | undefined {
    return url.match(/seqno=(\d+)/i)?.[1];
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const $ = load(fetched.html ?? "");
    const sourceId = this.extractSourceId(fetched.url) || "unknown";
    const specs = specMap($);
    const modelName = spec(specs, "Model name");
    const title =
      $(".h3.detailViewTit, .detailViewTit").first().text().replace(/\s+/g, " ").trim() ||
      modelName ||
      "";
    const { make: brandMake, model: brandModel } = parseMakerBrand(spec(specs, "Maker / Brand"));
    const vin =
      normalizeKrVin(spec(specs, "VIN/ Chassis No.", "VIN")) ||
      findVinInText(fetched.html ?? "");
    const notes = $(".inspectorBox, .detailViewInfoCont").first().text();
    const price =
      parseMoney($(".price").first().text().match(/USD\s*[\d,]+/i)?.[0]) ||
      parseMoney(fetched.html?.match(/USD\s*[\d,]+/)?.[0]);
    const sold = $(".soldoutText").length > 0 || /SOLD OUT/i.test(fetched.html ?? "");
    const engine =
      spec(specs, "Engine volume / Capacity", "Engine volume") ||
      spec(specs, "Engine Power");
    const vehicle = vehicleFromParts({
      vin,
      make: brandMake,
      model: brandModel,
      trim: spec(specs, "Class / Grade"),
      year: parseYear(spec(specs, "Model Year")) || parseYear(title) || parseYear(modelName),
      fuelType: spec(specs, "Fuel Type"),
      transmission: spec(specs, "Transmission"),
      driveType: spec(specs, "Drive Type"),
      bodyType: spec(specs, "Vehicle type"),
      color: spec(specs, "Exterior Color", "Color"),
      engineDisplacement: engine && /\d/.test(engine) ? engine.replace(/[^\d.]/g, "") : undefined,
    });
    return usdListing({
      sourceId,
      sourceUrl: koreaUsedCarsDetailUrl(sourceId),
      title,
      price,
      mileage: parseMileage(spec(specs, "Mileage", "Odometer"), fetched.html, notes),
      sold,
      location: spec(specs, "Location"),
      vehicle,
      photos: collectImgs($, KOREAUSEDCARS_WEB_BASE),
    });
  }
}
