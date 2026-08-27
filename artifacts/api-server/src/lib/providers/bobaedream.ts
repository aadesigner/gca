import { load } from "cheerio";
import type { FetchedListing, ListingReference, NormalizedListing } from "@workspace/providers";
import { KrHtmlAdapter, type KrDiscoverResult } from "./kr-adapter";
import { krFetch } from "./kr-http";
import {
  collectImgs,
  findVinInText,
  krwListing,
  normalizeKrVin,
  parseKm,
  parseYear,
  specFromTable,
  vehicleFromParts,
  type KrFilterParams,
} from "./kr-common";

export const BOBAEDREAM_PARSER_VERSION = "bobaedream-v1.0.0";
export const BOBAEDREAMCYBER_PARSER_VERSION = "bobaedreamcyber-v1.0.0";
export const BOBAEDREAM_WEB_BASE = "https://www.bobaedream.co.kr";
const PAGE_SIZE = 20;

type BobaedreamChannel = "mycar" | "cyber";

function channelGubun(filters: KrFilterParams): string {
  const raw = (filters as KrFilterParams & { gubun?: string }).gubun;
  return raw === "I" ? "I" : "K";
}

function manwonFromText(raw?: string | null): number | undefined {
  if (!raw) return undefined;
  const n = Number(String(raw).replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return Math.round(n * 10_000);
}

function parseLooseKm(raw?: string | null): number | undefined {
  if (!raw) return undefined;
  const text = String(raw).replace(/\s+/g, "");
  const man = text.match(/([\d,.]+)만\s*km/i);
  if (man) return Math.round(Number(man[1]!.replace(/,/g, "")) * 10_000);
  return parseKm(raw);
}

function parseLooseYear(raw?: string | null): number | undefined {
  if (!raw) return undefined;
  const slash = raw.match(/(\d{2})\/(\d{2})/);
  if (slash) {
    const yy = Number(slash[1]);
    return yy >= 70 ? 1900 + yy : 2000 + yy;
  }
  const dotted = raw.match(/(20\d{2}|19\d{2})\.(\d{2})/);
  if (dotted) return Number(dotted[1]);
  return parseYear(raw);
}

function specCell($: ReturnType<typeof load>, label: string): string | undefined {
  return specFromTable($, label);
}

function parseBobaedreamListing(
  fetched: FetchedListing,
  sourceId: string,
  detailUrl: string,
  channel: BobaedreamChannel,
): NormalizedListing {
  const $ = load(fetched.html ?? "");
  const title =
    $(".info-price .tit").first().text().replace(/\s+/g, " ").trim() ||
    $("h3.tit").first().text().replace(/\s+/g, " ").trim() ||
    $("title").first().text().replace(/\s+/g, " ").trim();

  const stateText = $(".info-price .state").text();
  const priceText = $(".info-price .price-area .price").first().text();
  const priceManwon = priceText.match(/([\d,]+)\s*만\s*원/)?.[1] ?? $(".info-price .price b.cr").first().text();
  const mileage =
    parseLooseKm(specCell($, "주행거리")) ||
    parseLooseKm(stateText.match(/([\d,.]+(?:km|만km))/)?.[1]);
  const year =
    parseLooseYear(specCell($, "연식")) ||
    parseLooseYear(stateText.match(/(\d{2}\/\d{2}|\d{4}\.\d{2})/)?.[1]);
  const engineRaw = specCell($, "배기량");
  const engineDisplacement = engineRaw?.match(/([\d,]+)\s*cc/i)?.[1]?.replace(/,/g, "");

  const parts = title.split(/\s+/);
  const make = parts[0];
  const model = parts.slice(1, 4).join(" ") || undefined;
  const vin = normalizeKrVin(findVinInText(fetched.html ?? ""));

  const vehicle = vehicleFromParts({
    vin,
    make,
    model,
    trim: parts.slice(4).join(" ") || undefined,
    year,
    fuelType: specCell($, "연료") || stateText.match(/(가솔린|디젤|LPG|하이브리드|전기[^,\s]*)/)?.[1],
    transmission: specCell($, "변속기"),
    color: specCell($, "색상"),
    engineDisplacement,
  });

  const sold = /판매완료|sold out/i.test(fetched.html ?? "");
  const photos = collectImgs($, BOBAEDREAM_WEB_BASE, [
    ...[...(fetched.html?.matchAll(/file\d+\.bobaedream\.co.kr\/direct\/[^"'\\s]+/g) ?? [])].map((m) => `https://${m[0]}`),
  ]);

  return krwListing({
    sourceId,
    sourceUrl: detailUrl,
    title,
    price: manwonFromText(priceManwon),
    mileage,
    location: channel === "cyber" ? "Bobaedream Cyber" : "Bobaedream MyCar",
    sold,
    vehicle,
    photos,
  });
}

abstract class BobaedreamBaseAdapter extends KrHtmlAdapter {
  abstract readonly channel: BobaedreamChannel;

  protected listPath(): string {
    return this.channel === "cyber" ? "/cyber/CyberCar.php" : "/mycar/mycar_list.php";
  }

  protected viewPath(): string {
    return this.channel === "cyber" ? "/cyber/CyberCar_view.php" : "/mycar/mycar_view.php";
  }

  protected viewPattern(): RegExp {
    return this.channel === "cyber" ? /CyberCar_view\.php\?no=(\d+)/g : /mycar_view\.php\?no=(\d+)/g;
  }

  detailUrl(id: string): string {
    const gubun = channelGubun(this.filters);
    return `${BOBAEDREAM_WEB_BASE}${this.viewPath()}?no=${id}&gubun=${gubun}`;
  }

  async discoverListings(page: number): Promise<KrDiscoverResult> {
    const gubun = channelGubun(this.filters);
    const url = `${BOBAEDREAM_WEB_BASE}${this.listPath()}?gubun=${gubun}&page=${page}&order=S11`;
    const fetched = await krFetch(url, { referer: `${BOBAEDREAM_WEB_BASE}${this.listPath()}?gubun=${gubun}` });
    const $ = load(fetched.text);
    const seen = new Set<string>();
    const listings: ListingReference[] = [];

    const pattern = this.channel === "cyber" ? /CyberCar_view\.php\?no=(\d+)/ : /mycar_view\.php\?no=(\d+)/;
    for (const match of fetched.text.matchAll(new RegExp(pattern.source, "g"))) {
      const id = match[1]!;
      if (seen.has(id)) continue;
      seen.add(id);
      listings.push({ sourceId: id, url: this.detailUrl(id) });
    }

    // Enrich from visible row cells when present.
    $(`a[href*="${this.channel === "cyber" ? "CyberCar_view" : "mycar_view"}.php?no="]`).each((_, el) => {
      const href = $(el).attr("href") ?? "";
      const id = href.match(/no=(\d+)/)?.[1];
      if (!id || !seen.has(id)) return;
      const row = $(el).closest("li, tr, .mode-row, .list-item");
      const priceManwon = row.find(".mode-cell.price .cr, .mode-cell.price em.cr").first().text().trim();
      const km = row.find(".mode-cell.km .text").first().text().trim();
      const fuel = row.find(".mode-cell.fuel .text").first().text().trim();
      const year = row.find(".mode-cell.year .text").first().text().trim();
      const title = $(el).attr("title") || $(el).text().trim();
      const existing = listings.find((l) => l.sourceId === id);
      if (existing) {
        existing.metadata = {
          ...(existing.metadata ?? {}),
          title,
          priceManwon,
          mileageText: km,
          fuel,
          yearText: year,
        };
      }
    });

    return {
      listings,
      pagination: { currentPage: page, hasMore: listings.length >= PAGE_SIZE },
    };
  }

  protected extractSourceId(url: string): string | undefined {
    return url.match(/no=(\d+)/i)?.[1];
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const sourceId = this.extractSourceId(fetched.url) || "unknown";
    return parseBobaedreamListing(fetched, sourceId, fetched.url, this.channel);
  }
}

export class BobaedreamHistoricalAdapter extends BobaedreamBaseAdapter {
  readonly internalName = "bobaedream";
  readonly channel = "mycar" as const;
}

export class BobaedreamCyberHistoricalAdapter extends BobaedreamBaseAdapter {
  readonly internalName = "bobaedreamcyber";
  readonly channel = "cyber" as const;
}

export function bobaedreamDetailUrl(id: string, gubun = "K"): string {
  return `${BOBAEDREAM_WEB_BASE}/mycar/mycar_view.php?no=${id}&gubun=${gubun}`;
}

export function bobaedreamCyberDetailUrl(id: string, gubun = "K"): string {
  return `${BOBAEDREAM_WEB_BASE}/cyber/CyberCar_view.php?no=${id}&gubun=${gubun}`;
}
