import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedEvent,
  NormalizedListing,
  PaginationInfo,
} from "@workspace/providers";
import { CHINA, withCountry } from "../geo";
import {
  normalizeEuBodyType,
  normalizeEuColor,
  normalizeEuFuel,
  normalizeEuTransmission,
} from "./eu-locale";
import { findVinInListing, normalizeKrVin, parseYear, vehicleFromParts } from "./kr-common";
import { moneyListing } from "./us-common";
import {
  asArray,
  asPhotos,
  asRecord,
  firstRegEvent,
  MARKET_UA,
  num,
  productionFirstRegEvent,
  str,
} from "./web-html";
import {
  normalizeZhBodyType,
  normalizeZhColor,
  normalizeZhFuel,
  normalizeZhTransmission,
  titleCaseCity,
} from "./zh-locale";

export const CHE168_PARSER_VERSION = "che168-v1.0.0";

const SITE = "https://global.che168.com";
const API = "https://globalapi.che168.com";
const APP_ID = "che168.global.pc";
const PAGE_SIZE = 100;
const LOCALE = "en";

const JSON_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "User-Agent": MARKET_UA,
  Origin: SITE,
  Referer: `${SITE}/en/used-cars`,
  "Accept-Language": "en-US,en;q=0.9",
};

export function che168DetailUrl(idOrUrl: string): string {
  const raw = idOrUrl.trim();
  if (raw.startsWith("http")) {
    const m = raw.match(/\/detail\/(\d+)/i);
    if (m?.[1]) return `${SITE}/en/detail/${m[1]}`;
    return raw.split("?")[0]!.replace(/\/$/, "");
  }
  if (raw.startsWith("/")) {
    const m = raw.match(/\/detail\/(\d+)/i);
    if (m?.[1]) return `${SITE}/en/detail/${m[1]}`;
    return `${SITE}${raw.split("?")[0]}`;
  }
  return `${SITE}/en/detail/${raw.replace(/^detail\//i, "")}`;
}

