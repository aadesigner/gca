/**
 * KB ChaChaCha live inventory — public search list + detail pages.
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
  KB_PAGE_SIZE,
  KB_WEB_BASE,
  extractKbCarSeq,
  kbDetailUrl,
  kbFetchSearch,
} from "./kbchachacha-http";
import { KbchachachaHistoricalAdapter } from "./kbchachacha";
import {
  kbListingStatus,
  kbMatchesLocalFilters,
  parseKbSearchHtml,
  splitKbName,
  type KbSearchCard,
} from "./kbchachacha-normalize";
import { encarMakesForCarType, encarModelsForMake } from "./encar-catalog";

function searchCardToLiveVehicle(card: KbSearchCard): LiveVehicle {
  const activity = kbListingStatus({ sold: Boolean(card.sold) });
  const names = card.title ? splitKbName(card.title) : undefined;
  return {
    listingId: card.carSeq,
    make: names?.make,
    model: names?.model ?? card.title,
    trim: names?.trim,
    year: card.year,
    mileage: card.mileage,
    price: card.priceKrw,
    currency: "KRW",
    fuel: card.fuel,
    location: card.location,
    country: SOUTH_KOREA,
    photos: card.thumbnail ? [card.thumbnail] : [],
    listingUrl: kbDetailUrl(card.carSeq),
    status: activity.listingStatus === "sold" ? "SOLD" : "AVAILABLE",
  };
}

export function getKbchachachaLiveFilterOptions(make?: string) {
  return {
    makes: encarMakesForCarType("all"),
    models: encarModelsForMake(make),
    fuels: ["Gasoline", "Diesel", "Electric", "Hybrid", "LPG"],
    transmissions: ["Automatic", "Manual", "CVT"],
    drivetrains: ["FWD", "RWD", "AWD", "4WD"],
    bodyTypes: ["SUV", "Sedan", "Hatchback", "Van", "Truck", "Coupe"],
    carTypes: [{ value: "all", label: "Used cars" }],
    sortOptions: [{ value: "createdDate:desc", label: "Newest" }],
  };
}

export class KbchachachaLiveAdapter implements LiveProviderAdapter {
  readonly internalName = "kbchachacha_live";

  getCapabilities(): LiveProviderCapabilities {
    return {
      supportsFiltering: true,
      supportedFilters: [
        "make",
        "model",
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
        "bodyType",
        "location",
        "search",
      ],
      supportsSorting: false,
      supportedSortFields: [],
      supportsSearch: true,
      maxPageSize: KB_PAGE_SIZE,
    };
  }

  async fetchVehicles(
    filters: LiveVehicleFilter,
    _credentials: LiveProviderCredentials,
  ): Promise<{ vehicles: LiveVehicle[]; total: number }> {
    const limit = Math.min(filters.limit ?? 20, KB_PAGE_SIZE);
    const offset = filters.offset ?? 0;
    const page = Math.floor(offset / KB_PAGE_SIZE) + 1;
    const html = await kbFetchSearch({
      page,
      keyword: filters.search,
    });
    const cards = parseKbSearchHtml(html);
    const start = offset % KB_PAGE_SIZE;
    let vehicles = cards.map((card) => searchCardToLiveVehicle(card));
    vehicles = this.applyLocalFilters(vehicles, filters);
    const sliced = vehicles.slice(start, start + limit);
    const hasMore = cards.length >= KB_PAGE_SIZE;
    const total = hasMore ? offset + sliced.length + 1 : (page - 1) * KB_PAGE_SIZE + vehicles.length;
    return { vehicles: sliced, total };
  }

  async fetchVehicle(id: string, credentials: LiveProviderCredentials): Promise<LiveVehicle | null> {
    const detail = await this.fetchVehicleDetail(id, credentials);
    return detail?.vehicle ?? null;
  }

  async fetchVehicleDetail(
    id: string,
    _credentials: LiveProviderCredentials,
  ): Promise<LiveVehicleDetail | null> {
    const carSeq = extractKbCarSeq(id) ?? id.replace(/\D/g, "");
    if (!carSeq) return null;
    const adapter = new KbchachachaHistoricalAdapter(KB_WEB_BASE, {});
    const fetched = await adapter.fetchListing(kbDetailUrl(carSeq));
    const listing = await adapter.parseListing(fetched);
    const status = listing.listingStatus === "sold" ? "SOLD" : "AVAILABLE";
    const vehicle: LiveVehicle = {
      listingId: carSeq,
      vin: listing.vehicle?.vin,
      make: listing.vehicle?.make,
      model: listing.vehicle?.model,
      modelGroup: listing.vehicle?.model,
      badge: listing.vehicle?.trim,
      trim: listing.vehicle?.trim,
      year: listing.vehicle?.year,
      mileage: listing.mileage,
      price: listing.priceAmount,
      currency: listing.priceCurrency ?? "KRW",
      msrp: (fetched.json as { parsed?: { msrpKrw?: number } } | undefined)?.parsed?.msrpKrw,
      fuel: listing.vehicle?.fuelType,
      transmission: listing.vehicle?.transmission,
      drivetrain: listing.vehicle?.driveType,
      bodyType: listing.vehicle?.bodyType,
      color: listing.vehicle?.color,
      engineDisplacement: listing.vehicle?.engineDisplacement,
      location: listing.location,
      country: SOUTH_KOREA,
      photos: (listing.photos ?? []).map((p) => p.sourceUrl),
      listingUrl: listing.sourceUrl,
      status,
      accidentCount: listing.accidentCount,
      ownerChangeCount: listing.ownerChangeCount,
      features: (fetched.json as { parsed?: { options?: string[] } } | undefined)?.parsed?.options,
    };
    return {
      vehicle,
      vin: vehicle.vin,
      trim: listing.vehicle?.trim,
      bodyType: listing.vehicle?.bodyType,
      color: listing.vehicle?.color,
      engineDisplacement: listing.vehicle?.engineDisplacement,
      features: vehicle.features,
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
    return searchCardToLiveVehicle((raw ?? {}) as KbSearchCard);
  }

  async testConnectivity(_credentials: LiveProviderCredentials): Promise<{ ok: boolean; error?: string }> {
    try {
      const html = await kbFetchSearch({ page: 1 });
      const cards = parseKbSearchHtml(html);
      return { ok: cards.length > 0, error: cards.length ? undefined : "Empty KB ChaChaCha search page" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private applyLocalFilters(vehicles: LiveVehicle[], filters: LiveVehicleFilter): LiveVehicle[] {
    return vehicles.filter((v) =>
      kbMatchesLocalFilters(
        {
          title: [v.make, v.model].filter(Boolean).join(" "),
          year: v.year,
          mileage: v.mileage,
          fuel: v.fuel,
          location: v.location,
          priceKrw: v.price,
        },
        {
          make: filters.make,
          yearFrom: filters.yearFrom,
          yearTo: filters.yearTo,
          fuel: filters.fuel,
          minMileage: filters.mileageMin,
          maxMileage: filters.mileageMax,
          minPrice: filters.priceMin,
          maxPrice: filters.priceMax,
          location: filters.location,
          keyword: filters.search || filters.model,
        },
      ),
    );
  }
}

export const kbchachachaLiveAdapter = new KbchachachaLiveAdapter();
