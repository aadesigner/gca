/**
 * Combined live feed: merge every enabled adapter and apply filters in one currency (USD).
 */
import type { LiveVehicle, LiveVehicleFilter, LiveProviderCapabilities } from "@workspace/providers";
import { getKrwFxSnapshot, livePriceUsd, usdToKrw, type FxSnapshot } from "./fx";
import { matchesEngineRange } from "./engine-size";
import {
  browseLiveVehicles,
  COMBINED_LIVE_INTERNAL_NAME,
  listEnabledLiveProviders,
  LIVE_ADAPTERS,
  LiveBrowseError,
  type LiveBrowseListResult,
  type LiveBrowseSourceResult,
} from "./liveBrowse";
import { getEncarLiveFilterOptions } from "./providers/encar-live-bridge";
import { getAutowiniLiveFilterOptions } from "./providers/autowiniLive";
import { getKbchachachaLiveFilterOptions } from "./providers/kbchachachaLive";

const COMBINED_SOURCE_TIMEOUT_MS = 4_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export const COMBINED_LIVE_PROVIDER = {
  id: 0,
  name: "All enabled feeds",
  internalName: COMBINED_LIVE_INTERNAL_NAME,
} as const;

const COMBINED_FILTERS: Array<keyof LiveVehicleFilter> = [
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
  "color",
  "location",
  "carType",
  "search",
];

