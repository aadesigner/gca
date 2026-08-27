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
import { parseYmd } from "./listing-dates";

export const LOTTE_AUTOGLOBAL_PARSER_VERSION = "lotte-autoglobal-v1.0.0";
export const LOTTE_AUTOGLOBAL_WEB_BASE = "https://www.lotte-autoglobal.net";
export const LOTTE_AUTOGLOBAL_IMG_BASE = "https://img.lotte-autoglobal.net";
export const LOTTE_AUTOGLOBAL_AJAX = `${LOTTE_AUTOGLOBAL_WEB_BASE}/by/buy/selectGdListAjax.do`;
export const LOTTE_AUTOGLOBAL_LIST_REFERER = `${LOTTE_AUTOGLOBAL_WEB_BASE}/by/buy/gdListView.do?viewMode=moca`;

/** Server ignores larger pageUnit and always returns 10. */
const PAGE_SIZE = 10;

type LotteRow = Record<string, unknown>;
type LotteImg = { gdId?: string; afilePath?: string; regFileNm?: string };

type LotteCacheEntry = {
  row: LotteRow;
  images: string[];
};

export function lotteDetailUrl(gdId: string, vin?: string): string {
  const base = `${LOTTE_AUTOGLOBAL_WEB_BASE}/car/gd/${encodeURIComponent(gdId)}/`;
  const clean = vin ? normalizeLotteChassis(vin) : undefined;
  return clean ? `${base}?clsNo=${encodeURIComponent(clean)}` : base;
}

function lotteRawPhotoUrl(pathOrFile: string): string | undefined {
  let path = pathOrFile.trim().replace(/\\/g, "/");
  if (!path) return undefined;
  // Never store CDN watermark transforms
  if (/\/dims\//i.test(path) || /composite\/wm_/i.test(path)) {
    path = path.split("/dims/")[0]!;
  }
  if (path.startsWith("http")) {
    try {
      const u = new URL(path);
      if (!/img\.lotte-autoglobal\.net$/i.test(u.hostname)) return undefined;
      return `${u.origin}${u.pathname}`.split("?")[0];
    } catch {
      return undefined;
    }
  }
  if (!path.startsWith("/")) path = `/${path}`;
  if (!/\.(?:jpe?g|png|webp)$/i.test(path)) return undefined;
  if (/noimg/i.test(path)) return undefined;
  return `${LOTTE_AUTOGLOBAL_IMG_BASE}${path}`;
}

function photosFromPaths(paths: string[]): NormalizedPhoto[] {
  const seen = new Set<string>();
  const out: NormalizedPhoto[] = [];
  for (const raw of paths) {
    const url = lotteRawPhotoUrl(raw);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ sourceUrl: url, isPrimary: out.length === 0, sortOrder: out.length });
    if (out.length >= 40) break;
  }
  return out;
}

function imagesForGd(gdId: string, imgList: LotteImg[], row?: LotteRow): string[] {
  const fromList = imgList
    .filter((img) => String(img.gdId ?? "") === gdId)
    .map((img) => `${String(img.afilePath ?? "").replace(/\/?$/, "/")}${String(img.regFileNm ?? "")}`);
  if (fromList.length > 0) return fromList;
  const thumb = row?.imgPath1 != null ? String(row.imgPath1) : "";
  return thumb ? [thumb] : [];
}

function lotteMileage(row: LotteRow): number | undefined {
  const raw = row.drgMil ?? row.drg_mil ?? row.mileage;
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 1) return Math.round(raw);
  return parseKm(raw != null ? String(raw) : undefined);
}

/** Guest AJAX often returns `****` for USD amounts; ignore masks. */
function lottePrice(row: LotteRow): number | undefined {
  for (const key of ["dcCarAmt", "carAmt", "searchCarAmt"] as const) {
    const raw = row[key];
    if (raw == null) continue;
    const s = String(raw).trim();
    if (!s || /\*/.test(s)) continue;
    const n = parseMoney(s);
    if (n != null) return n;
  }
  return undefined;
}

/**
 * Lotte `clsNo` is the chassis/VIN. Some KR export lots use a letter in the
 * ISO check-digit position; still accept 17-char chassis that aren't garbage.
 */
