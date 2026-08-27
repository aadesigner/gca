/**
 * Encar Historical Adapter
 *
 * Collects import vehicle listings from Encar (www.encar.com) via the public
 * JSON API at api.encar.com — no AMS Auto proxy.
 */

import type {
  ProviderAdapter,
  ListingReference,
  FetchedListing,
  NormalizedListing,
  NormalizedVehicle,
  NormalizedPhoto,
  PaginationInfo,
  SourceMetadata,
} from "@workspace/providers";
import {
  extractEncarCounts,
  extractEncarEvents,
  type EncarAggregatedPayload,
} from "./encar-history";
import {
  extractEncarSourceModifiedAt,
  extractEncarSourceListedAt,
  parseEncarDateTime,
  sanitizeEncarAggregatedPayload,
} from "./encar-sanitize";
import {
  normalizeEncarBody,
  normalizeEncarColor,
  normalizeEncarFuel,
  normalizeEncarLocation,
  normalizeEncarTextField,
  normalizeEncarTransmission,
} from "./encar-locale";
import { collectPhotoUrls } from "./encar-photos";
import { SOUTH_KOREA } from "../geo";
import {
  buildEncarHeaders,
  configureEncarHttp,
  encarFetch,
  EncarRequestError,
  type EncarEndpointKind,
} from "./encar-http";
import {
  encarSearchFuel,
  encarSearchLocation,
  encarSearchManufacturer,
  encarSearchModelGroup,
  encarSearchTransmission,
  forceEnglish,
  krwToEncarPriceMan,
  extractEncarAdvertisementFields,
  normalizeEncarListedPrice,
  normalizeEncarListingActivity,
  translateEncarMake,
  translateEncarModel,
} from "./encar-catalog";

export const PARSER_VERSION = "encar-v3.0.0";

const API_BASE = "https://api.encar.com";
export const DETAIL_WEB_BASE = "https://fem.encar.com";
const DEFAULT_PAGE_SIZE = 50;
const MAX_BODY_BYTES = 16 * 1024 * 1024;

export interface EncarFilterParams {
  brand?: string;
  /** Encar model group, e.g. "5시리즈" */
  modelGroup?: string;
  model?: string;
  /** Encar badge/trim group, e.g. "디젤 2WD" */
  badgeGroup?: string;
  yearFrom?: number;
  yearTo?: number;
  fuel?: string;
  transmission?: string;
  minPrice?: number;
  maxPrice?: number;
  minMileage?: number;
  maxMileage?: number;
  /** Displacement in cc. */
  minDisplacement?: number;
  maxDisplacement?: number;
  location?: string;
  /** import (default) | domestic | all */
  carType?: "import" | "domestic" | "all";
  /** YYYYMM inclusive bounds, used when year shards are split past Encar's search window. */
  yearMonthFrom?: number;
  yearMonthTo?: number;
  /** Encar sort key, e.g. MobilePriceAsc, ModifiedDate */
  sort?: string;
  /** Raw Encar action query — paste from m.encar.com search URL hash */
  searchQuery?: string;
  maxPages?: number;
  maxListings?: number;
  delayMs?: number;
  concurrency?: number;
  retryCount?: number;
  pageSize?: number;
  /** Skip detail fetch if listing was collected within this many hours (0 = never skip). */
  skipRecentHours?: number;
  /** full = all readside endpoints; standard = detail+view+record (faster bulk jobs). */
  detailLevel?: "full" | "standard";
  /** Shared cap on concurrent Encar HTTP requests (default 4). */
  maxEncarConcurrency?: number;
  /** Minimum gap between Encar HTTP requests in ms (default 150). */
  minGapMs?: number;
  /** Per-request timeout in ms (default 60000). */
  requestTimeoutMs?: number;
  /** live = reserved interactive lane; bulk = shared crawler limiter. */
  requestPriority?: "live" | "bulk";
}

interface EncarSearchResult {
  Id: string;
  Manufacturer?: string;
  Model?: string;
  Badge?: string;
  Year?: number;
  FormYear?: string;
  Mileage?: number;
  Price?: number;
  FuelType?: string;
  OfficeCityState?: string;
  Photos?: Array<{ location?: string; ordering?: number }>;
}

interface EncarSearchResponse {
  Count?: number;
  SearchResults?: EncarSearchResult[];
}

