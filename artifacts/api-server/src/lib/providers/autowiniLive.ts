/**
 * Autowini live inventory — v2api.autowini.com search.
 * Live feed shows every listing, including those without a VIN.
 */

import type {
  LiveProviderAdapter,
  LiveVehicle,
  LiveVehicleFilter,
  LiveProviderCapabilities,
  LiveProviderCredentials,
  LiveVehicleDetail,
} from "@workspace/providers";
import { SOUTH_KOREA } from "../geo";
import {
  AUTWINI_USED_CONDITION,
  AUTWINI_WEB_BASE,
  autowiniFetchDetail,
  autowiniFetchFilters,
  autowiniFetchSubModels,
  autowiniSearchCars,
  resolveAutowiniMakeCode,
  resolveAutowiniSubModelCode,
  type AutowiniSearchItem,
} from "./autowini-http";
import { AutowiniHistoricalAdapter } from "./autowini";
import {
  autowiniListingStatus,
  autowiniLocation,
  autowiniMileage,
  autowiniPrice,
  collectAutowiniPhotos,
  normalizeAutowiniBody,
  normalizeAutowiniDrive,
  normalizeAutowiniFuel,
  normalizeAutowiniMake,
  normalizeAutowiniTransmission,
  pickAutowiniColor,
} from "./autowini-normalize";
import { matchesEngineRange } from "../engine-size";

function encodeListingUrl(raw: string): string {
  try {
    return encodeURI(raw);
  } catch {
    return raw;
  }
}

function listingUrl(item: AutowiniSearchItem): string {
  if (item.detailUrl?.startsWith("http")) return encodeListingUrl(item.detailUrl);
  if (item.detailUrl?.startsWith("/")) return encodeListingUrl(`${AUTWINI_WEB_BASE}${item.detailUrl}`);
  return encodeListingUrl(`${AUTWINI_WEB_BASE}/items/${item.listingId ?? ""}`);
}

/** Autowini search prices are USD. Ignore leftover Encar KRW chip values. */
function usdPriceBound(value: number | undefined): number | undefined {
  if (value == null || !Number.isFinite(value) || value <= 0) return undefined;
  if (value >= 500_000) return undefined;
  return value;
}

function normalizeVin(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const clean = raw.toUpperCase().replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (clean.length !== 17) return undefined;
  if (/^(.)\1{16}$/.test(clean)) return undefined;
  return clean;
}

export function searchItemToLiveVehicle(item: AutowiniSearchItem): LiveVehicle {
  const listingId = (item.listingId ?? item.code ?? "").toUpperCase();
  const vin = normalizeVin(item.vin);
  const activity = autowiniListingStatus(item);
  return {
    listingId,
    vin,
    make: normalizeAutowiniMake(item.makeName),
    model: item.modelName || item.subModelName,
    modelGroup: item.subModelName,
    badge: item.modelClass,
    trim: item.modelClass,
    year: item.modelYear,
    mileage: autowiniMileage(item, {}),
    price: autowiniPrice(item, {}),
    currency: "USD",
    fuel: normalizeAutowiniFuel(item.fuelType),
    transmission: normalizeAutowiniTransmission(item.transmissionType),
    drivetrain: normalizeAutowiniDrive(item.drivetrainType),
    bodyType: normalizeAutowiniBody(item.vehicleType),
    color: pickAutowiniColor(item, {}),
    engineDisplacement: item.engineVolume != null ? String(item.engineVolume) : undefined,
    location: autowiniLocation(item, {}),
    country: SOUTH_KOREA,
    photos: collectAutowiniPhotos(item, {}).map((p) => p.sourceUrl),
    listingUrl: listingUrl(item),
    status: activity.listingStatus === "reserved" ? "RESERVED" : "AVAILABLE",
  };
}

