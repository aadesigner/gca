import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  PaginationInfo,
} from "@workspace/providers";
import { SOUTH_KOREA } from "../geo";
import { findVinInListing, parseYear, vehicleFromParts } from "./kr-common";
import { moneyListing } from "./us-common";
import {
  asArray,
  asPhotos,
  asRecord,
  collectHttpImages,
  extractNextData,
  fetchHtml,
  firstRegEvent,
  num,
  str,
  walkFind,
} from "./web-html";

export const AUTOBELL_PARSER_VERSION = "autobell-v1.0.0";
const BASE = "https://www.autobell.co.kr";

export function autobellDetailUrl(id: string): string {
  if (id.startsWith("http")) return id;
  return `${BASE}/buycar/detail?carId=${encodeURIComponent(id)}`;
}

async function fetchJson(url: string, body?: unknown): Promise<unknown> {
  try {
    const res = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json",
        "Content-Type": "application/json",
        Referer: `${BASE}/`,
      },
      signal: AbortSignal.timeout(12_000),
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  }
}

export class AutobellHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "autobell";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    const push = (id: string) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      listings.push({ sourceId: id, url: autobellDetailUrl(id) });
    };

    const json = await fetchJson(`${BASE}/api/buycar/searchList`, { pageNo: page, pageSize: 20 });
    const rows = asArray(
      walkFind(json, (_k, v) => (Array.isArray(v) && v.length && (asRecord(v[0])?.carId || asRecord(v[0])?.carSeq) ? v : undefined)),
    );
    for (const row of rows) {
      const rec = asRecord(row);
      const id = str(rec?.carId) ?? str(rec?.carSeq) ?? str(rec?.auctionNo);
      if (id) push(id);
    }

    if (!listings.length) {
      const html = await fetchHtml(`${BASE}/buycar/search?page=${page}`);
      const next = extractNextData(html.text);
      const nextRows = asArray(walkFind(next, (_k, v) => (Array.isArray(v) && asRecord(v[0])?.carId ? v : undefined)));
      for (const row of nextRows) {
        const id = str(asRecord(row)?.carId);
        if (id) push(id);
      }
      for (const match of html.text.matchAll(/carId[=:]["']?([A-Za-z0-9]+)/gi)) {
        push(match[1]!);
      }
    }

    return { listings, pagination: { currentPage: page, hasMore: listings.length >= 8 } };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const id = url.match(/carId=([^&]+)/)?.[1] ?? url;
    const json = await fetchJson(`${BASE}/api/buycar/detail?carId=${encodeURIComponent(id)}`);
    const fetched = await fetchHtml(autobellDetailUrl(id));
    return { url: fetched.finalUrl, html: fetched.text, json, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const rec =
      asRecord(walkFind(fetched.json, (key, value) => (/car/i.test(key) && asRecord(value) ? value : undefined))) ??
      asRecord(fetched.json);
    const sourceId = str(rec?.carId) ?? fetched.url.match(/carId=([^&]+)/)?.[1] ?? "unknown";
    const vin = findVinInListing(str(rec?.vin), str(rec?.cnumber), JSON.stringify(rec ?? {}), html);
    const title = str(rec?.carNm) ?? str(rec?.carName);
    const mileage = num(rec?.mileage) ?? num(rec?.km);
    const price = num(rec?.price) ?? num(rec?.startPrice);
    const photos = vin ? asPhotos(collectHttpImages(html, "autobell", 40)) : [];
    const firstReg = firstRegEvent(rec?.firstRegYmd ?? rec?.year);
    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title,
      price: price && price < 1_000_000 ? price * 10_000 : price,
      currency: "KRW",
      mileage,
      mileageUnit: "km",
      location: SOUTH_KOREA,
      country: SOUTH_KOREA,
      vehicle: vehicleFromParts({
        vin,
        make: str(rec?.makerNm),
        model: str(rec?.modelNm) ?? title,
        year: num(rec?.year) ?? parseYear(str(rec?.year)),
        country: SOUTH_KOREA,
      }),
      photos,
      events: firstReg ? [firstReg] : undefined,
    });
  }
}