interface EncarDetailResponse {
  vin?: string;
  vehicleNo?: string;
  category?: {
    manufacturerName?: string;
    manufacturerEnglishName?: string;
    modelName?: string;
    modelGroupEnglishName?: string;
    gradeName?: string;
    gradeEnglishName?: string;
    formYear?: string;
    yearMonth?: string;
    importType?: string;
    originPrice?: number;
  };
  advertisement?: {
    price?: number;
    status?: string;
    salesStatus?: string | null;
  };
  spec?: {
    mileage?: number;
    fuelCd?: string;
    fuelName?: string;
    transmissionName?: string;
    bodyName?: string;
    colorName?: string;
    displacement?: number;
  };
  contact?: {
    address?: string;
  };
  photos?: Array<{ path?: string; location?: string; url?: string; type?: string; code?: string; updateDateTime?: string }>;
  condition?: {
    accident?: { recordView?: boolean; resumeView?: boolean };
  };
}

export class EncarHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "encar";

  private webBaseUrl: string;
  private filters: EncarFilterParams;
  constructor(webBaseUrl = DETAIL_WEB_BASE, filters: EncarFilterParams = {}) {
    this.webBaseUrl = webBaseUrl.replace(/\/$/, "");
    this.filters = filters;
    if (
      filters.requestPriority !== "live" &&
      (filters.maxEncarConcurrency != null || filters.minGapMs != null)
    ) {
      configureEncarHttp({
        maxConcurrent: filters.maxEncarConcurrency,
        minGapMs: filters.minGapMs,
      });
    }
  }

  async discoverListings(
    page: number,
    _options?: Record<string, unknown>,
  ): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const pageSize = this.filters.pageSize ?? DEFAULT_PAGE_SIZE;
    const offset = (page - 1) * pageSize;
    const url = this.buildSearchUrl(offset, pageSize);
    const fetched = await this.fetchJson(url);
    const data = (fetched.json ?? {}) as EncarSearchResponse;
    const results = data.SearchResults ?? [];
    const total = data.Count ?? 0;

    const listings: ListingReference[] = results.map((item) => ({
      sourceId: String(item.Id),
      url: this.buildDetailUrl(item.Id),
      metadata: {
        title: [forceEnglish(item.Manufacturer), forceEnglish(item.Model), forceEnglish(item.Badge)]
          .filter(Boolean)
          .join(" "),
        price: item.Price,
        mileage: item.Mileage,
        year: item.FormYear ?? item.Year,
      },
    }));

    return {
      listings,
      pagination: {
        currentPage: page,
        totalPages: total > 0 ? Math.ceil(total / pageSize) : undefined,
        hasMore: offset + results.length < total && results.length > 0,
      },
    };
  }

  /** Raw Encar search page — used by the live feed adapter. */
  async searchResults(
    page: number,
    pageSize?: number,
  ): Promise<{ results: EncarSearchResult[]; total: number }> {
    const ps = pageSize ?? this.filters.pageSize ?? DEFAULT_PAGE_SIZE;
    const offset = (page - 1) * ps;
    const url = this.buildSearchUrl(offset, ps);
    const fetched = await this.fetchJson(url);
    const data = (fetched.json ?? {}) as EncarSearchResponse;
    return { results: data.SearchResults ?? [], total: data.Count ?? 0 };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const listingId = this.extractCarIdFromUrl(url);
    if (!listingId) {
      throw new Error(`Could not extract Encar car ID from URL: ${url}`);
    }

    const detailLevel = this.filters.detailLevel ?? "full";

    const detail = await this.fetchJson(this.buildDetailApiUrl(listingId), listingId);
    if (detail.statusCode === 404 || !detail.json) {
      throw new Error(`Encar listing not found: ${listingId}`);
    }
    const view = await this.fetchOptionalJson(
      `${API_BASE}/v1/readside/vehicle/${listingId}/view`,
      listingId,
    );
    const vehicleId = String(
      (view as Record<string, unknown> | null)?.vehicleId ?? listingId,
    );

    let diagnosis: Record<string, unknown> | null = null;
    let inspection: Record<string, unknown> | null = null;
    let record: Record<string, unknown> | null = null;

    if (detailLevel === "full") {
      [diagnosis, inspection, record] = await Promise.all([
        this.fetchOptionalJson(`${API_BASE}/v1/readside/diagnosis/vehicle/${vehicleId}`, listingId),
        this.fetchOptionalJson(`${API_BASE}/v1/readside/inspection/vehicle/${vehicleId}`, listingId),
        this.fetchOptionalJson(`${API_BASE}/v1/readside/record/vehicle/${vehicleId}/open`, listingId),
      ]);
    } else {
      record = await this.fetchOptionalJson(
        `${API_BASE}/v1/readside/record/vehicle/${vehicleId}/open`,
        listingId,
      );
    }

    const aggregated: EncarAggregatedPayload = {
      listingId,
      vehicleId,
      detail: detail.json as Record<string, unknown>,
      view: view as Record<string, unknown> | null,
      diagnosis: diagnosis as Record<string, unknown> | null,
      inspection: inspection as Record<string, unknown> | null,
      record: record as Record<string, unknown> | null,
    };

    const cleaned = sanitizeEncarAggregatedPayload(
      aggregated,
      new Date(),
      this.filters.detailLevel === "standard" ? "standard" : "full",
    );
    const html = JSON.stringify(cleaned);
    return {
      url: detail.url,
      html,
      json: cleaned,
      statusCode: detail.statusCode,
      headers: detail.headers,
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const sourceId = this.extractCarIdFromUrl(fetched.url) ?? "unknown";
    const payload = this.normalizePayload(fetched.json);
    const data = (payload.detail ?? fetched.json ?? {}) as EncarDetailResponse;
    const view = payload.view as EncarDetailResponse | null | undefined;

    if (!data.category && !data.spec) {
      return { sourceId, sourceUrl: fetched.url };
    }

    const category = { ...(view?.category ?? {}), ...(data.category ?? {}) };
    const spec = { ...(view?.spec ?? {}), ...(data.spec ?? {}) };
    const contact = data.contact ?? view?.contact;
    const adFields = extractEncarAdvertisementFields({ detail: data, view });
    const listed = normalizeEncarListedPrice(adFields.price);
    const priceAmount = listed.onRequest ? undefined : listed.krw;
    const activity = normalizeEncarListingActivity(adFields.status);

    const year =
      category.formYear != null
        ? parseInt(String(category.formYear), 10)
        : category.yearMonth
          ? parseInt(String(category.yearMonth).slice(0, 4), 10)
          : undefined;

    const make = forceEnglish(
      category.manufacturerEnglishName ??
        translateEncarMake(category.manufacturerName) ??
        category.manufacturerName,
    );
    const model = forceEnglish(
      category.modelGroupEnglishName ??
        translateEncarModel(category.modelName) ??
        category.modelName,
    );
    const trim = forceEnglish(
      category.gradeEnglishName ?? translateEncarModel(category.gradeName) ?? category.gradeName,
    );
    const title = [make, model, trim, year].filter(Boolean).join(" ");

    const vinSource = data.vin ?? view?.vin;
    const vin = typeof vinSource === "string" ? this.normalizeVin(vinSource) : undefined;

    const vehicle: NormalizedVehicle = {
      vin,
      make,
      model,
      trim,
      year: Number.isFinite(year) ? year : undefined,
      fuelType: normalizeEncarFuel(spec),
      transmission: normalizeEncarTransmission(spec.transmissionName),
      bodyType: normalizeEncarBody(spec.bodyName),
      color: normalizeEncarColor(spec.colorName),
      driveType: this.inferDriveType(trim),
      engineDisplacement:
        typeof spec.displacement === "number" ? String(spec.displacement) : undefined,
      country: SOUTH_KOREA,
    };

    const photos = this.extractPhotosFromDetail({
      photos: [...(data.photos ?? []), ...(view?.photos ?? [])],
    });
    const counts = extractEncarCounts(payload);
    const events = extractEncarEvents(payload);
    const sourceModifiedAt = extractEncarSourceModifiedAt(payload);
    const sourceListedAt = extractEncarSourceListedAt(payload);
    const soldAt =
      activity.listingStatus === "sold"
        ? parseEncarDateTime(adFields.soldDate) ?? sourceModifiedAt
        : undefined;

    return {
      sourceId,
      sourceUrl: this.buildDetailUrl(sourceId),
      title: title || undefined,
      priceAmount,
      priceCurrency: "KRW",
      mileage: spec.mileage,
      mileageUnit: "km",
      location: normalizeEncarLocation(contact?.address),
      country: SOUTH_KOREA,
      isActive: activity.isActive,
      listingStatus: activity.listingStatus,
      soldAt,
      accidentCount: counts.accidentCount,
      ownerChangeCount: counts.ownerChangeCount,
      sourceListedAt,
      sourceModifiedAt,
      events,
      vehicle,
      photos,
    };
  }

  async normalizeVehicle(listing: NormalizedListing): Promise<NormalizedVehicle> {
    const raw = listing.vehicle ?? {};
    return {
      ...raw,
      fuelType: normalizeEncarTextField("fuelType", raw.fuelType),
      transmission: normalizeEncarTextField("transmission", raw.transmission),
      bodyType: normalizeEncarTextField("bodyType", raw.bodyType),
      color: normalizeEncarTextField("color", raw.color),
    };
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    if (listing.vehicle?.vin) {
      return this.normalizeVin(listing.vehicle.vin);
    }
    return undefined;
  }

  extractPhotos(listing: NormalizedListing): NormalizedPhoto[] {
    return listing.photos ?? [];
  }

  getPagination(_fetched: FetchedListing): PaginationInfo {
    return { currentPage: 1, hasMore: false };
  }

  getSourceMetadata(fetched: FetchedListing): SourceMetadata {
    return {
      collectedAt: new Date(),
      rawHtml: fetched.html,
    };
  }

  // ---------------------------------------------------------------------------
  // Encar API helpers
  // ---------------------------------------------------------------------------

  private buildSearchQuery(): string {
    if (this.filters.searchQuery?.trim()) {
      return this.filters.searchQuery.trim();
    }

    const parts: string[] = [
      "Hidden.N.",
      "MultiViewHidden.N.",
      "(Or.Separation.F._.Separation.B.)",
      "SellType.일반.",
    ];

    const fuel = encarSearchFuel(this.filters.fuel);
    if (fuel) parts.push(`FuelType.${fuel}.`);

    const transmission = encarSearchTransmission(this.filters.transmission);
    if (transmission) parts.push(`Transmission.${transmission}.`);

    const location = encarSearchLocation(this.filters.location);
    if (location) parts.push(`OfficeCityState.${location}.`);

    const priceRange = this.buildPriceRange();
    if (priceRange) parts.push(`${priceRange}.`);

    parts.push(this.buildCarNest());

    const mileageRange = this.buildMileageRange();
    if (mileageRange) parts.push(`${mileageRange}.`);

    const displacementRange = this.buildDisplacementRange();
    if (displacementRange) parts.push(`${displacementRange}.`);

    const yearRange = this.buildYearRange();
    if (yearRange) parts.push(`${yearRange}.`);

    return `(And.${parts.join("_.")})`;
  }

  /**
   * Encar nested search: innermost field is a leaf (`Manufacturer.BMW.`),
   * parents wrap with `(C.Parent._.child)`. Empty CarType nest must stay a
   * leaf (`CarType.N.`) — `(C.CarType.N._.)` is a 400.
   */
  private buildCarNest(): string {
    const carType = this.filters.carType ?? "import";
    const typeToken = carType === "domestic" ? "Y" : carType === "all" ? "A" : "N";

    const nestField = (name: string, value: string | undefined, inner: string): string => {
      if (!value) return inner;
      if (!inner) return `${name}.${value}.`;
      return `(C.${name}.${value}._.${inner})`;
    };

    let nest = "";
    nest = nestField("BadgeGroup", this.filters.badgeGroup, nest);
    nest = nestField("Model", this.filters.model, nest);
    nest = nestField("ModelGroup", encarSearchModelGroup(this.filters.modelGroup) ?? this.filters.modelGroup, nest);
    nest = nestField("Manufacturer", encarSearchManufacturer(this.filters.brand), nest);
    return nestField("CarType", typeToken, nest);
  }

  private buildPriceRange(): string | null {
    const min = krwToEncarPriceMan(this.filters.minPrice);
    const max = krwToEncarPriceMan(this.filters.maxPrice);
    if (min == null && max == null) return null;
    if (min != null && max != null) return `Price.range(${min}..${max})`;
    if (max != null) return `Price.range(..${max})`;
    return `Price.range(${min}..)`;
  }

  private buildMileageRange(): string | null {
    const { minMileage, maxMileage } = this.filters;
    if (minMileage == null && maxMileage == null) return null;
    if (minMileage != null && maxMileage != null) {
      return `Mileage.range(${minMileage}..${maxMileage})`;
    }
    if (maxMileage != null) return `Mileage.range(..${maxMileage})`;
    return `Mileage.range(${minMileage}..)`;
  }

  private buildDisplacementRange(): string | null {
    const { minDisplacement, maxDisplacement } = this.filters;
    if (minDisplacement == null && maxDisplacement == null) return null;
    if (minDisplacement != null && maxDisplacement != null) {
      return `Displacement.range(${minDisplacement}..${maxDisplacement})`;
    }
    if (maxDisplacement != null) return `Displacement.range(..${maxDisplacement})`;
    return `Displacement.range(${minDisplacement}..)`;
  }

  private buildYearRange(): string | null {
    const { yearFrom, yearTo, yearMonthFrom, yearMonthTo } = this.filters;
    if (yearMonthFrom != null || yearMonthTo != null) {
      const from = yearMonthFrom ?? (yearFrom ?? 1900) * 100;
      const to = yearMonthTo ?? (yearTo ?? new Date().getUTCFullYear()) * 100 + 99;
      return `Year.range(${from}..${to})`;
    }
    if (yearFrom == null && yearTo == null) return null;
    const from = yearFrom ?? yearTo!;
    const to = yearTo ?? yearFrom!;
    return `Year.range(${from}00..${to}99)`;
  }

  private buildSearchUrl(offset: number, limit: number): string {
    const q = encodeURIComponent(this.buildSearchQuery());
    const sort = this.filters.sort ?? "MobilePriceAsc";
    const sr = encodeURIComponent(`|${sort}|${offset}|${limit}`);
    return `${API_BASE}/search/car/list/general?count=true&q=${q}&sr=${sr}`;
  }

  private buildDetailUrl(carId: string): string {
    return `${DETAIL_WEB_BASE}/cars/detail/${carId}`;
  }

  private buildDetailApiUrl(carId: string): string {
    const include =
      "ADVERTISEMENT,CATEGORY,CONDITION,CONTACT,MANAGE,OPTIONS,PHOTOS,PRICE,SPEC,VIEW";
    return `${API_BASE}/v1/readside/vehicle/${carId}?include=${include}`;
  }

  private extractCarIdFromUrl(url: string): string | undefined {
    const caridParam = url.match(/[?&]carid=(\d+)/i);
    if (caridParam) return caridParam[1];
    const detailPath = url.match(/\/cars\/detail\/(\d+)/i);
    if (detailPath) return detailPath[1];
    const pathMatch = url.match(/\/(\d{6,})(?:[/?]|$)/);
    return pathMatch?.[1];
  }

  private extractPhotosFromDetail(data: EncarDetailResponse): NormalizedPhoto[] {
    return collectPhotoUrls(data.photos).map((sourceUrl, index) => ({
      sourceUrl,
      isPrimary: index === 0,
      sortOrder: index,
    }));
  }

  private normalizeVin(raw: string): string | undefined {
    const clean = raw.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
    if (clean.length !== 17) return undefined;
    const pos9 = clean[8];
    if (!/[0-9X]/.test(pos9)) return undefined;
    if (this.isPlaceholderVin(clean)) return undefined;
    return clean;
  }

  /** Encar returns dummy/redacted VINs when the seller hides the real one. */
  private isPlaceholderVin(vin: string): boolean {
    // e.g. 11111111111111111
    if (/^(.)\1{16}$/.test(vin)) return true;
    // e.g. WDDWF8AB111111111 — prefix kept, suffix redacted with repeated digits
    if (/(\d)\1{8,}$/.test(vin)) return true;
    return false;
  }

  private normalizePayload(json: unknown): EncarAggregatedPayload {
    if (!json || typeof json !== "object") return {};
    const payload = json as EncarAggregatedPayload;
    if (payload.detail) return payload;
    return { detail: json as Record<string, unknown> };
  }

  private inferDriveType(trim?: string): string | undefined {
    if (!trim) return undefined;
    const upper = trim.toUpperCase();
    if (upper.includes("AWD") || upper.includes("4WD") || upper.includes("XDR") || upper.includes("XDRIVE") || upper.includes("ALL4")) {
      return "AWD";
    }
    if (upper.includes("2WD") || upper.includes("RWD") || upper.includes("FR")) return "RWD";
    return undefined;
  }

  private async fetchOptionalJson(
    url: string,
    refererListingId?: string,
  ): Promise<Record<string, unknown> | null> {
    try {
      const fetched = await this.fetchJson(url, refererListingId, 0);
      if (fetched.statusCode === 404) return null;
      return (fetched.json as Record<string, unknown>) ?? null;
    } catch {
      return null;
    }
  }

  private endpointForUrl(url: string): EncarEndpointKind {
    if (url.includes("/search/car/list/")) return "search";
    if (url.includes("/v1/readside/vehicle/") && url.includes("/view")) return "detail_view";
    if (url.includes("/v1/readside/record/vehicle/")) return "detail_record";
    if (url.includes("/v1/readside/inspection/vehicle/")) return "detail_inspection";
    if (url.includes("/v1/readside/diagnosis/vehicle/")) return "detail_diagnosis";
    if (url.includes("/v1/readside/vehicle/")) return "detail";
    return "detail_other";
  }

  private async fetchJson(url: string, refererListingId?: string, retries?: number): Promise<FetchedListing> {
    const maxRetries = retries ?? this.filters.retryCount ?? 3;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(Math.pow(2, attempt - 1) * (this.filters.delayMs ?? 1000));
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.filters.requestTimeoutMs ?? 60_000);
        const endpoint = this.endpointForUrl(url);
        const { fingerprint, headers } = buildEncarHeaders({
          endpoint,
          refererListingId,
        });

        const response = await encarFetch(url, {
          signal: controller.signal,
          redirect: "error",
          headers,
        }, {
          endpoint,
          fingerprintId: fingerprint.id,
          priority: this.filters.requestPriority === "live" ? "live" : "bulk",
        });

        clearTimeout(timeout);

        if (response.status === 404) {
          return {
            url,
            html: "",
            json: null,
            statusCode: 404,
            headers: {},
          };
        }

        const contentLength = Number(response.headers.get("content-length") ?? 0);
        if (contentLength > MAX_BODY_BYTES) {
          throw new Error(`Response too large: ${contentLength} bytes`);
        }

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_BODY_BYTES) {
          throw new Error(`Response body too large: ${buffer.byteLength} bytes`);
        }

        const text = new TextDecoder().decode(buffer);
        if (!response.ok) {
          if ((response.status === 403 || response.status === 407 || response.status === 429 || response.status === 503) && attempt < maxRetries) {
            const retryAfter = Number(response.headers.get("retry-after"));
            const waitMs =
              Number.isFinite(retryAfter) && retryAfter > 0
                ? retryAfter * 1000
                : response.status === 403 || response.status === 407
                  ? Math.min(60_000, 8_000 * Math.pow(2, attempt))
                  : Math.min(30_000, 4_000 * Math.pow(2, attempt));
            await sleep(waitMs);
            continue;
          }
          const preview = text.slice(0, 180).replace(/\s+/g, " ").trim();
          throw new EncarRequestError(
            {
              category:
                response.status === 403 || response.status === 407
                  ? "hard_block"
                  : response.status === 429 || response.status === 503
                    ? "rate_limit"
                    : "upstream",
              endpoint,
              url,
              statusCode: response.status,
              fingerprintId: fingerprint.id,
              message:
            `Encar HTTP ${response.status} from ${url}${preview ? `: ${preview}` : " (empty body)"}`,
            },
          );
        }

        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          const preview = text.slice(0, 180).replace(/\s+/g, " ").trim();
          throw new EncarRequestError(
            {
              category: "malformed",
              endpoint,
              url,
              statusCode: response.status,
              fingerprintId: fingerprint.id,
              message: `Non-JSON response (${response.status}) from ${url}${preview ? `: ${preview}` : ""}`,
            },
          );
        }

        const responseHeaders: Record<string, string> = {};
        response.headers.forEach((value, key) => {
          responseHeaders[key] = value;
        });

        return {
          url,
          html: text,
          json,
          statusCode: response.status,
          headers: responseHeaders,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (lastError instanceof EncarRequestError) {
          if ((lastError.info.category === "hard_block" || lastError.info.category === "rate_limit" || lastError.info.category === "timeout" || lastError.info.category === "transport") && attempt < maxRetries) {
            continue;
          }
        }
        if (attempt < maxRetries) continue;
      }
    }

    throw lastError ?? new Error(`Failed to fetch ${url}`);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