function normalizeLotteChassis(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const clean = String(raw).toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (clean.length !== 17) return undefined;
  if (/^\d+$/.test(clean)) return undefined;
  if (/^(.)\1{16}$/.test(clean)) return undefined;
  if (/(\d)\1{8,}$/.test(clean)) return undefined;
  return normalizeKrVin(clean) ?? clean;
}

function lotteVin(row: LotteRow): string | undefined {
  return normalizeLotteChassis(String(row.clsNo ?? row.vin ?? ""));
}

function lotteSold(row: LotteRow): boolean {
  return String(row.buyYn ?? "").toUpperCase() === "Y";
}

async function lotteAjax(params: Record<string, string>): Promise<{
  rows: LotteRow[];
  images: LotteImg[];
  totalPages: number;
  totalRecords: number;
  currentPage: number;
}> {
  const body = new URLSearchParams({
    viewMode: "moca",
    pageUnit: String(PAGE_SIZE),
    ...params,
  });
  const cookie = process.env.LOTTE_AUTOGLOBAL_COOKIE?.trim();
  const fetched = await krFetch(LOTTE_AUTOGLOBAL_AJAX, {
    method: "POST",
    body,
    contentType: "application/x-www-form-urlencoded; charset=UTF-8",
    accept: "application/json, text/javascript, */*; q=0.01",
    referer: LOTTE_AUTOGLOBAL_LIST_REFERER,
    headers: {
      Origin: LOTTE_AUTOGLOBAL_WEB_BASE,
      "X-Requested-With": "XMLHttpRequest",
      ...(cookie ? { Cookie: cookie } : {}),
    },
  });
  let json: {
    resultList?: LotteRow[];
    resultImgList?: LotteImg[];
    paginationInfo?: {
      totalPageCount?: number;
      totalRecordCount?: number;
      currentPageNo?: number;
    };
  };
  try {
    json = JSON.parse(fetched.text) as typeof json;
  } catch {
    throw new KrRequestError(fetched.status, "Lotte AJAX returned non-JSON", LOTTE_AUTOGLOBAL_AJAX);
  }
  const rows = Array.isArray(json.resultList) ? json.resultList : [];
  const images = Array.isArray(json.resultImgList) ? json.resultImgList : [];
  const totalPages = Number(json.paginationInfo?.totalPageCount ?? 0) || (rows.length > 0 ? 1 : 0);
  const totalRecords = Number(json.paginationInfo?.totalRecordCount ?? rows.length) || 0;
  const currentPage = Number(json.paginationInfo?.currentPageNo ?? params.pageIndex ?? 1) || 1;
  return { rows, images, totalPages, totalRecords, currentPage };
}

export class LotteAutoglobalHistoricalAdapter extends KrHtmlAdapter {
  readonly internalName = "lotte_autoglobal";
  private listCache = new Map<string, LotteCacheEntry>();

  private remember(row: LotteRow, imgList: LotteImg[]): string | undefined {
    const gdId = row.gdId != null ? String(row.gdId).trim() : "";
    if (!gdId) return undefined;
    this.listCache.set(gdId, {
      row,
      images: imagesForGd(gdId, imgList, row),
    });
    return gdId;
  }

  async discoverListings(page: number): Promise<KrDiscoverResult> {
    const { rows, images, totalPages, currentPage } = await lotteAjax({
      pageIndex: String(Math.max(1, page)),
    });

    const listings: ListingReference[] = [];
    for (const row of rows) {
      const gdId = this.remember(row, images);
      if (!gdId) continue;
      const vin = lotteVin(row);
      listings.push({
        sourceId: gdId,
        url: lotteDetailUrl(gdId, vin),
        metadata: { ...row, _lotteImages: imagesForGd(gdId, images, row) },
      });
    }

    return {
      listings,
      pagination: {
        currentPage,
        totalPages: totalPages || undefined,
        hasMore: listings.length > 0 && currentPage < totalPages,
      },
    };
  }

