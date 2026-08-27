/**
 * EncarLiveAdapter — live inventory from Encar (api.encar.com).
 *
 * Without custom upstream credentials, queries Encar directly (same source as
 * historical collection). With credentials, proxies a custom upstream API.
 */
import type {
  LiveProviderAdapter,
  LiveVehicle,
  LiveVehicleFilter,
  LiveProviderCapabilities,
  LiveProviderCredentials,
  LiveVehicleDetail,
} from "@workspace/providers";
import { validateUpstreamUrl } from "../urlValidation";
import { safeFetch } from "../safeHttps";
import {
  fetchEncarLiveDetail,
  fetchEncarLiveVehicles,
  getEncarLiveFilterOptions,
  testEncarLiveConnectivity,
} from "./encar-live-bridge";
import { DETAIL_WEB_BASE } from "./encar";
import { matchesEngineRange } from "../engine-size";

const STUB_VEHICLES: LiveVehicle[] = [
  {
    listingId: "stub-001",
    make: "Hyundai",
    model: "Sonata",
    year: 2022,
    mileage: 32000,
    price: 22500000,
    currency: "KRW",
    fuel: "Gasoline",
    transmission: "Automatic",
    drivetrain: "FWD",
    location: "Seoul, South Korea",
    country: "South Korea",
    photos: [],
    listingUrl: `${DETAIL_WEB_BASE}/cars/detail/stub-001`,
    status: "AVAILABLE",
    createdDate: "2026-01-10T09:00:00Z",
    updatedDate: "2026-08-01T12:00:00Z",
  },
  {
    listingId: "stub-004",
    make: "BMW",
    model: "320i",
    year: 2020,
    mileage: 42000,
    price: 31500000,
    currency: "KRW",
    fuel: "Gasoline",
    transmission: "Automatic",
    drivetrain: "RWD",
    location: "Seoul, South Korea",
    country: "South Korea",
    photos: [],
    listingUrl: `${DETAIL_WEB_BASE}/cars/detail/stub-004`,
    status: "AVAILABLE",
    accidentCount: 1,
    ownerChangeCount: 2,
  },
  {
    listingId: "stub-005",
    make: "Mercedes-Benz",
    model: "E220d",
    year: 2019,
    mileage: 68000,
    price: 38900000,
    currency: "KRW",
    fuel: "Diesel",
    transmission: "Automatic",
    location: "Gyeonggi, South Korea",
    country: "South Korea",
    photos: [],
    listingUrl: `${DETAIL_WEB_BASE}/cars/detail/stub-005`,
    status: "AVAILABLE",
  },
];

export class EncarLiveAdapter implements LiveProviderAdapter {
  readonly internalName = "encar_live";