function sourceIdFromUrl(url: string): string {
  const m = url.match(/\/detail\/(\d+)/i);
  return m?.[1] || url.replace(/^\D+/, "").split(/[/?#]/)[0] || url;
}

function resultOf(root: Record<string, unknown>): Record<string, unknown> {
  return asRecord(root.result) ?? {};
}

function cleanText(raw?: string | null): string | undefined {
  const t = str(raw)?.trim();
  if (!t || t === "--" || t === "-" || t === "无" || /^n\/?a$/i.test(t)) return undefined;
  return t;
}

function vinOf(raw?: string | null, context = ""): string | undefined {
  const text = cleanText(raw);
  if (!text || /\*/.test(text)) return undefined;
  const vin = normalizeKrVin(text) ?? findVinInListing(context || text);
  return vin && vin.length === 17 ? vin : undefined;
}

function driveOf(raw?: string | null): string | undefined {
  const t = cleanText(raw);
  if (!t) return undefined;
  if (/四驱|全时|及时|awd|4wd|4x4|all[\s-]?wheel/i.test(t)) return "AWD";
  if (/前驱|fwd|front/i.test(t)) return "FWD";
  if (/后驱|rwd|rear/i.test(t)) return "RWD";
  return t;
}

function yearFromCar(car: Record<string, unknown>): number | undefined {
  return (
    parseYear(cleanText(str(car.regdate)) ?? cleanText(str(car.yearname)) ?? cleanText(str(car.specname)) ?? cleanText(str(car.carname))) ??
    parseYear(cleanText(str(car.producedate)) ?? cleanText(str(car.manufacturedate)))
  );
}

function photosOf(car: Record<string, unknown>): ReturnType<typeof asPhotos> {
  const urls: string[] = [];
  const cate = asArray(car.catepiclist);
  for (const block of cate) {
    const rec = asRecord(block);
    const list = asArray(rec?.list ?? rec?.List);
    for (const item of list) {
      if (typeof item === "string" && /^https?:\/\//i.test(item)) urls.push(item.split("?")[0]!);
      else {
        const img = asRecord(item);
        const u = str(img?.url) ?? str(img?.imageurl) ?? str(img?.picurl);
        if (u && /^https?:\/\//i.test(u)) urls.push(u.split("?")[0]!);
      }
    }
  }
  const cover = cleanText(str(car.imageurl));
  if (cover) urls.unshift(cover.split("?")[0]!);
  return asPhotos(urls, 40);
}

function eventsOf(car: Record<string, unknown>): NormalizedEvent[] | undefined {
  const events: NormalizedEvent[] = [];
  const reg =
    firstRegEvent(cleanText(str(car.regdate))) ??
    firstRegEvent(cleanText(str(car.manufacturedate))) ??
    productionFirstRegEvent(yearFromCar(car));
  if (reg) events.push(reg);
  return events.length ? events : undefined;
}

function parseCar(car: Record<string, unknown>): NormalizedListing {
  const infoId = String(num(car.infoid) ?? cleanText(str(car.infoid)) ?? "");
  if (!infoId) throw new Error("Che168 car missing infoid");

  const make = cleanText(str(car.brandname));
  const series = cleanText(str(car.seriesname));
  const spec = cleanText(str(car.specname));
  const model = series?.replace(new RegExp(`^${make}\\s+`, "i"), "") || series;
  const year = yearFromCar(car);
  const title =
    cleanText(str(car.carname)) ||
    [year, make, model, spec].filter(Boolean).join(" ") ||
    `Che168 ${infoId}`;

  const fuel =
    normalizeEuFuel(cleanText(str(car.fuelname))) ??
    normalizeZhFuel(cleanText(str(car.fuelname)));
  const transmission =
    normalizeEuTransmission(cleanText(str(car.gearbox))) ??
    normalizeZhTransmission(cleanText(str(car.gearbox)));
  const bodyType =
    normalizeEuBodyType(cleanText(str(car.level)) ?? cleanText(str(car.structure))) ??
    normalizeZhBodyType(cleanText(str(car.level)) ?? cleanText(str(car.structure)));
  const color =
    normalizeEuColor(cleanText(str(car.color))) ?? normalizeZhColor(cleanText(str(car.color)));

  const city = titleCaseCity(cleanText(str(car.cname)));
  const location = withCountry(city, CHINA) ?? CHINA;
  const vin = vinOf(str(car.vincode), JSON.stringify(car));
  const price = num(car.price);
  const mileage = num(car.mileage);

  return moneyListing({
    sourceId: infoId,
    sourceUrl: che168DetailUrl(infoId),
    title,
    price: price != null && price > 0 ? price : undefined,
    // Global export catalog publishes asking prices in USD.
    currency: "USD",
    mileage: mileage != null && mileage >= 0 ? mileage : undefined,
    mileageUnit: "km",
    location,
    country: CHINA,
    vehicle: vehicleFromParts({
      vin,
      make,
      model,
      year,
      trim: spec,
      bodyType,
      color,
      fuelType: fuel,
      transmission,
      driveType: driveOf(str(car.drivingmode)),
      engineDisplacement: cleanText(str(car.engine)),
      country: CHINA,
    }),
    photos: photosOf(car),
    events: eventsOf(car),
  });
}

export class Che168HistoricalAdapter implements ProviderAdapter {
  readonly internalName: string;
  private readonly deviceId: string;

  constructor(
    private _baseUrl?: string,
    private _filters: Record<string, unknown> = {},
    internalName = "che168",
  ) {
    this.internalName = internalName;
    // Search pagination is tied to a stable deviceid — rotating it resets to page 1.
    this.deviceId = `gca-${internalName}-${Date.now().toString(36)}`;
  }

  private apiQuery(extra: Record<string, string> = {}): string {
    const qs = new URLSearchParams({
      _appid: APP_ID,
      deviceid: this.deviceId,
      language: LOCALE,
      fromsource: "0",
      ...extra,
    });
    return qs.toString();
  }

  private async getJson(path: string, extra: Record<string, string> = {}): Promise<Record<string, unknown>> {
    const url = `${API}${path}?${this.apiQuery(extra)}`;
    const res = await fetch(url, {
      headers: JSON_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(45_000),
    });
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(`Che168 non-JSON ${res.status} at ${path}: ${text.slice(0, 120)}`);
    }
    const root = asRecord(parsed) ?? {};
    const code = num(root.returncode);
    if (code != null && code !== 0) {
      throw new Error(`Che168 API ${code} at ${path}: ${str(root.message) ?? "error"}`);
    }
    if (!res.ok) throw new Error(`Che168 HTTP ${res.status} at ${path}`);
    return root;
  }

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const p = Math.max(1, page);
    const root = await this.getJson("/api/v1/search", {
      pageindex: String(p),
      pagesize: String(PAGE_SIZE),
    });
    const result = resultOf(root);
    const cars = asArray(result.carlist).map((c) => asRecord(c)).filter(Boolean) as Record<string, unknown>[];

    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const car of cars) {
      const id = String(num(car.infoid) ?? "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      listings.push({
        sourceId: id,
        url: che168DetailUrl(id),
        metadata: {
          mileage: num(car.mileage),
          price: num(car.price),
          make: cleanText(str(car.brandname)),
          model: cleanText(str(car.seriesname)),
          year: yearFromCar(car),
          fuel: cleanText(str(car.fuelname)),
        },
      });
    }

    const total = num(result.totalcount);
    const pageCount = num(result.pagecount) ?? (total != null ? Math.ceil(total / PAGE_SIZE) : undefined);
    const hasMore = pageCount != null ? p < pageCount : listings.length >= PAGE_SIZE;

    return {
      listings,
      pagination: {
        currentPage: p,
        hasMore,
        totalPages: pageCount,
        resultTotal: total,
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const id = sourceIdFromUrl(url);
    const root = await this.getJson(`/api/v1/carinfo/${id}`);
    const car = resultOf(root);
    return {
      url: che168DetailUrl(id),
      html: JSON.stringify(car),
      statusCode: 200,
      headers: { "content-type": "application/json" },
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const raw = fetched.html ?? "";
    try {
      const car = asRecord(JSON.parse(raw));
      if (car && (car.infoid != null || car.carname != null)) return parseCar(car);
    } catch {
      // fall through
    }
    const id = sourceIdFromUrl(fetched.url);
    return moneyListing({
      sourceId: id,
      sourceUrl: che168DetailUrl(id),
      currency: "USD",
      mileageUnit: "km",
      country: CHINA,
      location: CHINA,
      vehicle: vehicleFromParts({
        vin: findVinInListing(raw),
        country: CHINA,
      }),
      photos: [],
    });
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin;
  }

  extractMileage(listing: NormalizedListing): number | undefined {
    return listing.mileage;
  }
}

/** Same Autohome Global export catalog (duplicate inventory — fleet-skipped). */
export function createAutohomeAdapter(baseUrl?: string, filters: Record<string, unknown> = {}) {
  return new Che168HistoricalAdapter(baseUrl, filters, "autohome");
}

export const AUTOHOME_PARSER_VERSION = CHE168_PARSER_VERSION;
