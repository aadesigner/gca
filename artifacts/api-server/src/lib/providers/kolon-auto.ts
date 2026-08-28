import type { FetchedListing, ListingReference, NormalizedListing, NormalizedPhoto } from "@workspace/providers";
import { KrHtmlAdapter, type KrDiscoverResult } from "./kr-adapter";
import { krFetch, KrRequestError } from "./kr-http";
import {
  normalizeKrVin,
  parseKm,
  parseMoney,
  parseYear,
  usdListing,
  vehicleFromParts,
} from "./kr-common";
import { SOUTH_KOREA } from "../geo";
import { listedAtFromKolonGoodsId } from "./listing-dates";

export const KOLON_AUTO_PARSER_VERSION = "kolon-auto-v1.0.0";
export const KOLON_AUTO_WEB_BASE = "https://www.kolonautointernational.com";
export const KOLON_AUTO_LIST_API = `${KOLON_AUTO_WEB_BASE}/api/service/v1.0/getCarList.do`;
export const KOLON_AUTO_DETAIL_API = `${KOLON_AUTO_WEB_BASE}/api/service/v1.0/getCarInfo.do`;

/** Server caps page_size; 50 is accepted and returns 50 rows. */
const PAGE_SIZE = 50;

type KolonRow = Record<string, unknown>;

type KolonListResponse = {
  status?: number;
  result_code?: string;
  result_msg?: string;
  data?: {
    page_index?: number;
    page_count?: number;
    page_size?: number;
    total_page?: number;
    total_count?: number;
    is_next?: boolean;
    data_list?: KolonRow[];
  };
};

type KolonDetailResponse = {
  status?: number;
  result_code?: string;
  result_msg?: string;
  data?: KolonRow;
};

export function kolonDetailUrl(goodsId: string): string {
  return `${KOLON_AUTO_WEB_BASE}/buy-now/detail/${encodeURIComponent(goodsId)}`;
}

async function kolonPost<T>(url: string, body: Record<string, unknown>): Promise<T> {
  const fetched = await krFetch(url, {
    method: "POST",
    body: JSON.stringify(body),
    contentType: "application/json",
    accept: "application/json, text/plain, */*",
    referer: `${KOLON_AUTO_WEB_BASE}/buy-now`,
    headers: {
      Origin: KOLON_AUTO_WEB_BASE,
    },
  });
  try {
    return JSON.parse(fetched.text) as T;
  } catch {
    throw new KrRequestError(fetched.status, "Kolon API returned non-JSON", url);
  }
}

function kolonVin(row: KolonRow): string | undefined {
  const info = (row.information as KolonRow | undefined) ?? undefined;
  const overview = (row.car_overview as KolonRow | undefined) ?? undefined;
  const raw =
    info?.vin ??
    info?.vin_no ??
    row.car_vin ??
    row.car_vin_num ??
    overview?.vin_no ??
    overview?.vin;
  return normalizeKrVin(raw != null ? String(raw) : undefined);
}

function kolonMileage(row: KolonRow): number | undefined {
  const overview = (row.car_overview as KolonRow | undefined) ?? undefined;
  const raw = row.car_mileage ?? overview?.mileage ?? row.mileage;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 1) return Math.round(raw);
  return parseKm(raw != null ? String(raw) : undefined);
}

function kolonPrice(row: KolonRow): number | undefined {
  for (const key of ["car_price", "car_discount_price", "car_original_price"] as const) {
    const raw = row[key];
    if (raw == null) continue;
    const s = String(raw).trim();
    if (!s || /\*/.test(s) || /^n\/?a$/i.test(s)) continue;
    const n = typeof raw === "number" ? raw : parseMoney(s);
    if (n != null && n > 0) return n;
  }
  return undefined;
}

/** Status codes observed: 30 = listed/for sale. Treat sold/reserved as sold. */
function kolonSold(row: KolonRow): boolean {
  const code = String(row.car_status_code ?? "").trim();
  if (!code) return false;
  if (code === "30") return false;
  // Anything else (sold / hold / deleted) — mark sold so history still keeps last price
  return true;
}