  getCapabilities(): LiveProviderCapabilities {
    return {
      supportsFiltering: true,
      supportedFilters: [
        "make", "model", "modelGroup", "badgeGroup",
        "yearFrom", "yearTo", "priceMin", "priceMax",
        "mileageMin", "mileageMax", "engineMin", "engineMax", "fuel", "transmission",
        "drivetrain", "bodyType", "color", "location", "carType", "search",
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
    if (credentials.apiUrl && credentials.apiToken) {
      return this._fetchFromUpstream(filters, credentials);
    }
    if (process.env.ENCAR_LIVE_STUB === "1") {
      return this._applyFiltersToStub(filters);
    }
    return fetchEncarLiveVehicles(filters);
  }

  async fetchVehicle(
    id: string,
    credentials: LiveProviderCredentials,
  ): Promise<LiveVehicle | null> {
    if (credentials.apiUrl && credentials.apiToken) {
      return this._fetchSingleFromUpstream(id, credentials);
    }
    if (process.env.ENCAR_LIVE_STUB === "1") {
      return STUB_VEHICLES.find((v) => v.listingId === id) ?? null;
    }
    const detail = await fetchEncarLiveDetail(id);
    return detail?.vehicle ?? null;
  }

  async fetchVehicleDetail(
    id: string,
    credentials: LiveProviderCredentials,
  ): Promise<LiveVehicleDetail | null> {
    if (credentials.apiUrl && credentials.apiToken) {
      const vehicle = await this._fetchSingleFromUpstream(id, credentials);
      if (!vehicle) return null;
      return { vehicle, photos: vehicle.photos ?? [], events: [] };
    }
    if (process.env.ENCAR_LIVE_STUB === "1") {
      const vehicle = STUB_VEHICLES.find((v) => v.listingId === id);
      if (!vehicle) return null;
      return {
        vehicle,
        photos: vehicle.photos ?? [],
        events: [],
        registry: {
          available: true,
          firstDate: "2019-03-15",
          ownerChangeCount: vehicle.ownerChangeCount ?? 1,
          accidentCount: vehicle.accidentCount ?? 0,
          accidents: vehicle.accidentCount
            ? [{ date: "2022-06-10", repairTotal: 850000, insuranceBenefit: 1200000 }]
            : [],
        },
      };
    }
    return fetchEncarLiveDetail(id);
  }

  normalizeVehicle(raw: unknown): LiveVehicle {
    const r = raw as Record<string, unknown>;
    return {
      listingId: String(r["id"] ?? r["listingId"] ?? ""),
      vin: r["vin"] as string | undefined,
      make: r["make"] as string | undefined,
      model: r["model"] as string | undefined,
      year: r["year"] as number | undefined,
      mileage: r["mileage"] as number | undefined,
      price: r["price"] as number | undefined,
      currency: (r["currency"] as string | undefined) ?? "KRW",
      fuel: r["fuel"] as string | undefined,
      transmission: r["transmission"] as string | undefined,
      drivetrain: r["drivetrain"] as string | undefined,
      location: r["location"] as string | undefined,
      country: (r["country"] as string | undefined) ?? "South Korea",
      photos: (r["photos"] as string[] | undefined) ?? [],
      listingUrl: r["listingUrl"] as string | undefined,
      status: this._mapStatus(r["status"] as string | undefined),
      createdDate: r["createdDate"] as string | undefined,
      updatedDate: r["updatedDate"] as string | undefined,
      soldDate: r["soldDate"] as string | undefined,
    };
  }

  async testConnectivity(
    credentials: LiveProviderCredentials,
  ): Promise<{ ok: boolean; error?: string }> {
    if (!credentials.apiUrl || !credentials.apiToken) {
      return testEncarLiveConnectivity();
    }

    const urlCheck = await validateUpstreamUrl(credentials.apiUrl);
    if (!urlCheck.valid) {
      return { ok: false, error: `URL validation failed: ${urlCheck.error}` };
    }

    try {
      const res = await safeFetch(`${credentials.apiUrl}/health`, {
        headers: { Authorization: `Bearer ${credentials.apiToken}` },
        timeoutMs: 5_000,
      });
      if (!res.ok) {
        return { ok: false, error: `Upstream returned HTTP ${res.status}` };
      }
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  getFilterOptions() {
    return getEncarLiveFilterOptions();
  }

  private async _fetchFromUpstream(
    filters: LiveVehicleFilter,
    credentials: LiveProviderCredentials,
  ): Promise<{ vehicles: LiveVehicle[]; total: number }> {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
    params.set("limit", String(Math.min(filters.limit ?? 20, 100)));
    params.set("offset", String(Math.max(filters.offset ?? 0, 0)));

    const res = await safeFetch(`${credentials.apiUrl}/vehicles?${params}`, {
      headers: { Authorization: `Bearer ${credentials.apiToken!}` },
      timeoutMs: 15_000,
    });

    if (!res.ok) {
      throw new Error(`Upstream error ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { items: unknown[]; total: number };
    const vehicles = (json.items ?? []).map((v) => this.normalizeVehicle(v));
    return { vehicles, total: json.total ?? vehicles.length };
  }

  private async _fetchSingleFromUpstream(
    id: string,
    credentials: LiveProviderCredentials,
  ): Promise<LiveVehicle | null> {
    const res = await safeFetch(`${credentials.apiUrl}/vehicles/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${credentials.apiToken!}` },
      timeoutMs: 15_000,
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Upstream error ${res.status}: ${await res.text()}`);
    return this.normalizeVehicle(await res.json());
  }

  private _applyFiltersToStub(filters: LiveVehicleFilter): { vehicles: LiveVehicle[]; total: number } {
    let results = [...STUB_VEHICLES];
    if (filters.make) results = results.filter((v) => v.make?.toLowerCase() === filters.make!.toLowerCase());
    if (filters.model) results = results.filter((v) => v.model?.toLowerCase().includes(filters.model!.toLowerCase()));
    if (filters.yearFrom != null) results = results.filter((v) => (v.year ?? 0) >= filters.yearFrom!);
    if (filters.yearTo != null) results = results.filter((v) => (v.year ?? 9999) <= filters.yearTo!);
    if (filters.priceMin != null) results = results.filter((v) => (v.price ?? 0) >= filters.priceMin!);
    if (filters.priceMax != null) results = results.filter((v) => (v.price ?? Infinity) <= filters.priceMax!);
    if (filters.mileageMin != null) results = results.filter((v) => (v.mileage ?? 0) >= filters.mileageMin!);
    if (filters.mileageMax != null) results = results.filter((v) => (v.mileage ?? Infinity) <= filters.mileageMax!);
    if (filters.engineMin != null || filters.engineMax != null) {
      results = results.filter((v) => matchesEngineRange(v.engineDisplacement, filters.engineMin, filters.engineMax));
    }
    if (filters.fuel) results = results.filter((v) => v.fuel?.toLowerCase() === filters.fuel!.toLowerCase());
    if (filters.transmission) results = results.filter((v) => v.transmission?.toLowerCase().includes(filters.transmission!.toLowerCase()));
    if (filters.location) results = results.filter((v) => v.location?.toLowerCase().includes(filters.location!.toLowerCase()));
    if (filters.search) {
      const q = filters.search.toLowerCase();
      results = results.filter((v) =>
        [v.make, v.model, v.location].some((f) => f?.toLowerCase().includes(q)),
      );
    }
    const total = results.length;
    const offset = Math.max(filters.offset ?? 0, 0);
    const limit = Math.min(filters.limit ?? 20, 50);
    return { vehicles: results.slice(offset, offset + limit), total };
  }

  private _mapStatus(raw: string | undefined): LiveVehicle["status"] {
    const map: Record<string, LiveVehicle["status"]> = {
      available: "AVAILABLE",
      reserved: "RESERVED",
      sold: "SOLD",
      removed: "REMOVED",
      deleted: "REMOVED",
    };
    return map[raw?.toLowerCase() ?? ""] ?? "UNKNOWN";
  }
}

export const encarLiveAdapter = new EncarLiveAdapter();