export async function getAutowiniLiveFilterOptions(make?: string) {
  try {
    const filters = await autowiniFetchFilters();
    const models = make ? await autowiniFetchSubModels(make) : [];
    return {
      makes: (filters.carMake ?? []).map((opt) => opt.name),
      models,
      fuels: ["Gasoline", "Diesel", "Electric", "Hybrid", "LPG"],
      transmissions: ["Automatic", "Manual", "CVT"],
      drivetrains: ["FWD", "RWD", "AWD", "4WD"],
      bodyTypes: [],
      carTypes: [{ value: "all", label: "Used cars" }],
      sortOptions: [
        { value: "createdDate:desc", label: "Newest" },
        { value: "price:asc", label: "Price ↑" },
        { value: "price:desc", label: "Price ↓" },
        { value: "year:desc", label: "Year ↓" },
        { value: "mileage:asc", label: "Mileage ↑" },
      ],
    };
  } catch {
    return {
      makes: [],
      models: [],
      fuels: ["Gasoline", "Diesel", "Electric", "Hybrid", "LPG"],
      transmissions: ["Automatic", "Manual", "CVT"],
      drivetrains: ["FWD", "RWD", "AWD", "4WD"],
      bodyTypes: [],
      carTypes: [],
      sortOptions: [],
    };
  }
}

export class AutowiniLiveAdapter implements LiveProviderAdapter {
  readonly internalName = "autowini_live";

  getCapabilities(): LiveProviderCapabilities {
    return {
      supportsFiltering: true,
      supportedFilters: [
        "make",
        "model",
        "modelGroup",
        "yearFrom",
        "yearTo",
        "priceMin",
        "priceMax",
        "mileageMin",
        "mileageMax",
        "engineMin",
        "engineMax",
        "fuel",
        "transmission",
        "drivetrain",
        "bodyType",
        "location",
        "search",
      ],
      supportsSorting: true,
      supportedSortFields: ["price", "year", "mileage", "createdDate"],
      supportsSearch: true,
      maxPageSize: 50,
    };
  }

  async fetchVehicles(
    filters: LiveVehicleFilter,
    credentials: LiveProviderCredentials,
  ): Promise<{ vehicles: LiveVehicle[]; total: number }> {
    const limit = Math.min(filters.limit ?? 20, 50);
    const offset = filters.offset ?? 0;
    const pageSize = limit;
    const page = Math.floor(offset / pageSize) + 1;
    const make = await resolveAutowiniMakeCode(filters.make);
    const subModel = await resolveAutowiniSubModelCode(
      filters.modelGroup || filters.model,
      make,
    );
    const sort =
      filters.sortBy === "price"
        ? filters.sortOrder === "asc"
          ? "priceAsc"
          : "priceDesc"
        : filters.sortBy === "year"
          ? "modelYearDesc"
          : filters.sortBy === "mileage"
            ? "mileageAsc"
            : "recentDate";

    const { items, total } = await autowiniSearchCars(
      {
        itemType: "cars",
        condition: AUTWINI_USED_CONDITION,
        make,
        subModel,
        modelYearFrom: filters.yearFrom,
        modelYearTo: filters.yearTo,
        priceFrom: usdPriceBound(filters.priceMin),
        priceTo: usdPriceBound(filters.priceMax),
        keyword: filters.search,
        sorting: sort,
        pageOffset: page,
        pageSize,
      },
      { token: credentials.apiToken },
    );

    let vehicles = items.map((item) => searchItemToLiveVehicle(item));
    vehicles = this.applyLocalFilters(vehicles, filters);
    return { vehicles, total };
  }

  async fetchVehicle(
    id: string,
    credentials: LiveProviderCredentials,
  ): Promise<LiveVehicle | null> {
    const detail = await this.fetchVehicleDetail(id, credentials);
    return detail?.vehicle ?? null;
  }