export function includeLiveProviderForCarType(
  internalName: string,
  carType?: LiveVehicleFilter["carType"],
): boolean {
  const market = carType ?? "all";
  if (market === "all") return true;
  if (market === "import") return internalName === "encar_live" || internalName === "autowini_live";
  if (market === "domestic") return internalName === "encar_live" || internalName === "kbchachacha_live";
  return true;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function filtersForProvider(
  internalName: string,
  filters: LiveVehicleFilter,
  fx: FxSnapshot | null,
  pageSize: number,
): LiveVehicleFilter {
  const next: LiveVehicleFilter = {
    ...filters,
    offset: 0,
    limit: pageSize,
  };

  if (internalName === "autowini_live") {
    delete next.carType;
    if (next.priceMin != null && next.priceMin >= 500_000) delete next.priceMin;
    if (next.priceMax != null && next.priceMax >= 500_000) delete next.priceMax;
    return next;
  }

  // Combined UI sends USD; Encar / KB expect KRW.
  if (next.priceMin != null) next.priceMin = usdToKrw(next.priceMin, fx);
  if (next.priceMax != null) next.priceMax = usdToKrw(next.priceMax, fx);
  return next;
}

function matchesCombinedFilters(
  vehicle: LiveVehicle,
  filters: LiveVehicleFilter,
  fx: FxSnapshot | null,
): boolean {
  if (filters.yearFrom != null && (vehicle.year ?? 0) < filters.yearFrom) return false;
  if (filters.yearTo != null && (vehicle.year ?? 9999) > filters.yearTo) return false;
  if (filters.mileageMin != null && (vehicle.mileage ?? 0) < filters.mileageMin) return false;
  if (filters.mileageMax != null && (vehicle.mileage ?? Infinity) > filters.mileageMax) return false;
  if (!matchesEngineRange(vehicle.engineDisplacement, filters.engineMin, filters.engineMax)) return false;

  const hay = `${vehicle.make ?? ""} ${vehicle.model ?? ""} ${vehicle.modelGroup ?? ""} ${vehicle.trim ?? ""}`.toLowerCase();
  if (filters.make && !hay.includes(filters.make.toLowerCase())) return false;
  const model = filters.modelGroup || filters.model;
  if (model && !hay.includes(model.toLowerCase())) return false;
  if (filters.fuel && !(vehicle.fuel ?? "").toLowerCase().includes(filters.fuel.toLowerCase())) return false;
  if (filters.transmission && !(vehicle.transmission ?? "").toLowerCase().includes(filters.transmission.toLowerCase())) {
    return false;
  }
  if (filters.drivetrain && !(vehicle.drivetrain ?? "").toLowerCase().includes(filters.drivetrain.toLowerCase())) {
    return false;
  }
  if (filters.bodyType && !(vehicle.bodyType ?? "").toLowerCase().includes(filters.bodyType.toLowerCase())) return false;
  if (filters.color && !(vehicle.color ?? "").toLowerCase().includes(filters.color.toLowerCase())) return false;
  if (filters.location && !(vehicle.location ?? "").toLowerCase().includes(filters.location.toLowerCase())) return false;
  if (filters.search) {
    const q = filters.search.toLowerCase();
    const blob = `${hay} ${vehicle.location ?? ""} ${vehicle.vin ?? ""} ${vehicle.listingId}`.toLowerCase();
    if (!blob.includes(q)) return false;
  }

  if (filters.priceMin != null || filters.priceMax != null) {
    const usd = livePriceUsd(vehicle, fx);
    if (usd == null) return false;
    if (filters.priceMin != null && usd < filters.priceMin) return false;
    if (filters.priceMax != null && usd > filters.priceMax) return false;
  }
  return true;
}

function sortCombined(
  vehicles: LiveVehicle[],
  sortBy: LiveVehicleFilter["sortBy"],
  sortOrder: LiveVehicleFilter["sortOrder"],
  fx: FxSnapshot | null,
): LiveVehicle[] {
  const dir = sortOrder === "asc" ? 1 : -1;
  const valueOf = (vehicle: LiveVehicle): number => {
    switch (sortBy) {
      case "price": {
        const usd = livePriceUsd(vehicle, fx);
        if (usd == null) return sortOrder === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
        return usd;
      }
      case "year":
        return vehicle.year ?? 0;
      case "mileage":
        return vehicle.mileage ?? (sortOrder === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
      default:
        return Date.parse(vehicle.createdDate ?? vehicle.updatedDate ?? "") || 0;
    }
  };
  return [...vehicles].sort((a, b) => {
    const av = valueOf(a);
    const bv = valueOf(b);
    if (av === bv) return String(a.listingId).localeCompare(String(b.listingId));
    return av < bv ? -dir : dir;
  });
}

export async function browseCombinedLiveVehicles(
  filters: LiveVehicleFilter,
  options?: { bypassCache?: boolean },
): Promise<LiveBrowseListResult> {
  const enabled = await listEnabledLiveProviders();
  const included = enabled.filter((row) => includeLiveProviderForCarType(row.internalName, filters.carType));
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  if (included.length === 0) {
    return {
      vehicles: [],
      total: 0,
      limit,
      offset,
      cached: true,
      cachedAt: null,
      provider: { ...COMBINED_LIVE_PROVIDER },
      sources: [],
    };
  }
  const fx = await getKrwFxSnapshot();
  const needed = offset + limit;

  const settled = await Promise.allSettled(
    included.map(async (row) => {
      const adapter = LIVE_ADAPTERS[row.internalName];
      const maxPage = adapter?.getCapabilities().maxPageSize ?? 50;
      const pageSize = Math.min(maxPage, Math.max(needed, 20));
      const result = await withTimeout(
        browseLiveVehicles(
          row.id,
          filtersForProvider(row.internalName, filters, fx, pageSize),
          options,
        ),
        COMBINED_SOURCE_TIMEOUT_MS,
        row.name,
      );
      const vehicles = result.vehicles.map((vehicle) => ({
        ...vehicle,
        sourceProvider: { id: row.id, name: row.name, internalName: row.internalName },
      }));
      const source: LiveBrowseSourceResult = {
        id: row.id,
        name: row.name,
        internalName: row.internalName,
        total: result.total,
      };
      return { ...result, vehicles, source };
    }),
  );

  const sources: LiveBrowseSourceResult[] = [];
  const merged: LiveVehicle[] = [];
  let cached = true;
  let cachedAt: Date | null = null;

  for (let i = 0; i < settled.length; i++) {
    const row = included[i];
    const item = settled[i];
    if (item.status === "fulfilled") {
      merged.push(...item.value.vehicles);
      sources.push(item.value.source);
      cached = cached && item.value.cached;
      if (item.value.cachedAt && (!cachedAt || item.value.cachedAt > cachedAt)) {
        cachedAt = item.value.cachedAt;
      }
    } else {
      const message = item.reason instanceof Error ? item.reason.message : String(item.reason);
      sources.push({
        id: row.id,
        name: row.name,
        internalName: row.internalName,
        total: 0,
        error: message,
      });
    }
  }

  if (merged.length === 0 && sources.every((s) => s.error)) {
    throw new LiveBrowseError("UPSTREAM_ERROR", sources.map((s) => `${s.name}: ${s.error}`).join("; "));
  }

  const filtered = merged.filter((vehicle) => matchesCombinedFilters(vehicle, filters, fx));
  const sorted = sortCombined(filtered, filters.sortBy ?? "createdDate", filters.sortOrder ?? "desc", fx);
  const vehicles = sorted.slice(offset, offset + limit);
  const total = sources.reduce((sum, source) => sum + (source.error ? 0 : source.total), 0);

  return {
    vehicles,
    total,
    limit,
    offset,
    cached,
    cachedAt,
    provider: { ...COMBINED_LIVE_PROVIDER },
    sources,
  };
}

export function getCombinedLiveCapabilities(): LiveProviderCapabilities {
  return {
    supportsFiltering: true,
    supportedFilters: COMBINED_FILTERS,
    supportsSorting: true,
    supportedSortFields: ["price", "year", "mileage", "createdDate"],
    supportsSearch: true,
    maxPageSize: 100,
  };
}

export async function getCombinedLiveFilterOptions(carType?: string, make?: string) {
  const enabled = await listEnabledLiveProviders();
  const market = (carType as LiveVehicleFilter["carType"]) ?? "all";
  const included = enabled.filter((row) => includeLiveProviderForCarType(row.internalName, market));

  const optionSets = await Promise.all(
    included.map(async (row) => {
      if (row.internalName === "encar_live") return getEncarLiveFilterOptions(carType, make);
      if (row.internalName === "autowini_live") return getAutowiniLiveFilterOptions(make);
      if (row.internalName === "kbchachacha_live") return getKbchachachaLiveFilterOptions(make);
      return { makes: [] as string[], models: [] as string[] };
    }),
  );

  const encarOpts = getEncarLiveFilterOptions(carType, make);
  return {
    makes: uniqueSorted(optionSets.flatMap((set) => set.makes ?? [])),
    models: uniqueSorted(optionSets.flatMap((set) => set.models ?? [])),
    fuels: encarOpts.fuels,
    transmissions: encarOpts.transmissions,
    drivetrains: encarOpts.drivetrains,
    bodyTypes: encarOpts.bodyTypes,
    carTypes: encarOpts.carTypes,
    sortOptions: encarOpts.sortOptions,
  };
}
