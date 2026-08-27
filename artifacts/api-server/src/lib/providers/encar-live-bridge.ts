/**
 * Bridge Encar direct API → live feed types (search + full detail).
 */
import type { LiveVehicle, LiveVehicleDetail, LiveVehicleFilter } from "@workspace/providers";
import {
  EncarHistoricalAdapter,
  DETAIL_WEB_BASE,
  type EncarFilterParams,
} from "./encar";
import { collectPhotoUrls, collectPhotoUrlsAt } from "./encar-photos";
import {
  extractEncarEvents,
  type EncarAggregatedPayload,
} from "./encar-history";
import {
  englishizeEncarJson,
  normalizeEncarBody,
  normalizeEncarColor,
  normalizeEncarLocation,
  translateEncarText,
} from "./encar-locale";
import {
  encarMakesForCarType,
  encarModelsForMake,
  encarSearchFuel,
  encarSearchLocation,
  encarSearchManufacturer,
  encarSearchModelGroup,
  encarSearchTransmission,
  extractEncarAdvertisementFields,
  forceEnglish,
  normalizeEncarListedPrice,
  normalizeEncarListingActivity,
  parseEncarLiveSearch,
  translateEncarFuelName,
  translateEncarMake,
  translateEncarModel,
} from "./encar-catalog";

const SORT_MAP: Record<string, string> = {
  "price:asc": "MobilePriceAsc",
  "price:desc": "MobilePriceDesc",
  "year:desc": "MobileYearDesc",
  "year:asc": "MobileYearAsc",
  "mileage:asc": "MobileMileageAsc",
  "mileage:desc": "MobileMileageDesc",
  "createdDate:desc": "ModifiedDate",
  "createdDate:asc": "ModifiedDateAsc",
};

function looksLikeModelGroup(raw?: string) {
  if (!raw?.trim()) return false;
  const s = raw.trim();
  return (
    /^\d\s*series$/i.test(s) ||
    /^[A-Za-z][-\s]?class$/i.test(s) ||
    /^(X[1-7]|iX|i[34578]|M[2-8]|GLE|GLC|GLS|GLA|GLB|CLA|CLS)$/i.test(s)
  );
}

export function mapLiveFiltersToEncar(filters: LiveVehicleFilter): EncarFilterParams {
  const sortKey = `${filters.sortBy ?? "createdDate"}:${filters.sortOrder ?? "desc"}`;
  const limit = Math.min(filters.limit ?? 20, 50);
  const parsed = parseEncarLiveSearch(filters.search);

  const modelAsGroup = looksLikeModelGroup(filters.model) && !filters.modelGroup;
  const modelGroup = filters.modelGroup ?? parsed.modelGroup ?? (modelAsGroup ? filters.model : undefined);
  const trimModel = modelAsGroup ? parsed.model : (filters.model ?? parsed.model);

  return {
    brand: encarSearchManufacturer(filters.make) ?? encarSearchManufacturer(parsed.make),
    modelGroup: encarSearchModelGroup(modelGroup) ?? modelGroup,
    model: trimModel,
    badgeGroup: filters.badgeGroup,
    yearFrom: filters.yearFrom ?? parsed.year,
    yearTo: filters.yearTo ?? parsed.year,
    minMileage: filters.mileageMin,
    maxMileage: filters.mileageMax,
    minDisplacement: filters.engineMin,
    maxDisplacement: filters.engineMax,
    minPrice: filters.priceMin,
    maxPrice: filters.priceMax,
    fuel: encarSearchFuel(filters.fuel),
    transmission: encarSearchTransmission(filters.transmission),
    location: encarSearchLocation(filters.location) ?? encarSearchLocation(parsed.location),
    carType: filters.carType ?? "import",
    sort: SORT_MAP[sortKey] ?? "ModifiedDate",
    pageSize: limit,
  };
}

function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function en(raw?: string | null): string | undefined {
  if (raw == null || !String(raw).trim()) return undefined;
  return forceEnglish(translateEncarText(raw) ?? raw);
}

function searchItemToLiveVehicle(item: {
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
  Photos?: Array<{ location?: string }>;
}): LiveVehicle {
  const yearRaw = item.FormYear ?? item.Year;
  const year = yearRaw != null ? parseInt(String(yearRaw).slice(0, 4), 10) : undefined;
  const photos = collectPhotoUrlsAt("card", item.Photos);
  const modelEn = en(translateEncarModel(item.Model) ?? item.Model);
  const badgeEn = en(translateEncarModel(item.Badge) ?? item.Badge);
  const listed = normalizeEncarListedPrice(item.Price);
  return {
    listingId: item.Id,
    make: en(translateEncarMake(item.Manufacturer) ?? item.Manufacturer),
    model: [modelEn, badgeEn].filter(Boolean).join(" ").trim() || modelEn,
    badge: badgeEn,
    modelGroup: modelEn,
    year: Number.isFinite(year) ? year : undefined,
    mileage: item.Mileage,
    price: listed.onRequest ? undefined : listed.krw,
    priceOnRequest: listed.onRequest || undefined,
    currency: "KRW",
    fuel: en(translateEncarFuelName(item.FuelType) ?? item.FuelType),
    location: en(normalizeEncarLocation(item.OfficeCityState) ?? item.OfficeCityState),
    country: "South Korea",
    photos,
    listingUrl: `${DETAIL_WEB_BASE}/cars/detail/${item.Id}`,
    status: "AVAILABLE",
  };
}

