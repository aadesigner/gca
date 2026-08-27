import { load } from "cheerio";
import type { FetchedListing, ListingReference, NormalizedListing } from "@workspace/providers";
import { KrHtmlAdapter, type KrDiscoverResult } from "./kr-adapter";
import { krFetch, KrRequestError } from "./kr-http";
import { findVinInText, parseKm, parseMoney, parseYear, usdListing, vehicleFromParts, collectImgs } from "./kr-common";
import { listedAtFromAutowiniItemCode } from "./listing-dates";

export const AUCTIONWINI_PARSER_VERSION = "auctionwini-v1.4.0";
export const AUCTIONWINI_WEB_BASE = "https://www.auctionwini.com";
export const AUCTIONWINI_BUYER = "https://buyer.auctionwini.com";
export const AUCTIONWINI_API = "https://v2api.auctionwini.com";

export function auctionwiniDetailUrl(id: string): string {
  return `${AUCTIONWINI_BUYER}/liveAuction/detail-${id}`;
}

function token(): string | undefined {
  return process.env.AUCTIONWINI_TOKEN || process.env.AUTOWINI_TOKEN;
}

/** v2api.auctionwini.com returns 403 without a buyer Origin. */
function auctionwiniApiHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    Origin: AUCTIONWINI_BUYER,
    Referer: `${AUCTIONWINI_BUYER}/`,
    ...extra,
  };
  const auth = token();
  if (auth) headers.Authorization = `Bearer ${auth}`;
  return headers;
}

export class AuctionwiniHistoricalAdapter extends KrHtmlAdapter {
  readonly internalName = "auctionwini";
  private listCache = new Map<string, Record<string, unknown>>();

