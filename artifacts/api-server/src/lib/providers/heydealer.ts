import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  NormalizedVehicle,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import {
  krwListing,
  normalizeKrVin,
  vehicleFromParts,
  type KrFilterParams,
} from "./kr-common";

export const HEYDEALER_PARSER_VERSION = "heydealer-v1.0.0";
const MARKET_API = "https://market-api.heydealer.com/v2/customers/web/market";
const INIT_URL = "https://api.heydealer.com/v2/customers/web/initialize_app/";
const PAGE_SIZE = 20;
const TOKEN_TTL_MS = 40 * 60_000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36";

let cachedToken: string | undefined;
let tokenFetchedAt = 0;

async function getToken(): Promise<string> {
  if (cachedToken && Date.now() - tokenFetchedAt < TOKEN_TTL_MS) return cachedToken;
  const res = await fetch(INIT_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      Origin: "https://www.heydealer.com",
      Referer: "https://www.heydealer.com/",
    },
    body: JSON.stringify({ referrer_url: "https://www.heydealer.com/market" }),
  });
  if (!res.ok) throw new Error(`Heydealer init failed: ${res.status}`);
  const json = (await res.json()) as { token?: string };
  if (!json.token) throw new Error("Heydealer init: no token");
  cachedToken = json.token;
  tokenFetchedAt = Date.now();
  return cachedToken;
}

function apiHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    "User-Agent": UA,
    Origin: "https://www.heydealer.com",
    Referer: "https://www.heydealer.com/market",
  };
}

export function heydealerDetailUrl(hashId: string): string {
  return `https://www.heydealer.com/market/cars/${hashId}`;
}

interface HdCar {
  hash_id?: string;
  price?: number;
  sale_status?: string;
  is_reserved?: boolean;
  detail_info?: {
    image_urls?: string[];
    model_name?: string;
    model_part_name?: string;
    grade_name?: string;
    grade_part_name?: string;
    detail_name?: string;
    year?: number;
    mileage?: number;
    initial_registration_date?: string;
    exterior_description?: string;
    interior_description?: string;
    options?: Array<{ name?: string; choice?: string }>;
  };
  total_info?: {
    fuel_type?: string;
    transmission?: string;
    displacement?: number;
    drive_type?: string;
    car_number?: string;
  };
}

function parseCar(car: HdCar): NormalizedListing {
  const hashId = car.hash_id ?? "unknown";
  const d = car.detail_info ?? {};
  const t = (car as { total_info?: HdCar["total_info"] }).total_info;

  const title = [d.model_name, d.grade_name, d.detail_name].filter(Boolean).join(" ");
  const parts = (d.model_name ?? "").split(/\s+/);
  const make = parts[0];
  const model = parts.slice(1).join(" ") || d.model_part_name;

  const price = typeof car.price === "number" ? Math.round(car.price * 10_000) : undefined;
  const sold = car.sale_status === "sold" || car.sale_status === "completed";

  const photos: NormalizedPhoto[] = (d.image_urls ?? []).map((url, i) => ({
    url,
    isPrimary: i === 0,
  }));

  const vehicle = vehicleFromParts({
    make,
    model,
    trim: d.grade_name,
    year: d.year,
    fuelType: t?.fuel_type,
    transmission: t?.transmission,
    color: d.exterior_description,
    engineDisplacement: t?.displacement ? String(t.displacement) : undefined,
    driveType: t?.drive_type,
  });

  return krwListing({
    sourceId: hashId,
    sourceUrl: heydealerDetailUrl(hashId),
    title,
    price,
    mileage: d.mileage,
    sold,
    reserved: car.is_reserved,
    vehicle,
    photos,
  });
}

export class HeydealerHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "heydealer";
  private filters: KrFilterParams;

  constructor(_baseUrl?: string, filters: KrFilterParams = {}) {
    this.filters = filters;
  }

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const token = await getToken();
    const url = `${MARKET_API}/cars/?page=${page}&page_size=${PAGE_SIZE}`;
    const res = await fetch(url, { headers: apiHeaders(token) });
    if (!res.ok) throw new Error(`Heydealer list ${res.status}`);
    const data = (await res.json()) as HdCar[];
    const results = Array.isArray(data) ? data : [];
    const listings: ListingReference[] = results.map((car) => {
      const hashId = String(car.hash_id ?? "");
      return {
        sourceId: hashId,
        url: `${MARKET_API}/cars/${hashId}/`,
        metadata: car,
      };
    });
    return {
      listings,
      pagination: { currentPage: page, hasMore: results.length >= PAGE_SIZE },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const token = await getToken();
    const res = await fetch(url, { headers: apiHeaders(token) });
    const text = await res.text();
    return { url, html: text, statusCode: res.status, headers: Object.fromEntries(res.headers.entries()) };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    let car: HdCar;
    try {
      car = JSON.parse(fetched.html ?? "{}") as HdCar;
    } catch {
      car = {};
    }
    return parseCar(car);
  }

  async normalizeVehicle(listing: NormalizedListing): Promise<NormalizedVehicle> {
    return listing.vehicle ?? {};
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin ? normalizeKrVin(listing.vehicle.vin) : undefined;
  }

  extractPhotos(listing: NormalizedListing): NormalizedPhoto[] {
    return listing.photos ?? [];
  }
}
