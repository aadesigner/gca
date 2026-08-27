import { load } from "cheerio";
import type { FetchedListing, ListingReference, NormalizedListing } from "@workspace/providers";
import { KrHtmlAdapter, type KrDiscoverResult } from "./kr-adapter";
import { krFetch } from "./kr-http";
import {
  collectImgs,
  normalizeKrVin,
  parseYear,
  specFromTable,
  usdListing,
  vehicleFromParts,
} from "./kr-common";

export const MANGO_PARSER_VERSION = "mango-v1.1.0";
export const MANGO_WEB_BASE = "https://mangoworldcar.com";

const FUEL: Record<string, string> = { "0101": "Gasoline", "0102": "Diesel", "0103": "LPG", "0104": "Electric", "0105": "Hybrid" };
const GEAR: Record<string, string> = { "0101": "Automatic", "0102": "Manual" };

type MangoCard = {
  carDataCode: string;
  confirmFlag?: string;
  modelYear?: number;
  firstRegistrationDate?: string;
  gradeName?: string;
  driveDistance?: number;
  sellPrice?: number;
  currentSellPrice?: number;
  carSoldOutData?: unknown;
  category?: string;
  fuelType?: string;
  gearBoxType?: string;
  displacement?: number;
  filePath?: string;
  fileName?: string;
  identifyNumber?: string;
  ownerKey?: string;
};

export function mangoDetailUrl(id: string): string {
  return `${MANGO_WEB_BASE}/en/car-detail/${id}`;
}

function parseMangoCards(html: string): MangoCard[] {
  const cards: MangoCard[] = [];
  const re = /"carDataCode":"(MGC_[^"]+)"/g;
  const seen = new Set<string>();
  for (const match of html.matchAll(re)) {
    const code = match[1]!;
    if (seen.has(code)) continue;
    seen.add(code);
    const start = Math.max(0, match.index! - 80);
    const chunk = html.slice(start, start + 1800);
    const grab = (key: string) => chunk.match(new RegExp(`"${key}":("([^"]*)"|null|\\d+|true|false)`))?.[1];
    const num = (key: string) => {
      const raw = grab(key);
      if (!raw || raw === "null") return undefined;
      const n = Number(raw.replace(/"/g, ""));
      return Number.isFinite(n) ? n : undefined;
    };
    const str = (key: string) => {
      const raw = grab(key);
      if (!raw || raw === "null") return undefined;
      return raw.replace(/^"|"$/g, "");
    };
    cards.push({
      carDataCode: code,
      confirmFlag: str("confirmFlag"),
      modelYear: num("modelYear"),
      firstRegistrationDate: str("firstRegistrationDate"),
      gradeName: str("gradeName"),
      driveDistance: num("driveDistance"),
      sellPrice: num("sellPrice"),
      currentSellPrice: num("currentSellPrice"),
      carSoldOutData: str("carSoldOutData") === "null" ? null : str("carSoldOutData"),
      category: str("newCARCategoryName")?.replace(/\\u003e/g, ">"),
      fuelType: str("fuelType"),
      gearBoxType: str("gearBoxType"),
      displacement: num("displacement"),
      filePath: str("filePath"),
      fileName: str("fileName"),
      identifyNumber: str("identifyNumber"),
      ownerKey: str("ownerKey"),
    });
  }
  return cards;
}

export class MangoHistoricalAdapter extends KrHtmlAdapter {
  readonly internalName = "mango";
  private searchCache = new Map<string, MangoCard>();

  async discoverListings(page: number): Promise<KrDiscoverResult> {
    const skip = (page - 1) * 50;
    const url = `${MANGO_WEB_BASE}/en/car-normal-search-list?take=50&skip=${skip}`;
    const fetched = await krFetch(url, { referer: `${MANGO_WEB_BASE}/en/car-normal-search-list` });
    const cards = parseMangoCards(fetched.text);
    const listings: ListingReference[] = [];
    for (const card of cards) {
      this.searchCache.set(card.carDataCode, card);
      listings.push({
        sourceId: card.carDataCode,
        url: mangoDetailUrl(card.carDataCode),
        metadata: { sold: Boolean(card.carSoldOutData) },
      });
    }
    const hasNext = /"hasNextPage"\s*:\s*true/.test(fetched.text);
    return {
      listings,
      pagination: { currentPage: page, hasMore: hasNext && listings.length >= 50 },
    };
  }

  protected extractSourceId(url: string): string | undefined {
    return url.match(/(MGC_\d+_\d+)/i)?.[1]?.toUpperCase();
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const $ = load(fetched.html ?? "");
    const sourceId = this.extractSourceId(fetched.url) || "unknown";
    const cached = this.searchCache.get(sourceId);
    const cards = parseMangoCards(fetched.html ?? "");
    const card = cards.find((item) => item.carDataCode === sourceId) ?? cached;
    const vin = normalizeKrVin(card?.identifyNumber) || normalizeKrVin(specFromTable($, "VIN NO")) || normalizeKrVin(specFromTable($, "VIN Number"));
    const category = card?.category ?? "";
    const [make, model] = category.split(">").map((part) => part.trim());
    const sold = Boolean(card?.carSoldOutData) || /sold\s*out/i.test($("body").text().slice(0, 3000));
    const photo = card?.filePath && card.fileName && card.ownerKey
      ? [`https://file.mangoworldcar.com/${card.filePath}/${card.ownerKey}/${card.fileName}`]
      : [];
    const vehicle = vehicleFromParts({
      vin,
      make,
      model,
      trim: card?.gradeName,
      year: card?.modelYear ?? parseYear(fetched.html),
      fuelType: card?.fuelType ? FUEL[card.fuelType] ?? card.fuelType : undefined,
      transmission: card?.gearBoxType ? GEAR[card.gearBoxType] ?? card.gearBoxType : undefined,
      engineDisplacement: card?.displacement != null ? String(card.displacement) : undefined,
    });
    return usdListing({
      sourceId,
      sourceUrl: mangoDetailUrl(sourceId),
      title: category || $("h1, title").first().text().trim(),
      price: card?.currentSellPrice ?? card?.sellPrice,
      mileage: card?.driveDistance,
      sold,
      vehicle,
      photos: collectImgs($, MANGO_WEB_BASE, photo),
    });
  }
}