function applyPostFilters(vehicles: LiveVehicle[], filters: LiveVehicleFilter): LiveVehicle[] {
  const parsed = parseEncarLiveSearch(filters.search);
  const extra = parsed.model;
  if (!extra) return vehicles;
  const q = extra.toLowerCase();
  return vehicles.filter((v) =>
    [v.make, v.model, v.modelGroup, v.badge, v.location, v.trim].some((f) =>
      f?.toLowerCase().includes(q),
    ),
  );
}

export async function fetchEncarLiveVehicles(
  filters: LiveVehicleFilter,
): Promise<{ vehicles: LiveVehicle[]; total: number }> {
  const encarFilters = {
    ...mapLiveFiltersToEncar(filters),
    retryCount: 1,
    requestTimeoutMs: 12_000,
    requestPriority: "live" as const,
  };
  const adapter = new EncarHistoricalAdapter(DETAIL_WEB_BASE, encarFilters);
  const limit = Math.min(filters.limit ?? 20, 50);
  const offset = Math.max(filters.offset ?? 0, 0);
  const page = Math.floor(offset / limit) + 1;

  const { results, total: upstreamTotal } = await adapter.searchResults(page, limit);
  let vehicles = results.map(searchItemToLiveVehicle);
  vehicles = applyPostFilters(vehicles, filters);

  return {
    vehicles,
    total: applyPostFilters(results.map(searchItemToLiveVehicle), filters).length > 0
      ? upstreamTotal
      : vehicles.length,
  };
}

function extractFeatures(detail: Record<string, unknown> | undefined): string[] {
  const options = detail?.options ?? detail?.OPTIONS;
  if (!Array.isArray(options)) return [];
  return options
    .map((o) => {
      if (typeof o === "string") return en(o);
      if (o && typeof o === "object") {
        const row = o as Record<string, unknown>;
        return en(str(row.name) ?? str(row.optionName) ?? str(row.optionCd));
      }
      return undefined;
    })
    .filter((x): x is string => !!x);
}

function buildRegistry(record: Record<string, unknown> | null | undefined) {
  if (!record) return { available: false };
  if (record.openData === false) return { available: false };

    const accidents = Array.isArray(record.accidents)
    ? (record.accidents as Array<Record<string, unknown>>)
        .map((a) => ({
          date: str(a.date),
          type: en(str(a.type)),
          repairTotal:
            (num(a.partCost) ?? 0) + (num(a.laborCost) ?? 0) + (num(a.paintingCost) ?? 0),
          insuranceBenefit: num(a.insuranceBenefit),
        }))
        .filter((a) => (a.repairTotal ?? 0) > 0 || (a.insuranceBenefit ?? 0) > 0)
    : [];

  const myAccidents = num(record.myAccidentCnt);
  const otherAccidents = num(record.otherAccidentCnt);

  return {
    available: true,
    firstDate: str(record.firstDate),
    ownerChangeCount: num(record.ownerChangeCnt),
    accidentCount:
      myAccidents != null || otherAccidents != null
        ? (myAccidents ?? 0) + (otherAccidents ?? 0)
        : num(record.accidentCnt),
    myAccidentCost: num(record.myAccidentCost),
    otherAccidentCost: num(record.otherAccidentCost),
    totalLossCount: num(record.totalLossCnt),
    floodDamage: (num(record.floodTotalLossCnt) ?? 0) > 0 || (num(record.floodPartLossCnt) ?? 0) > 0,
    loan: num(record.loan),
    ownerChanges: Array.isArray(record.ownerChanges)
      ? record.ownerChanges
          .map((item, index) => {
            const date =
              typeof item === "string"
                ? item
                : str((item as Record<string, unknown>)?.date);
            if (!date) return null;
            return {
              date,
              sequence: index + 1,
              source: "encar_record",
            };
          })
          .filter((row): row is NonNullable<typeof row> => row != null)
      : [],
    accidents,
  };
}

