/**
 * Autowini historical adapter.
 *
 * Used-car search: https://v2api.autowini.com/items/cars?condition=C020
 * Persist is VIN-only (pipeline). Search payloads already include VIN when Autowini has it.
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
import { SOUTH_KOREA } from "../geo";
import {
  AUTWINI_USED_CONDITION,
  AUTWINI_WEB_BASE,
  autowiniFetchDetail,
  autowiniSearchCars,
  resolveAutowiniFuelCode,
  resolveAutowiniMakeCode,
  resolveAutowiniSubModelCode,
  type AutowiniDetailItem,
  type AutowiniSearchItem,
  type AutowiniSearchParams,
} from "./autowini-http";
import {
  autowiniListingStatus,
  autowiniLocation,
  autowiniMileage,
  autowiniPrice,
  collectAutowiniPhotos,
  extractAutowiniEvents,
  normalizeAutowiniBody,
  normalizeAutowiniDrive,
  normalizeAutowiniFuel,
  normalizeAutowiniMake,
  normalizeAutowiniTransmission,
  pickAutowiniColor,
} from "./autowini-normalize";
import { listedAtFromAutowiniItemCode } from "./listing-dates";

export const AUTWINI_PARSER_VERSION = "autowini-v1.1.1";
const DEFAULT_PAGE_SIZE = 40;

export interface AutowiniFilterParams {
  brand?: string;
  make?: string;
  model?: string;
  modelGroup?: string;
  subModel?: string;
  yearFrom?: number;
  yearTo?: number;
  fuel?: string;
  minPrice?: number;
  maxPrice?: number;
  minMileage?: number;
  maxMileage?: number;
  location?: string;
    keyword?: string;
  sorting?: string;
  sort?: string;
  condition?: string;
  itemType?: string;
  maxPages?: number;
  maxListings?: number;
  delayMs?: number;
  concurrency?: number;
  retryCount?: number;
  pageSize?: number;
  skipRecentHours?: number;
}

function normalizeVin(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const clean = raw.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (clean.length !== 17) return undefined;
  if (/^(.)\1{16}$/.test(clean)) return undefined;
  return clean;
}

function encodeListingUrl(raw: string): string {
  try {
    return encodeURI(raw);
  } catch {
    return raw;
  }
}

function listingWebUrl(item: AutowiniSearchItem | AutowiniDetailItem, listingId: string): string {
  const detailUrl = item.detailUrl;
  if (detailUrl?.startsWith("http")) return encodeListingUrl(detailUrl);
  if (detailUrl?.startsWith("/")) return encodeListingUrl(`${AUTWINI_WEB_BASE}${detailUrl}`);
  return encodeListingUrl(`${AUTWINI_WEB_BASE}/items/${listingId}`);
}

function extractListingId(url: string): string | undefined {
  const match = url.match(/\b(IC\d+)\b/i);
  return match?.[1]?.toUpperCase();
}

export class AutowiniHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "autowini";
  private filters: AutowiniFilterParams;
  private searchCache = new Map<string, AutowiniSearchItem>();
  private resolvedCodes: { make?: string; subModel?: string; fuel?: string } | null = null;

  constructor(_webBaseUrl?: string, filters: AutowiniFilterParams = {}) {
    this.filters = filters;
  }

  private async searchParams(page: number): Promise<AutowiniSearchParams> {
    if (!this.resolvedCodes) {
      const makeRaw = this.filters.make || this.filters.brand;
      const subRaw = this.filters.subModel || this.filters.modelGroup || this.filters.model;
      const make = await resolveAutowiniMakeCode(makeRaw);
      const subModel = await resolveAutowiniSubModelCode(subRaw, make);
      const fuel = await resolveAutowiniFuelCode(this.filters.fuel);
      this.resolvedCodes = { make, subModel, fuel };
    }
    const pageSize = this.filters.pageSize ?? DEFAULT_PAGE_SIZE;
    return {
      itemType: this.filters.itemType || "cars",
      condition: this.filters.condition || AUTWINI_USED_CONDITION,
      make: this.resolvedCodes.make,
      subModel: this.resolvedCodes.subModel,
      modelYearFrom: this.filters.yearFrom,
      modelYearTo: this.filters.yearTo,
      mileageFrom: this.filters.minMileage,
      mileageTo: this.filters.maxMileage,
      priceFrom: this.filters.minPrice,
      priceTo: this.filters.maxPrice,
      fuelType: this.resolvedCodes.fuel,
      keyword: this.filters.keyword,
      sorting: this.filters.sorting || this.filters.sort,
      pageOffset: page,
      pageSize,
    };
  }

  async discoverListings(
    page: number,
  ): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const params = await this.searchParams(page);
    const pageSize = params.pageSize ?? DEFAULT_PAGE_SIZE;
    const { items, total } = await autowiniSearchCars(params);
    const listings: ListingReference[] = [];
    for (const item of items) {
      const listingId = item.listingId?.toUpperCase();
      if (!listingId) continue;
      this.searchCache.set(listingId, item);
      listings.push({
        sourceId: listingId,
        url: listingWebUrl(item, listingId),
        metadata: {
          title: item.itemName,
          price: item.price,
          mileage: item.mileage,
          year: item.modelYear,
          vin: item.vin,
        },
      });
    }
    const offset = (page - 1) * pageSize;
    return {
      listings,
      pagination: {
        currentPage: page,
        totalPages: total > 0 ? Math.ceil(total / pageSize) : undefined,
        hasMore: offset + items.length < total && items.length > 0,
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const listingId = extractListingId(url);
    if (!listingId) throw new Error(`Could not extract Autowini listing ID from URL: ${url}`);

    let search = this.searchCache.get(listingId);
    if (!search) {
      const recovered = await autowiniSearchCars({
        itemType: "cars",
        condition: this.filters.condition || AUTWINI_USED_CONDITION,
        keyword: listingId,
        pageSize: 5,
      });
      search = recovered.items.find((item) => item.listingId?.toUpperCase() === listingId) ?? recovered.items[0];
      if (search?.listingId) this.searchCache.set(search.listingId.toUpperCase(), search);
    }

    let detail: AutowiniDetailItem | null = null;
    try {
      detail = await autowiniFetchDetail(listingId);
    } catch {
      detail = null;
    }

    const payload = {
      meta: { collectedAt: new Date().toISOString(), detailLevel: "full" as const, provider: "autowini" },
      listingId,
      search: search ?? null,
      detail,
    };
    return {
      url: listingWebUrl(search ?? detail ?? { listingId }, listingId),
      html: JSON.stringify(payload),
      json: payload,
      statusCode: 200,
      headers: {},
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const payload = (fetched.json ?? {}) as {
      listingId?: string;
      search?: AutowiniSearchItem | null;
      detail?: AutowiniDetailItem | null;
    };
    const search = payload.search ?? {};
    const detail = payload.detail ?? {};
    const sourceId =
      payload.listingId ??
      search.listingId ??
      detail.listingId ??
      extractListingId(fetched.url) ??
      "unknown";

    const vin = normalizeVin(search.vin) ?? normalizeVin(detail.vinNumber);
    const make = normalizeAutowiniMake(search.makeName);
    const model = (search.modelName || search.subModelName || detail.modelName)?.trim();
    const trim = search.modelClass?.trim();
    const year = search.modelYear;
    const title =
      search.itemName?.trim() ||
      detail.itemName?.trim() ||
      [year, make, model, trim].filter(Boolean).join(" ");
    const location = autowiniLocation(search, detail);
    const price = autowiniPrice(search, detail);
    const mileage = autowiniMileage(search, detail);
    const photos = collectAutowiniPhotos(search, detail);
    const activity = autowiniListingStatus(search);
    const events = extractAutowiniEvents(search, detail);
    const engineVolume = search.engineVolume ?? detail.engineVolume;
    const sourceListedAt =
      listedAtFromAutowiniItemCode(detail.itemCode) ??
      listedAtFromAutowiniItemCode(search.code) ??
      listedAtFromAutowiniItemCode((detail as { itemCode?: string }).itemCode);

    const vehicle: NormalizedVehicle = {
      vin,
      make,
      model,
      trim,
      year: Number.isFinite(year) ? year : undefined,
      fuelType: normalizeAutowiniFuel(search.fuelType || detail.fuelTypeName),
      transmission: normalizeAutowiniTransmission(detail.transmissionName || search.transmissionType),
      driveType: normalizeAutowiniDrive(detail.driveTypeName || search.drivetrainType),
      bodyType: normalizeAutowiniBody(search.vehicleType),
      engineDisplacement: engineVolume != null ? String(engineVolume) : undefined,
      color: pickAutowiniColor(search, detail),
      country: SOUTH_KOREA,
    };

    return {
      sourceId,
      sourceUrl: fetched.url,
      title,
      priceAmount: price,
      priceCurrency: "USD",
      mileage,
      mileageUnit: "km",
      location,
      country: SOUTH_KOREA,
      isActive: activity.isActive,
      listingStatus: activity.listingStatus,
      sourceListedAt,
      sourceModifiedAt: sourceListedAt,
      events,
      vehicle,
      photos,
    };
  }

  async normalizeVehicle(listing: NormalizedListing): Promise<NormalizedVehicle> {
    return listing.vehicle ?? {};
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin ? normalizeVin(listing.vehicle.vin) : undefined;
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
      rawJson: fetched.html ?? JSON.stringify(fetched.json ?? ""),
    };
  }
}