  protected extractSourceId(url: string): string | undefined {
    return (
      url.match(/\/car\/gd\/(?:BY\/)?([^/?#]+)/i)?.[1] ??
      url.match(/[?&](?:gdId|goodsNo)=([^&]+)/i)?.[1]
    );
  }

  private extractClsNo(url: string): string | undefined {
    return normalizeLotteChassis(url.match(/[?&]clsNo=([^&]+)/i)?.[1]);
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return normalizeLotteChassis(listing.vehicle?.vin);
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const gdId = this.extractSourceId(url);
    const cached = gdId ? this.listCache.get(gdId) : undefined;
    if (cached) {
      return {
        url: lotteDetailUrl(gdId!, lotteVin(cached.row)),
        html: JSON.stringify({ data: cached.row, images: cached.images }),
        json: { data: cached.row, images: cached.images },
        statusCode: 200,
        headers: {},
        metadata: cached.row,
      };
    }

    const clsNo = this.extractClsNo(url);
    if (clsNo) {
      const { rows, images } = await lotteAjax({
        pageIndex: "1",
        search_clsNo: clsNo,
      });
      const row =
        rows.find((r) => String(r.gdId ?? "") === gdId) ??
        rows.find((r) => lotteVin(r) === clsNo) ??
        rows[0];
      if (!row) {
        throw new KrRequestError(404, `Lotte lot not found for VIN ${clsNo}`, url);
      }
      const id = this.remember(row, images) ?? String(row.gdId ?? gdId ?? "");
      const entry = this.listCache.get(id);
      if (!entry) {
        throw new KrRequestError(404, `Lotte lot cache miss after lookup ${id}`, url);
      }
      return {
        url: lotteDetailUrl(id, lotteVin(entry.row)),
        html: JSON.stringify({ data: entry.row, images: entry.images }),
        json: { data: entry.row, images: entry.images },
        statusCode: 200,
        headers: {},
        metadata: entry.row,
      };
    }

    throw new KrRequestError(
      404,
      `Lotte listing ${gdId ?? url} not in list cache and no clsNo for lookup`,
      url,
    );
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const json = fetched.json as { data?: LotteRow; images?: string[] } | undefined;
    const row = (json?.data ?? fetched.metadata ?? {}) as LotteRow;
    const sourceId =
      (row.gdId != null ? String(row.gdId) : undefined) ??
      this.extractSourceId(fetched.url) ??
      "unknown";

    const vin = lotteVin(row);
    const mileage = lotteMileage(row);
    const year =
      parseYear(row.mnfYear != null ? String(row.mnfYear) : undefined) ??
      parseYear(row.modelYear != null ? String(row.modelYear) : undefined) ??
      parseYear(row.carNm != null ? String(row.carNm) : undefined);

    const make = row.mcmpNm != null ? String(row.mcmpNm).trim() : undefined;
    const model = row.modelNm != null ? String(row.modelNm).trim() : undefined;
    const trim = row.gradNm != null ? String(row.gradNm).trim() : undefined;
    const title =
      (row.carNm != null ? String(row.carNm).replace(/\s+/g, " ").trim() : "") ||
      [year, make, model, trim].filter(Boolean).join(" ") ||
      sourceId;

    const dpm = row.dpmVal != null ? Number(row.dpmVal) : undefined;
    const vehicle = vehicleFromParts({
      vin,
      make,
      model,
      trim,
      year,
      fuelType: row.gasSeNm != null ? String(row.gasSeNm) : undefined,
      transmission: row.trmsSeValNm != null ? String(row.trmsSeValNm) : undefined,
      bodyType: row.mocaCdNm != null ? String(row.mocaCdNm) : undefined,
      driveType: row.drsyValNm != null ? String(row.drsyValNm) : undefined,
      engineDisplacement: dpm != null && dpm > 0 ? String(dpm) : undefined,
      color: row.extClrCdNm != null ? String(row.extClrCdNm) : undefined,
      country: "KR",
    });

    const metaImages = Array.isArray((fetched.metadata as { _lotteImages?: string[] } | undefined)?._lotteImages)
      ? (fetched.metadata as { _lotteImages: string[] })._lotteImages
      : [];
    const jsonImages = Array.isArray(json?.images) ? json.images : [];
    const thumb = row.imgPath1 != null ? [String(row.imgPath1)] : [];
    const photos = photosFromPaths([...jsonImages, ...metaImages, ...thumb]);

    return usdListing({
      sourceId,
      sourceUrl: lotteDetailUrl(sourceId, vin),
      title,
      price: lottePrice(row),
      mileage,
      sold: lotteSold(row),
      vehicle,
      photos,
      sourceListedAt: parseYmd(row.gdRegDe != null ? String(row.gdRegDe) : undefined),
      sourceModifiedAt: parseYmd(row.gdRegDe != null ? String(row.gdRegDe) : undefined),
    });
  }
}
