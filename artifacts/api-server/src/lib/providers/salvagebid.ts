import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  NormalizedVehicle,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import { CANADA, USA, normalizeVin, usMiListing } from "./us-common";
import { vehicleFromParts } from "./kr-common";
import { parseTitleState, textIndicatesSalvage } from "../salvage-title";
import type { NormalizedEvent } from "@workspace/providers";

export const SALVAGEBID_PARSER_VERSION = "salvagebid-v2.0.1";
const BASE = "https://www.salvagebid.com";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const PAGE_SIZE = 26;
const MAX_PHOTOS = 40;

export function salvagebidDetailUrl(idOrSlug: string): string {
  if (idOrSlug.startsWith("http")) return idOrSlug;
  const cleaned = idOrSlug.replace(/^\/+/, "");
  const path = cleaned.startsWith("vehicle/") ? cleaned : `vehicle/${cleaned}`;
  return `${BASE}/${path}`;
}

interface SbLot {
  stock_number?: number | string;
  details_url?: string;
  vin?: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  vehicle_name?: string;
  vehicle_type?: string;
  body_style?: string;
  color?: string;
  odometer_value?: number;
  odometer_type?: string;
  odometer_status?: string;
  location_city?: string;
  location_state?: string;
  location_zip?: string;
  location_address?: string;
  selling_branch?: string;
  damage?: string;
  primary_damage?: string;
  secondary_damage?: string;
  loss_type?: string;
  title_name?: string;
  title_state?: string;
  title_brand?: string;
  doc_type?: string;
  already_sold?: boolean;
  current_bid_value?: number | string | null;
  buy_it_now?: number | string | null;
  retail_value?: number | string | null;
  acv?: number | string | null;
  repair_cost?: number | string | null;
  currency?: string;
  images?: string[];
  vin_model?: string;
  vin_series?: string;
  vin_engine?: string;
  vin_fuel_type?: string;
  vin_transmission?: string;
  vin_drive_line_type?: string;
  vin_body?: string;
  vin_cylinder?: string;
  updated_at_iso?: string;
  key_status?: string;
  airbags?: string;
  start_code?: string;
  auction_type_str?: string;
}

interface SbLotPayload {
  lot: SbLot;
  sale_location?: string;
  sold?: boolean;
  auctionHouse?: string;
}

function extractJsonObject(html: string, marker: string): unknown | undefined {
  const idx = html.indexOf(marker);
  if (idx < 0) return undefined;
  let i = idx + marker.length;
  while (i < html.length && html[i] !== "{") i++;
  if (html[i] !== "{") return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = i; j < html.length; j++) {
    const c = html[j]!;
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(i, j + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

function extractLotPayload(html: string): SbLotPayload | undefined {
  const rq = extractJsonObject(html, "window.__REACT_QUERY_STATE__") as {
    queries?: Array<{ queryKey?: unknown; state?: { data?: unknown } }>;
  } | undefined;
  if (!rq?.queries) return undefined;

  let auctionHouse: string | undefined;
  let payload: SbLotPayload | undefined;

  for (const q of rq.queries) {
    const key = q.queryKey;
    if (!Array.isArray(key) || key.length === 0) continue;
    if (key[0] === "lot similar info") {
      const house = String(key[2] ?? "").toLowerCase();
      if (house === "copart" || house === "iaa" || house === "iaai") {
        auctionHouse = house === "iaa" ? "IAA" : house === "iaai" ? "IAA" : "Copart";
      }
      continue;
    }
    if (key[0] !== "lot" || key.length !== 2) continue;
    const data = q.state?.data as { lot?: SbLot; sale_location?: string; sold?: boolean } | undefined;
    if (!data?.lot || typeof data.lot !== "object") continue;
    payload = {
      lot: data.lot,
      sale_location: data.sale_location,
      sold: data.sold,
    };
  }

  if (!payload) return undefined;
  if (auctionHouse) payload.auctionHouse = auctionHouse;
  return payload;
}

function slugFromHref(href: string): string | undefined {
  const match = href.match(/\/vehicle\/(\d+-[a-z0-9-]+)/i);
  return match?.[1]?.toLowerCase();
}

function collectSlugs(html: string): string[] {
  const seen = new Set<string>();
  const slugs: string[] = [];
  for (const match of html.matchAll(/\/vehicle\/(\d+-[a-z0-9-]+)/gi)) {
    const slug = match[1]!.toLowerCase();
    if (seen.has(slug)) continue;
    seen.add(slug);
    slugs.push(slug);
  }
  return slugs;
}

async function sbFetch(url: string): Promise<{ text: string; status: number; finalUrl: string }> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": UA,
      Accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      Referer: `${BASE}/salvage-cars-for-sale`,
    },
    redirect: "follow",
  });
  return { text: await res.text(), status: res.status, finalUrl: res.url };
}