function kolonPhotos(row: KolonRow, listThumb?: string): NormalizedPhoto[] {
  const images = row.car_images as { car_imgs?: unknown; car_resize_imgs?: unknown } | string | undefined;
  const urls: string[] = [];
  if (images && typeof images === "object") {
    const full = Array.isArray(images.car_imgs) ? images.car_imgs : [];
    for (const u of full) {
      if (typeof u === "string" && /^https?:\/\//i.test(u)) urls.push(u.split("?")[0]!);
    }
  } else if (typeof images === "string" && /^https?:\/\//i.test(images)) {
    urls.push(images.split("?")[0]!);
  }
  if (listThumb && /^https?:\/\//i.test(listThumb)) {
    // Prefer full-res host over image-resize CDN when we only have a list thumb
    const upgraded = listThumb.replace("://image-resize.", "://image.");
    urls.push(upgraded.split("?")[0]!);
  }

  const seen = new Set<string>();
  const out: NormalizedPhoto[] = [];
  for (const url of urls) {
    if (!/\.(?:jpe?g|png|webp)$/i.test(url)) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({ sourceUrl: url, isPrimary: out.length === 0, sortOrder: out.length });
    if (out.length >= 40) break;
  }
  return out;
}

function splitPrimaryName(primary?: string): { make?: string; model?: string } {
  if (!primary) return {};
  const cleaned = primary.replace(/\s+/g, " ").trim();
  const sp = cleaned.indexOf(" ");
  if (sp <= 0) return { make: cleaned };
  return { make: cleaned.slice(0, sp), model: cleaned.slice(sp + 1) };
}

export class KolonAutoHistoricalAdapter extends KrHtmlAdapter {
  readonly internalName = "kolon_auto";

  async discoverListings(page: number): Promise<KrDiscoverResult> {
    const pageIndex = Math.max(1, page);
    const json = await kolonPost<KolonListResponse>(KOLON_AUTO_LIST_API, {
      page_index: pageIndex,
      page_count: PAGE_SIZE,
      search_sort: "N",
    });

    if (json.result_code && json.result_code !== "0000") {
      throw new KrRequestError(
        502,
        `Kolon list failed: ${json.result_msg ?? json.result_code}`,
        KOLON_AUTO_LIST_API,
      );
    }

    const data = json.data ?? {};
    const rows = Array.isArray(data.data_list) ? data.data_list : [];
    const totalPages = Number(data.total_page ?? 0) || 0;
    const currentPage = Number(data.page_index ?? pageIndex) || pageIndex;
    const hasMore =
      data.is_next === true ||
      (totalPages > 0 ? currentPage < totalPages : rows.length >= PAGE_SIZE);

    const listings: ListingReference[] = [];
    for (const row of rows) {
      const id = row.car_goods_unique_id != null ? String(row.car_goods_unique_id).trim() : "";
      if (!id) continue;
      listings.push({
        sourceId: id,
        url: kolonDetailUrl(id),
        metadata: row,
      });
    }

    return {
      listings,
      pagination: {
        currentPage,
        totalPages: totalPages || undefined,
        hasMore: listings.length > 0 && hasMore,
      },
    };
  }

  protected extractSourceId(url: string): string | undefined {
    return (
      url.match(/\/buy-now\/detail\/([^/?#]+)/i)?.[1] ??
      url.match(/[?&](?:car_goods_unique_id|goodsId)=([^&]+)/i)?.[1]
    );
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return normalizeKrVin(listing.vehicle?.vin);
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const goodsId = this.extractSourceId(url);
    if (!goodsId) {
      throw new KrRequestError(400, `Kolon detail id missing from ${url}`, url);
    }

    const json = await kolonPost<KolonDetailResponse>(KOLON_AUTO_DETAIL_API, {
      car_goods_unique_id: goodsId,
    });

    if (json.result_code && json.result_code !== "0000") {
      throw new KrRequestError(
        502,
        `Kolon detail failed: ${json.result_msg ?? json.result_code}`,
        url,
      );
    }
    if (!json.data || typeof json.data !== "object") {
      throw new KrRequestError(404, `Kolon detail empty for ${goodsId}`, url);
    }

    return {
      url: kolonDetailUrl(goodsId),
      html: JSON.stringify(json.data),
      json: json.data,
      statusCode: 200,
      headers: {},
      metadata: { goodsId },
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const row = (fetched.json ?? {}) as KolonRow;
    const sourceId =
      String((row.car_overview as KolonRow | undefined)?.ref_no ?? "").trim() ||
      this.extractSourceId(fetched.url) ||
      String((fetched.metadata as { goodsId?: string } | undefined)?.goodsId ?? "unknown");

    const overview = (row.car_overview as KolonRow | undefined) ?? {};
    const vin = kolonVin(row);
    const mileage = kolonMileage(row);
    const year =
      parseYear(row.car_year != null ? String(row.car_year) : undefined) ??
      parseYear(overview.year != null ? String(overview.year) : undefined) ??
      parseYear(overview.p_year != null ? String(overview.p_year) : undefined);

    const brand = overview.brand != null ? String(overview.brand).trim() : undefined;
    const model = overview.model != null ? String(overview.model).trim() : undefined;
    const fromPrimary = splitPrimaryName(
      row.car_primary_name != null ? String(row.car_primary_name) : undefined,
    );
    const make = brand || fromPrimary.make;
    const resolvedModel = model || fromPrimary.model;
    const trim =
      (overview.grade != null ? String(overview.grade).trim() : undefined) ||
      (row.car_sub_name != null ? String(row.car_sub_name).trim() : undefined);

    const title =
      (overview.name != null ? String(overview.name).replace(/\s+/g, " ").trim() : "") ||
      [year, make, resolvedModel, trim].filter(Boolean).join(" ") ||
      sourceId;

    const cc = overview.cc != null ? Number(overview.cc) : undefined;
    const vehicle = vehicleFromParts({
      vin,
      make,
      model: resolvedModel,
      trim,
      year,
      fuelType:
        (row.car_fuel != null ? String(row.car_fuel) : undefined) ||
        (overview.fuel != null ? String(overview.fuel) : undefined),
      transmission:
        (row.car_transmission != null ? String(row.car_transmission) : undefined) ||
        (overview.transmission != null ? String(overview.transmission) : undefined),
      bodyType: overview.body_type != null ? String(overview.body_type) : undefined,
      driveType: overview.drive != null ? String(overview.drive) : undefined,
      engineDisplacement: cc != null && cc > 0 ? String(cc) : undefined,
      color: overview.color != null ? String(overview.color) : undefined,
      country: SOUTH_KOREA,
    });

    const listThumb =
      typeof (fetched.metadata as { car_images?: string } | undefined)?.car_images === "string"
        ? (fetched.metadata as { car_images: string }).car_images
        : undefined;

    return usdListing({
      sourceId,
      sourceUrl: kolonDetailUrl(sourceId),
      title,
      price: kolonPrice(row),
      mileage,
      sold: kolonSold(row),
      vehicle,
      photos: kolonPhotos(row, listThumb),
      sourceListedAt: listedAtFromKolonGoodsId(sourceId),
      sourceModifiedAt: listedAtFromKolonGoodsId(sourceId),
    });
  }
}