export async function fetchEncarLiveDetail(listingId: string): Promise<LiveVehicleDetail | null> {
  const adapter = new EncarHistoricalAdapter(DETAIL_WEB_BASE, {
    detailLevel: "full",
    retryCount: 1,
    requestTimeoutMs: 18_000,
    requestPriority: "live",
  });
  const url = `${DETAIL_WEB_BASE}/cars/detail/${listingId}`;

  try {
    const fetched = await adapter.fetchListing(url);
    const listing = await adapter.parseListing(fetched);
    const payload = (fetched.json ?? {}) as EncarAggregatedPayload;
    const detail = payload.detail as Record<string, unknown> | undefined;
    const spec = (detail?.spec ?? {}) as Record<string, unknown>;
    const category = (detail?.category ?? {}) as Record<string, unknown>;
    const events = extractEncarEvents(payload).map((e) => ({
      eventType: e.eventType,
      description: en(e.description) ?? e.description ?? "Event",
      occurredAt:
        e.occurredAt instanceof Date
          ? e.occurredAt.toISOString()
          : typeof e.occurredAt === "string"
            ? e.occurredAt
            : undefined,
      metadata: e.metadata as Record<string, unknown> | undefined,
    }));

    const photos = collectPhotoUrls(
      detail?.photos,
      (payload.view as Record<string, unknown> | null | undefined)?.photos,
      listing.photos?.map((p) => p.sourceUrl),
    );
    const adFields = extractEncarAdvertisementFields(payload);
    const listed = normalizeEncarListedPrice(adFields.price ?? listing.priceAmount);
    const msrp = normalizeEncarListedPrice(category.originPrice);
    const activity = normalizeEncarListingActivity(
      adFields.status ?? (listing.isActive === false ? "SOLD" : listing.listingStatus),
    );
    const vehicle: LiveVehicle = {
      listingId,
      vin: listing.vehicle?.vin,
      make: en(listing.vehicle?.make),
      model: en(listing.vehicle?.model),
      trim: en(listing.vehicle?.trim),
      badge: en(listing.vehicle?.trim),
      modelGroup: en(
        (category.modelGroupEnglishName as string | undefined) ??
          (category.modelName as string | undefined),
      ),
      year: listing.vehicle?.year,
      mileage: listing.mileage,
      price: listed.onRequest ? undefined : listed.krw,
      priceOnRequest: listed.onRequest || undefined,
      msrp: msrp.onRequest ? undefined : msrp.krw,
      currency: listing.priceCurrency ?? "KRW",
      fuel: en(listing.vehicle?.fuelType),
      transmission: en(listing.vehicle?.transmission),
      drivetrain: en(listing.vehicle?.driveType),
      bodyType: en(listing.vehicle?.bodyType),
      color: en(listing.vehicle?.color),
      engineDisplacement: listing.vehicle?.engineDisplacement,
      location: en(listing.location),
      country: "South Korea",
      photos,
      listingUrl: listing.sourceUrl,
      status: activity.listingStatus === "sold" ? "SOLD" : activity.listingStatus === "reserved" ? "RESERVED" : activity.listingStatus === "inactive" ? "REMOVED" : "AVAILABLE",
      accidentCount: listing.accidentCount,
      ownerChangeCount: listing.ownerChangeCount,
    };

    return {
      vehicle,
      vin: listing.vehicle?.vin,
      trim: en(listing.vehicle?.trim),
      bodyType: en(normalizeEncarBody(spec.bodyName as string) ?? listing.vehicle?.bodyType),
      color: en(normalizeEncarColor(spec.colorName as string) ?? listing.vehicle?.color),
      engineDisplacement: listing.vehicle?.engineDisplacement,
      features: extractFeatures(detail),
      photos,
      events,
      registry: buildRegistry(payload.record ?? undefined),
      diagnosis: payload.diagnosis ? englishizeEncarJson(payload.diagnosis) : null,
      inspection: payload.inspection ? englishizeEncarJson(payload.inspection) : null,
      listingUrl: listing.sourceUrl,
    };
  } catch {
    return null;
  }
}

export async function testEncarLiveConnectivity(): Promise<{ ok: boolean; error?: string }> {
  try {
    const adapter = new EncarHistoricalAdapter(DETAIL_WEB_BASE, { carType: "import", pageSize: 1 });
    const { results } = await adapter.searchResults(1, 1);
    if (results.length === 0) {
      return { ok: true }; // API reachable, zero results is still OK
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function getEncarLiveFilterOptions(carType?: string, make?: string) {
  return {
    makes: encarMakesForCarType(carType),
    models: encarModelsForMake(make),
    fuels: ["Gasoline", "Diesel", "Electric", "Hybrid", "LPG"],
    transmissions: ["Automatic", "Manual", "CVT"],
    drivetrains: ["FWD", "RWD", "AWD", "4WD"],
    bodyTypes: ["Sedan", "SUV", "Coupe", "Hatchback", "Wagon", "Van"],
    carTypes: [
      { value: "import", label: "Import" },
      { value: "domestic", label: "Domestic" },
      { value: "all", label: "All" },
    ],
    sortOptions: [
      { value: "createdDate:desc", label: "Newest listed" },
      { value: "price:asc", label: "Price: low → high" },
      { value: "price:desc", label: "Price: high → low" },
      { value: "year:desc", label: "Year: newest" },
      { value: "mileage:asc", label: "Mileage: lowest" },
    ],
  };
}