function num(raw: unknown): number | undefined {
  if (raw == null || raw === "") return undefined;
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(/[$,]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}

function positiveMoney(raw: unknown): number | undefined {
  const n = num(raw);
  return n != null && n > 0 ? Math.round(n) : undefined;
}

function mileageMiles(lot: SbLot): number | undefined {
  const raw = num(lot.odometer_value);
  if (raw == null || raw < 0) return undefined;
  const unit = String(lot.odometer_type ?? "mi").toLowerCase();
  if (unit === "km" || unit === "kilometer" || unit === "kilometers") {
    return Math.round(raw * 0.621371);
  }
  return Math.round(raw);
}

function locationOf(lot: SbLot, saleLocation?: string): { location: string; country: string } {
  const blob = [saleLocation, lot.location_city, lot.location_state, lot.selling_branch].filter(Boolean).join(" ");
  const country =
    /canada/i.test(blob) ||
    (/\b(ON|QC|BC|AB|MB|SK|NS|NB|NL|PE|YT|NT|NU)\b/i.test(blob) && !/\bUSA\b|united states/i.test(blob))
      ? CANADA
      : USA;
  const fromSale = saleLocation?.trim();
  if (fromSale) {
    return { location: fromSale.replace(/,?\s*USA\s*$/i, "").trim() || country, country };
  }
  const parts = [lot.location_city, lot.location_state, lot.location_zip].filter(Boolean);
  const location = parts.join(", ") || lot.selling_branch || country;
  return { location, country };
}

function engineLiters(engine?: string): string | undefined {
  const m = engine?.match(/(\d+(?:\.\d+)?)\s*L/i);
  return m?.[1];
}

function titleOf(lot: SbLot): string {
  const named = String(lot.vehicle_name ?? "").replace(/\s+/g, " ").trim();
  if (named) return named;
  return [lot.year, lot.make, lot.model, lot.trim].filter(Boolean).join(" ").trim();
}

function photosFromLot(lot: SbLot): NormalizedPhoto[] {
  const urls: string[] = [];
  for (const raw of lot.images ?? []) {
    const url = String(raw ?? "").trim();
    if (!url.startsWith("http")) continue;
    if (/\.(svg)(\?|$)/i.test(url)) continue;
    if (/logo|icon|placeholder|sprite/i.test(url)) continue;
    if (urls.includes(url)) continue;
    urls.push(url);
    if (urls.length >= MAX_PHOTOS) break;
  }
  return urls.map((sourceUrl, i) => ({
    sourceUrl,
    isPrimary: i === 0,
    sortOrder: i,
  }));
}

function listingFromLot(sourceId: string, sourceUrl: string, payload: SbLotPayload): NormalizedListing {
  const lot = payload.lot;
  const vin = normalizeVin(lot.vin);
  const { location, country } = locationOf(lot, payload.sale_location);
  const sold = Boolean(payload.sold || lot.already_sold);
  const price =
    positiveMoney(lot.current_bid_value) ??
    positiveMoney(lot.buy_it_now) ??
    positiveMoney(lot.retail_value);

  const vehicle = vehicleFromParts({
    vin,
    make: lot.make,
    model: lot.vin_model || lot.model,
    trim: lot.trim || lot.vin_series,
    year: lot.year,
    bodyType: lot.body_style || lot.vin_body,
    fuelType: lot.vin_fuel_type,
    transmission: lot.vin_transmission,
    driveType: lot.vin_drive_line_type,
    engineDisplacement: engineLiters(lot.vin_engine),
    color: lot.color,
    country,
  });

  const extra = vehicle as Record<string, unknown>;
  if (lot.primary_damage || lot.damage) extra.damageType = lot.primary_damage || lot.damage;
  if (lot.secondary_damage) extra.secondaryDamage = lot.secondary_damage;
  if (lot.loss_type) extra.lossType = lot.loss_type;
  if (lot.title_name || lot.doc_type) extra.titleBrand = lot.title_name || lot.doc_type;
  if (lot.doc_type) extra.docType = lot.doc_type;
  if (lot.title_state) extra.titleState = lot.title_state;
  if (lot.vin_engine) extra.engine = lot.vin_engine;
  if (lot.vin_cylinder) extra.cylinders = lot.vin_cylinder;
  if (lot.stock_number != null) extra.stockNumber = String(lot.stock_number);
  if (lot.odometer_status) extra.odometerStatus = lot.odometer_status;
  if (lot.key_status) extra.keyStatus = lot.key_status;
  if (lot.airbags) extra.airbags = lot.airbags;
  if (lot.auction_type_str) extra.auctionType = lot.auction_type_str;
  if (payload.auctionHouse) extra.auctionHouse = payload.auctionHouse;
  if (lot.acv != null) extra.actualCashValue = num(lot.acv);
  if (lot.repair_cost != null) extra.repairCost = num(lot.repair_cost);

  const modified = lot.updated_at_iso ? new Date(lot.updated_at_iso) : undefined;
  const titleText = [lot.title_name, lot.doc_type].filter(Boolean).join(" — ").trim();
  const titleEvents: NormalizedEvent[] = [];
  if (titleText) {
    titleEvents.push({
      eventType: "title_status",
      description: `Title: ${titleText}`,
      occurredAt: modified && !Number.isNaN(modified.getTime()) ? modified : new Date(),
      metadata: {
        source: "salvagebid",
        field: "title_name",
        value: titleText,
        salvage: textIndicatesSalvage(titleText),
        state: lot.title_state?.trim().toUpperCase() || parseTitleState(titleText),
        region: country === CANADA || /canada/i.test(String(country)) ? "CA" : "US",
        usCanada: true,
      },
    });
  }

  return {
    ...usMiListing({
      sourceId,
      sourceUrl,
      title: titleOf(lot),
      price,
      mileage: mileageMiles(lot),
      location,
      country,
      sold,
      vehicle,
      photos: photosFromLot(lot),
      events: titleEvents.length ? titleEvents : undefined,
    }),
    sourceModifiedAt: modified && !Number.isNaN(modified.getTime()) ? modified : undefined,
  };
}

export class SalvagebidHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "salvagebid";

  constructor(
    private _baseUrl?: string,
    private _filters: Record<string, unknown> = {},
  ) {}

  async discoverListings(
    page: number,
  ): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const urls = [
      `${BASE}/salvage-cars-for-sale?page=${page}`,
      `${BASE}/search/auction-copart?page=${page}`,
    ];
    const seen = new Set<string>();
    const listings: ListingReference[] = [];
    let anyFullPage = false;

    for (const url of urls) {
      const fetched = await sbFetch(url);
      const slugs = collectSlugs(fetched.text);
      if (slugs.length >= PAGE_SIZE) anyFullPage = true;
      for (const slug of slugs) {
        const stock = slug.split("-")[0]!;
        if (seen.has(stock)) continue;
        seen.add(stock);
        listings.push({
          sourceId: slug,
          url: salvagebidDetailUrl(slug),
        });
      }
    }

    return {
      listings,
      pagination: {
        currentPage: page,
        hasMore: anyFullPage || listings.length >= PAGE_SIZE,
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await sbFetch(url);
    if (fetched.status === 404 || fetched.status === 410) {
      const err = new Error(`Salvagebid listing not found: ${url}`);
      (err as { statusCode?: number }).statusCode = fetched.status;
      throw err;
    }
    const payload = extractLotPayload(fetched.text);
    return {
      url: fetched.finalUrl || url,
      html: fetched.text,
      json: payload,
      statusCode: fetched.status,
      headers: {},
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const slug =
      slugFromHref(fetched.url) ||
      fetched.url.match(/vehicle\/([^/?#]+)/i)?.[1] ||
      "unknown";
    const sourceUrl = salvagebidDetailUrl(slug);

    const payload = (fetched.json as SbLotPayload | undefined) ?? extractLotPayload(fetched.html ?? "");
    if (payload?.lot) {
      return listingFromLot(slug, payload.lot.details_url ? salvagebidDetailUrl(payload.lot.details_url) : sourceUrl, payload);
    }

    return usMiListing({
      sourceId: slug,
      sourceUrl,
      title: slug,
      vehicle: vehicleFromParts({ vin: undefined }),
      photos: [],
    });
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
}