  async fetchVehicleDetail(
    id: string,
    credentials: LiveProviderCredentials,
  ): Promise<LiveVehicleDetail | null> {
    const listingId = id.toUpperCase();
    const adapter = new AutowiniHistoricalAdapter(AUTWINI_WEB_BASE, {});
    const fetched = await adapter.fetchListing(`${AUTWINI_WEB_BASE}/items/${listingId}`);
    const listing = await adapter.parseListing(fetched);
    const search = (fetched.json as { search?: AutowiniSearchItem } | undefined)?.search;
    const vehicle = search
      ? searchItemToLiveVehicle(search)
      : {
          listingId,
          vin: listing.vehicle?.vin,
          make: listing.vehicle?.make,
          model: listing.vehicle?.model,
          year: listing.vehicle?.year,
          mileage: listing.mileage,
          price: listing.priceAmount,
          currency: listing.priceCurrency ?? "USD",
          fuel: listing.vehicle?.fuelType,
          transmission: listing.vehicle?.transmission,
          drivetrain: listing.vehicle?.driveType,
          bodyType: listing.vehicle?.bodyType,
          location: listing.location,
          country: SOUTH_KOREA,
          photos: (listing.photos ?? []).map((p) => p.sourceUrl),
          listingUrl: listing.sourceUrl,
          status: "AVAILABLE" as const,
        };

    let detail;
    try {
      detail = await autowiniFetchDetail(listingId, { token: credentials.apiToken });
    } catch {
      detail = null;
    }
    if (detail?.tradePortName) {
      vehicle.location = autowiniLocation(search ?? {}, detail);
    }
    if (detail?.vinNumber && !vehicle.vin) {
      vehicle.vin = normalizeVin(detail.vinNumber);
    }
    vehicle.color = vehicle.color ?? listing.vehicle?.color;
    vehicle.trim = vehicle.trim ?? listing.vehicle?.trim;
    const photos = (listing.photos?.map((p) => p.sourceUrl) ?? vehicle.photos ?? []).filter(Boolean);
    if (photos.length > 0) vehicle.photos = photos;

    return {
      vehicle,
      vin: vehicle.vin,
      trim: listing.vehicle?.trim,
      bodyType: listing.vehicle?.bodyType,
      color: listing.vehicle?.color,
      engineDisplacement: listing.vehicle?.engineDisplacement,
      photos: vehicle.photos ?? [],
      events: (listing.events ?? []).map((e) => ({
        eventType: e.eventType,
        description: e.description ?? "Event",
        occurredAt: e.occurredAt instanceof Date ? e.occurredAt.toISOString() : undefined,
        metadata: e.metadata,
      })),
      listingUrl: vehicle.listingUrl,
    };
  }

  normalizeVehicle(raw: unknown): LiveVehicle {
    return searchItemToLiveVehicle((raw ?? {}) as AutowiniSearchItem);
  }

  async testConnectivity(
    credentials: LiveProviderCredentials,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const { total } = await autowiniSearchCars(
        { itemType: "cars", condition: AUTWINI_USED_CONDITION, pageSize: 1 },
        { token: credentials.apiToken },
      );
      return { ok: true, error: total >= 0 ? undefined : "Empty Autowini response" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private applyLocalFilters(vehicles: LiveVehicle[], filters: LiveVehicleFilter): LiveVehicle[] {
    return vehicles.filter((v) => {
      if (filters.fuel && v.fuel && !v.fuel.toLowerCase().includes(filters.fuel.toLowerCase())) {
        return false;
      }
      if (
        filters.transmission &&
        v.transmission &&
        !v.transmission.toLowerCase().includes(filters.transmission.toLowerCase())
      ) {
        return false;
      }
      if (
        filters.drivetrain &&
        v.drivetrain &&
        !v.drivetrain.toLowerCase().includes(filters.drivetrain.toLowerCase())
      ) {
        return false;
      }
      if (filters.mileageMin != null && (v.mileage ?? 0) < filters.mileageMin) return false;
      if (filters.mileageMax != null && (v.mileage ?? Number.MAX_SAFE_INTEGER) > filters.mileageMax) {
        return false;
      }
      if (!matchesEngineRange(v.engineDisplacement, filters.engineMin, filters.engineMax)) {
        return false;
      }
      if (filters.location && v.location && !v.location.toLowerCase().includes(filters.location.toLowerCase())) {
        return false;
      }
      return true;
    });
  }
}

export const autowiniLiveAdapter = new AutowiniLiveAdapter();