  async discoverListings(page: number): Promise<KrDiscoverResult> {
    // The public list API works without a token and returns odometer, price, etc.
    try {
      const apiUrl = `${AUCTIONWINI_API}/items/live-auction/recent-5-year-vehicles?pageOffset=${page}&pageSize=40`;
      const fetched = await krFetch(apiUrl, {
        accept: "application/json",
        headers: auctionwiniApiHeaders(),
        referer: `${AUCTIONWINI_BUYER}/`,
      });
      const json = JSON.parse(fetched.text) as { data?: Array<Record<string, unknown>> };
      const items = Array.isArray(json.data) ? json.data : [];
      const listings: ListingReference[] = items
        .filter((item) => item.itemCode)
        .map((item) => {
          const sourceId = String(item.itemCode);
          this.listCache.set(sourceId, item);
          return {
            sourceId,
            url: auctionwiniDetailUrl(sourceId),
            metadata: item,
          };
        });
      return {
        listings,
        pagination: { currentPage: page, hasMore: listings.length >= 20 },
      };
    } catch (err) {
      if (!(err instanceof KrRequestError)) throw err;
    }

    if (page === 1) {
      const urls = [`${AUCTIONWINI_WEB_BASE}/`, `${AUCTIONWINI_BUYER}/liveAuction`, `${AUCTIONWINI_BUYER}/`];
      const listings: ListingReference[] = [];
      const seen = new Set<string>();
      for (const pageUrl of urls) {
        try {
          const home = await krFetch(pageUrl, { referer: AUCTIONWINI_WEB_BASE });
          const patterns = [
            /detail-([A-Za-z0-9_-]{6,})/g,
            /"itemCode"\s*:\s*"([^"]+)"/g,
            /"listingId"\s*:\s*"([^"]+)"/g,
            /itemCode=([A-Za-z0-9_-]{6,})/g,
          ];
          for (const re of patterns) {
            for (const match of home.text.matchAll(re)) {
              const id = match[1]!;
              if (id === "model-section" || seen.has(id)) continue;
              seen.add(id);
              listings.push({ sourceId: id, url: auctionwiniDetailUrl(id) });
            }
          }
        } catch {
          // try next public URL
        }
      }
      return {
        listings,
        pagination: { currentPage: 1, hasMore: listings.length >= 20 },
      };
    }

    return { listings: [], pagination: { currentPage: page, hasMore: false } };
  }

  protected extractSourceId(url: string): string | undefined {
    return url.match(/detail-([^/?#]+)/i)?.[1] ?? url.match(/items\/([A-Za-z0-9_-]+)/)?.[1];
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const id = this.extractSourceId(url);
    const cached = id ? this.listCache.get(id) : undefined;
    if (id) {
      // Detail endpoints need a bearer token; without one we rely on list metadata.
      const auth = token();
      if (auth) {
        try {
          const fetched = await krFetch(`${AUCTIONWINI_API}/items/${encodeURIComponent(id)}`, {
            accept: "application/json",
            headers: auctionwiniApiHeaders(),
            referer: `${AUCTIONWINI_BUYER}/`,
          });
          return {
            url: auctionwiniDetailUrl(id),
            html: fetched.text,
            json: JSON.parse(fetched.text) as Record<string, unknown>,
            statusCode: fetched.status,
            headers: fetched.headers,
            metadata: cached,
          };
        } catch {
          // fall through
        }
      }
      if (cached) {
        return {
          url: auctionwiniDetailUrl(id),
          html: JSON.stringify({ data: cached }),
          json: { data: cached },
          statusCode: 200,
          headers: {},
          metadata: cached,
        };
      }
    }
    const html = await super.fetchListing(url);
    if (cached) html.metadata = cached;
    return html;
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const sourceId = this.extractSourceId(fetched.url) || "unknown";
    const json = fetched.json as { data?: Record<string, unknown> } | undefined;
    const data = (json?.data ?? json ?? {}) as Record<string, unknown>;
    const meta = (fetched.metadata ?? {}) as Record<string, unknown>;

    const mileageFrom = (row: Record<string, unknown>): number | undefined => {
      if (typeof row.odometer === "number" && row.odometer > 0) return row.odometer;
      const parsed = parseKm(String(row.odometer ?? row.mileage ?? ""));
      return parsed != null && parsed > 0 ? parsed : undefined;
    };
    const mileageFromMeta = (): number | undefined => mileageFrom(meta) ?? mileageFrom(data);

    // Detail API response (has vinNumber, itemName, etc.)
    if (data && (data.vinNumber || data.vin || data.itemName)) {
      const vin = findVinInText(String(data.vinNumber ?? data.vin ?? ""));
      const vehicle = vehicleFromParts({
        vin,
        make: String(data.makeName ?? data.make ?? "") || undefined,
        model: String(data.modelName ?? "") || undefined,
        year: parseYear(String(data.modelYear ?? "")),
        fuelType: String(data.fuelTypeName ?? data.fuelTypeText ?? "") || undefined,
        transmission: String(data.transmissionName ?? "") || undefined,
        engineDisplacement: data.engineVolume != null ? String(data.engineVolume) : undefined,
      });
      const photos: Array<{ sourceUrl: string; isPrimary: boolean; sortOrder: number }> = [];
      if (data.featuredImageUrl) {
        photos.push({ sourceUrl: String(data.featuredImageUrl), isPrimary: true, sortOrder: 0 });
      }
      const listed =
        listedAtFromAutowiniItemCode(data.itemCode) ??
        listedAtFromAutowiniItemCode(sourceId);
      return usdListing({
        sourceId,
        sourceUrl: auctionwiniDetailUrl(sourceId),
        title: String(data.itemName ?? data.name ?? sourceId),
        price: parseMoney(String(data.itemPrice ?? data.currentMaxBidPrice ?? "")),
        mileage: mileageFromMeta(),
        sold: /sold/i.test(String(data.carStatusText ?? "")),
        vehicle,
        photos,
        sourceListedAt: listed,
        sourceModifiedAt: listed,
      });
    }

    // Fallback: parse from the list-API metadata stored during discovery
    const listRow = meta.itemCode ? meta : data.itemCode ? data : null;
    if (listRow) {
      const title = String(listRow.name ?? sourceId);
      const year = parseYear(title);
      const parts = title.split(/\s+/);
      const yearIdx = parts.findIndex((p) => /^\d{4}$/.test(p));
      const make = yearIdx >= 0 ? parts[yearIdx + 1] : parts[0];
      const model = yearIdx >= 0 ? parts.slice(yearIdx + 2).join(" ") : parts.slice(1).join(" ");

      const vehicle = vehicleFromParts({
        make,
        model,
        year,
        fuelType: String(listRow.fuelTypeText ?? "") || undefined,
        engineDisplacement: listRow.engineVolume != null ? String(listRow.engineVolume) : undefined,
      });
      const photos: Array<{ sourceUrl: string; isPrimary: boolean; sortOrder: number }> = [];
      if (listRow.featuredImageUrl) {
        photos.push({ sourceUrl: String(listRow.featuredImageUrl), isPrimary: true, sortOrder: 0 });
      }
      const listed =
        listedAtFromAutowiniItemCode(listRow.itemCode) ??
        listedAtFromAutowiniItemCode(listRow.code) ??
        listedAtFromAutowiniItemCode(sourceId);
      return usdListing({
        sourceId,
        sourceUrl: auctionwiniDetailUrl(sourceId),
        title,
        price: parseMoney(String(listRow.currentMaxBidPrice ?? "")),
        mileage: mileageFrom(listRow),
        sold: /sold/i.test(String(listRow.carStatusText ?? "")),
        vehicle,
        photos,
        sourceListedAt: listed,
        sourceModifiedAt: listed,
      });
    }

    // Last resort: HTML scraping
    const $ = load(fetched.html ?? "");
    const vin = findVinInText(fetched.html ?? "");
    const body = $("body").text().replace(/\s+/g, " ");
    const htmlMileage =
      parseKm(body.match(/odometer[^0-9]{0,20}([\d,]+)/i)?.[1]) ??
      parseKm(body.match(/mileage[^0-9]{0,20}([\d,]+)/i)?.[1]) ??
      parseKm(body.match(/([\d,]+)\s*k\.?m\.?\b/i)?.[1]);
    return usdListing({
      sourceId,
      sourceUrl: fetched.url,
      title: $("h1, title").first().text().trim(),
      mileage: htmlMileage ?? mileageFromMeta(),
      sold: /sold/i.test(body.slice(0, 2000)),
      vehicle: vehicleFromParts({ vin }),
      photos: collectImgs($, AUCTIONWINI_BUYER),
    });
  }
}
