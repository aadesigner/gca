import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import { CZECHIA } from "../geo";
import {
  normalizeEuBodyType,
  normalizeEuColor,
  normalizeEuFuel,
  normalizeEuTransmission,
} from "./eu-locale";
import { findVinInListing, normalizeKrVin, parseYear, vehicleFromParts, vinCheckDigitOk } from "./kr-common";
import { moneyListing } from "./us-common";
import {
  asArray,
  asPhotos,
  asRecord,
  fetchHtml,
  firstRegEvent,
  MARKET_UA,
  num,
  str,
} from "./web-html";

export const SAUTO_PARSER_VERSION = "sauto-v1.0.1";
const BASE = "https://www.sauto.cz";
const API = `${BASE}/api/v1/items`;
const PAGE_SIZE = 50;

const JSON_HEADERS = {
  Accept: "application/json",
  "Accept-Language": "cs-CZ,cs;q=0.9,en;q=0.5",
  "User-Agent": MARKET_UA,
  Referer: `${BASE}/`,
};

export function sautoDetailUrl(
  id: string,
  manufacturerSeo?: string,
  modelSeo?: string,
): string {
  if (id.startsWith("http")) return id;
  if (id.startsWith("/")) return `${BASE}${id}`;
  if (manufacturerSeo && modelSeo) {
    return `${BASE}/osobni/detail/${manufacturerSeo}/${modelSeo}/${id}`;
  }
  return `${BASE}/inzerat/${id}`;
}

function absImage(url?: string): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("http")) return url;
  return undefined;
}

function cbName(value: unknown): string | undefined {
  const rec = asRecord(value);
  return str(rec?.name) ?? str(value);
}

function cbSeo(value: unknown): string | undefined {
  return str(asRecord(value)?.seo_name);
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: JSON_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Sauto API ${res.status} at ${url}`);
  try {
    return JSON.parse(text);
  } catch {
    // Fallback via fetchHtml if body is HTML-wrapped.
    const html = await fetchHtml(url, JSON_HEADERS);
    try {
      return JSON.parse(html.text);
    } catch {
      throw new Error(`Sauto API non-JSON at ${url}`);
    }
  }
}

function parseItem(item: Record<string, unknown>, pageUrl?: string): NormalizedListing {
  const id = String(str(item.id) ?? pageUrl?.match(/\/(\d+)(?:\?|$)/)?.[1] ?? "unknown");
  const makeSeo = cbSeo(item.manufacturer_cb);
  const modelSeo = cbSeo(item.model_cb);
  const sourceUrl = sautoDetailUrl(id, makeSeo, modelSeo);

  const rawVin = str(item.vin) ?? findVinInListing(str(item.description) ?? "", str(item.name) ?? "");
  const vinNorm = rawVin ? normalizeKrVin(rawVin) : undefined;
  const vin = vinNorm && vinCheckDigitOk(vinNorm) ? vinNorm : undefined;

  const make = cbName(item.manufacturer_cb);
  const model = cbName(item.model_cb);
  const title = str(item.name) ?? [make, model].filter(Boolean).join(" ");
  const price = num(item.price);
  const mileage = num(item.tachometer);
  const year =
    parseYear(str(item.in_operation_date)) ??
    parseYear(str(item.manufacturing_date)) ??
    parseYear(title);

  const photoUrls = asArray(item.images)
    .map((img) => absImage(str(asRecord(img)?.url) ?? str(img)))
    .filter((u): u is string => !!u);

  const firstReg = firstRegEvent(item.in_operation_date);
  const locality = asRecord(item.locality);
  const city = str(locality?.city) ?? str(locality?.district) ?? str(locality?.name);
  const engineCc = num(item.engine_volume) ?? num(item.capacity);

  return moneyListing({
    sourceId: id,
    sourceUrl,
    title,
    price,
    currency: "CZK",
    mileage,
    mileageUnit: "km",
    location: city ? `${city}, ${CZECHIA}` : CZECHIA,
    country: CZECHIA,
    vehicle: vehicleFromParts({
      vin,
      make,
      model,
      year,
      trim: str(item.additional_model_name),
      fuelType: normalizeEuFuel(cbName(item.fuel_cb)),
      transmission: normalizeEuTransmission(cbName(item.gearbox_cb)),
      bodyType: normalizeEuBodyType(cbName(item.category) ?? cbName(item.condition_cb)),
      color: normalizeEuColor(cbName(item.color_cb)),
      engineDisplacement: engineCc ? `${engineCc}` : undefined,
      country: CZECHIA,
    }),
    photos: vin ? asPhotos(photoUrls) : [],
    events: firstReg ? [firstReg] : undefined,
  });
}

export class SautoHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "sauto";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const offset = Math.max(0, (Math.max(1, page) - 1) * PAGE_SIZE);
    const json = asRecord(await fetchJson(`${API}/search?limit=${PAGE_SIZE}&offset=${offset}`));
    const results = asArray(json?.results);
    const total = num(asRecord(json?.pagination)?.total);

    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const row of results) {
      const rec = asRecord(row);
      if (!rec) continue;
      const id = str(rec.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      listings.push({
        sourceId: id,
        url: sautoDetailUrl(id, cbSeo(rec.manufacturer_cb), cbSeo(rec.model_cb)),
        metadata: {
          vin: str(rec.vin),
          mileage: num(rec.tachometer),
          price: num(rec.price),
        },
      });
    }

    const totalPages = total != null ? Math.ceil(total / PAGE_SIZE) : undefined;
    return {
      listings,
      pagination: {
        currentPage: page,
        hasMore: totalPages != null ? page < totalPages : listings.length >= PAGE_SIZE,
        totalPages,
        resultTotal: total,
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const id = url.match(/\/(\d+)(?:\?|$)/)?.[1] ?? url.replace(/.*\//, "");
    const json = await fetchJson(`${API}/${encodeURIComponent(id)}`);
    return {
      url,
      html: JSON.stringify(json),
      statusCode: 200,
      headers: { "content-type": "application/json" },
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const raw = fetched.html ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = undefined;
    }
    const root = asRecord(parsed);
    const item = asRecord(root?.result) ?? root;
    if (item && (item.id != null || item.vin != null || item.name != null)) {
      return parseItem(item, fetched.url);
    }

    const vin = findVinInListing(raw);
    const id = fetched.url.match(/\/(\d+)(?:\?|$)/)?.[1] ?? "unknown";
    return moneyListing({
      sourceId: id,
      sourceUrl: fetched.url,
      currency: "CZK",
      mileageUnit: "km",
      country: CZECHIA,
      location: CZECHIA,
      vehicle: vehicleFromParts({ vin, country: CZECHIA }),
      photos: [],
    });
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin;
  }

  extractPhotos(listing: NormalizedListing): NormalizedPhoto[] {
    return listing.photos ?? [];
  }
}
