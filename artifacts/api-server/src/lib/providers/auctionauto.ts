import type {
  FetchedListing,
  ListingReference,
  NormalizedEvent,
  NormalizedListing,
  NormalizedPhoto,
} from "@workspace/providers";
import { SOUTH_KOREA } from "../geo";
import { KrHtmlAdapter, type KrDiscoverResult } from "./kr-adapter";
import { krFetch, KrRequestError } from "./kr-http";
import { normalizeKrVin, vehicleFromParts } from "./kr-common";
import { listedAtFromCiToken, listedAtFromMongoObjectId } from "./listing-dates";
import { extractMileageFromText } from "./mileage";
import { USA } from "./us-common";

export const AUCTIONAUTO_PARSER_VERSION = "auctionauto-v3.2.0";
export const AUCTIONAUTO_WEB_BASE = "https://auctionauto.org";
const CHINA = "China";
/** Page size for catalog/auction JSON. Higher = fewer discover round-trips. */
const CATALOG_LIMIT = 100;
const HTML_PAGE_SIZE = 20;
/**
 * auctionauto.org Elasticsearch window: unfiltered (and filtered) search stops
 * returning hits after ~10_000 results. Shard by make, then model, to cover the
 * full Korea (~175k) and USA (~55k) inventories.
 */
const API_RESULT_WINDOW = 10_000;

type CatalogId = "korea" | "china" | "usa";
type CachedItem = { catalog: CatalogId; item: Record<string, unknown> };

interface CatalogState {
  id: CatalogId;
  lastPage: number;
  pageSize: number;
  make?: string;
  model?: string;
}

interface BrandTree {
  brand: string;
  models: string[];
}

/** Static brand labels → API `make` values seen in catalog JSON. */
const MAKE_ALIASES: Record<string, string[]> = {
  Chevrolet: ["GM DAEWOO (CHEVROLET)", "CHEVROLET", "GM DAEWOO"],
  "Mercedes-Benz": ["MERCEDES BENZ", "MERCEDES-BENZ"],
  "Mercedes Benz": ["MERCEDES BENZ", "MERCEDES-BENZ"],
  "Land Rover": ["LAND ROVER"],
  "Renault Samsung": ["RENAULT SAMSUNG"],
  SsangYong: ["SSANGYONG"],
  "Alfa Romeo": ["ALFA ROMEO"],
  "Aston Martin": ["ASTON MARTIN"],
};

export function auctionautoDetailUrl(pathOrId: string): string {
  if (pathOrId.startsWith("http")) return pathOrId;
  if (pathOrId.includes("/")) {
    return `${AUCTIONAUTO_WEB_BASE}${pathOrId.startsWith("/") ? "" : "/"}${pathOrId}`;
  }
  if (/^\d{6,}$/.test(pathOrId)) return `${AUCTIONAUTO_WEB_BASE}/auction/lot/${pathOrId}`;
  return `${AUCTIONAUTO_WEB_BASE}/catalog/vehicle/${pathOrId}`;
}

function rewriteAuctionautoPhotoUrl(raw: string): string | undefined {
  const src = raw.trim();
  if (!src) return undefined;
  const wrapped = src.match(/static\.auctionauto\.com\.ua\/images\/image\.autowini\.com\/(.+)$/i);
  if (wrapped) return `https://image.autowini.com/${wrapped[1]}`;
  if (src.startsWith("//")) return `https:${src}`;
  if (src.startsWith("/")) return `${AUCTIONAUTO_WEB_BASE}${src}`;
  return src;
}

function extractNuxt(html: string): any | undefined {
  const m = html.match(/<script>\s*window\.__NUXT__=([\s\S]*?)<\/script>/);
  if (!m) return undefined;
  try {
    return new Function(`return ${m[1]}`)();
  } catch {
    return undefined;
  }
}

async function aaGet(url: string, accept?: string): Promise<{ url: string; status: number; text: string }> {
  const fetched = await krFetch(url, {
    referer: `${AUCTIONAUTO_WEB_BASE}/`,
    accept: accept ?? "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
  });
  if (/Just a moment|cf-challenge|challenge-platform/i.test(fetched.text)) {
    throw new KrRequestError(403, "auctionauto.org returned a Cloudflare challenge", url);
  }
  return fetched;
}

async function aaJson(url: string): Promise<any> {
  const fetched = await aaGet(url, "application/json");
  try {
    return JSON.parse(fetched.text);
  } catch {
    throw new KrRequestError(502, `auctionauto.org returned non-JSON for ${url}`, url);
  }
}

export class AuctionautoHistoricalAdapter extends KrHtmlAdapter {
  readonly internalName = "auctionauto";
  private catalogs: CatalogState[] | null = null;
  private cache = new Map<string, CachedItem>();

  protected extractSourceId(url: string): string | undefined {
    const auctionLot = url.match(/\/auction\/lot\/(?:[^/?#]*-)?(\d{6,})/i)?.[1];
    if (auctionLot) return auctionLot;
    const slug = url.match(/\/catalog\/vehicle\/([^/?#]+)/)?.[1];
    return slug?.match(/([a-f0-9]{24})$/i)?.[1]?.toLowerCase() ?? slug;
  }

  async discoverListings(page: number): Promise<KrDiscoverResult> {
    if (!this.catalogs) this.catalogs = await this.loadCatalogs();
    const totalPages = this.catalogs.reduce((n, c) => n + c.lastPage, 0);
    const mapped = mapCatalogPage(this.catalogs, page);
    if (!mapped) {
      return { listings: [], pagination: { currentPage: page, totalPages, hasMore: false } };
    }
    const listings = await this.loadPage(
      mapped.catalog,
      mapped.localPage,
      mapped.pageSize,
      mapped.make,
      mapped.model,
    );
    return {
      listings,
      pagination: {
        currentPage: page,
        totalPages,
        // Keep walking shards even if one page is empty (transient / window edge).
        hasMore: page < totalPages,
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const sourceId = this.extractSourceId(url) ?? url;
    const cached = this.cache.get(sourceId);
    if (cached) {
      return {
        url,
        json: cached,
        html: JSON.stringify(cached.item),
        statusCode: 200,
        headers: {},
      };
    }
    if (/\/auction\//i.test(url) || /^\d{6,}$/.test(sourceId)) {
      throw new KrRequestError(404, `Auction lot ${sourceId} was not in the current search page`, url);
    }
    const detail = await aaJson(`${AUCTIONAUTO_WEB_BASE}/api/catalog/${sourceId}`);
    const item = (detail && typeof detail === "object" ? detail : {}) as Record<string, unknown>;
    const packed: CachedItem = { catalog: countryToCatalog(str(item.country) ?? str(item.originCountry)), item };
    this.cache.set(sourceId, packed);
    return { url, json: packed, html: JSON.stringify(item), statusCode: 200, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const packed = unpackFetched(fetched);
    return listingFromItem(packed.catalog, packed.item, fetched.url);
  }

  private async loadCatalogs(): Promise<CatalogState[]> {
    const brandTree = await loadBrandTree();
    const korea = await buildShardedCatalog("korea", brandTree);
    const usa = await buildShardedCatalog("usa", brandTree);

    const catalogs: CatalogState[] = [...korea];

    let chinaCount = 0;
    try {
      const chinaHtml = await aaGet(`${AUCTIONAUTO_WEB_BASE}/catalog/china/cars`);
      chinaCount = Number(extractNuxt(chinaHtml.text)?.state?.catalog?.vehicles?.count) || 0;
    } catch {
      chinaCount = 0;
    }
    if (chinaCount > 0) {
      catalogs.push({
        id: "china",
        pageSize: HTML_PAGE_SIZE,
        lastPage: cappedLastPage(chinaCount, HTML_PAGE_SIZE),
      });
    }

    catalogs.push(...usa);
    return catalogs.length > 0
      ? catalogs
      : [{ id: "korea", pageSize: CATALOG_LIMIT, lastPage: cappedLastPage(API_RESULT_WINDOW, CATALOG_LIMIT) }];
  }

  private async loadPage(
    catalog: CatalogId,
    page: number,
    pageSize: number,
    make?: string,
    model?: string,
  ): Promise<ListingReference[]> {
    const items =
      catalog === "china"
        ? await this.loadChinaPage(page)
        : catalog === "usa"
          ? asItems((await aaJson(auctionApiUrl(page, pageSize, make, model)))?.items)
          : asItems((await aaJson(catalogApiUrl("korea", page, pageSize, make, model)))?.items);
    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const sourceId = sourceIdOf(catalog, item);
      if (!sourceId || seen.has(sourceId)) continue;
      seen.add(sourceId);
      this.cache.set(sourceId, { catalog, item });
      listings.push({
        sourceId,
        url: urlOf(catalog, item, sourceId),
        metadata: { catalog, item },
      });
    }
    return listings;
  }

  private async loadChinaPage(page: number): Promise<Record<string, unknown>[]> {
    const fetched = await aaGet(`${AUCTIONAUTO_WEB_BASE}/catalog/china/cars?page=${page}`);
    const nuxt = extractNuxt(fetched.text);
    return asItems(nuxt?.state?.catalog?.vehicles?.items);
  }
}

function cappedLastPage(count: number, pageSize: number): number {
  const size = Math.max(1, pageSize);
  const raw = Math.max(1, Math.ceil(Math.max(0, count) / size) || 1);
  return Math.min(raw, Math.floor(API_RESULT_WINDOW / size) || 1);
}

async function loadBrandTree(): Promise<BrandTree[]> {
  try {
    const html = await aaGet(`${AUCTIONAUTO_WEB_BASE}/catalog/korea/cars`);
    const staticCars = extractNuxt(html.text)?.state?.filters?.staticCars;
    if (!Array.isArray(staticCars)) return [];
    return staticCars
      .filter((row: unknown) => row && typeof row === "object")
      .map((row: any) => ({
        brand: String(row.brand ?? "").trim(),
        models: asItems(row.models)
          .map((m) => str(m.model))
          .filter((m): m is string => Boolean(m)),
      }))
      .filter((b: BrandTree) => b.brand);
  } catch {
    return [];
  }
}

async function buildShardedCatalog(catalog: "korea" | "usa", brandTree: BrandTree[]): Promise<CatalogState[]> {
  const pageSize = CATALOG_LIMIT;
  const makes = await discoverMakes(catalog, brandTree);
  const segments: CatalogState[] = [];

  for (const make of makes) {
    const count = await queryCount(catalog, make);
    if (count <= 0) continue;

    if (count <= API_RESULT_WINDOW) {
      segments.push({ id: catalog, make, pageSize, lastPage: cappedLastPage(count, pageSize) });
      continue;
    }

    const models = await discoverModels(catalog, make, brandTree);
    let modelSegments = 0;
    for (const model of models) {
      const modelCount = await queryCount(catalog, make, model);
      if (modelCount <= 0) continue;
      modelSegments++;
      segments.push({
        id: catalog,
        make,
        model,
        pageSize,
        lastPage: cappedLastPage(modelCount, pageSize),
      });
    }

    // No usable model split — take the first API window for this make.
    if (modelSegments === 0) {
      segments.push({ id: catalog, make, pageSize, lastPage: cappedLastPage(API_RESULT_WINDOW, pageSize) });
    }
  }

  return segments;
}

async function discoverMakes(catalog: "korea" | "usa", brandTree: BrandTree[]): Promise<string[]> {
  const found: string[] = [];

  for (const brand of brandTree) {
    let picked: string | null = null;
    for (const alias of makeCandidates(brand.brand)) {
      if (isDuplicateMake(alias, found)) continue;
      const count = await queryCount(catalog, alias);
      if (count > 0) {
        picked = alias;
        break;
      }
    }
    if (picked) found.push(picked);
  }

  // Harvest makes present in the first API window (names often differ from staticCars).
  for (const page of [1, 50, 100, 150, 200]) {
    for (const make of await harvestField(catalog, "make", page)) {
      if (isDuplicateMake(make, found)) continue;
      const count = await queryCount(catalog, make);
      if (count > 0) found.push(make);
    }
  }

  return found.sort((a, b) => a.localeCompare(b));
}

function isDuplicateMake(make: string, existing: string[]): boolean {
  const u = make.toUpperCase();
  if (existing.some((e) => e.toUpperCase() === u)) return true;
  // Same Korea Chevy inventory under two labels.
  if (/CHEVROLET|GM DAEWOO/.test(u) && existing.some((e) => /CHEVROLET|GM DAEWOO/.test(e.toUpperCase()))) {
    return true;
  }
  return false;
}

async function discoverModels(
  catalog: "korea" | "usa",
  make: string,
  brandTree: BrandTree[],
): Promise<string[]> {
  const candidates = new Set<string>();
  const brand = brandTree.find((b) => makeCandidates(b.brand).some((a) => a.toUpperCase() === make.toUpperCase()));
  for (const model of brand?.models ?? []) candidates.add(model);

  for (const page of [1, 50, 100, 150, 200]) {
    for (const model of await harvestField(catalog, "model", page, make)) candidates.add(model);
  }

  return [...candidates].sort((a, b) => a.localeCompare(b));
}

function makeCandidates(brand: string): string[] {
  const out = new Set<string>();
  const trimmed = brand.trim();
  if (!trimmed) return [];
  out.add(trimmed);
  out.add(trimmed.toUpperCase());
  for (const alias of MAKE_ALIASES[trimmed] ?? []) out.add(alias);
  return [...out];
}

async function harvestField(
  catalog: "korea" | "usa",
  field: "make" | "model",
  page: number,
  make?: string,
): Promise<string[]> {
  try {
    const json =
      catalog === "usa"
        ? await aaJson(auctionApiUrl(page, CATALOG_LIMIT, make))
        : await aaJson(catalogApiUrl("korea", page, CATALOG_LIMIT, make));
    const values = new Set<string>();
    for (const item of asItems(json?.items)) {
      const v = str(item[field]);
      if (v) values.add(v);
    }
    return [...values];
  } catch {
    return [];
  }
}

async function queryCount(catalog: "korea" | "usa", make?: string, model?: string): Promise<number> {
  try {
    const json =
      catalog === "usa"
        ? await aaJson(auctionApiUrl(1, 1, make, model))
        : await aaJson(catalogApiUrl("korea", 1, 1, make, model));
    return Number(json?.count) || 0;
  } catch {
    return 0;
  }
}

function catalogApiUrl(
  country: "korea",
  page: number,
  limit: number,
  make?: string,
  model?: string,
): string {
  const q = new URLSearchParams({
    country,
    type: "cars",
    page: String(page),
    limit: String(limit),
  });
  if (make) q.set("make", make);
  if (model) q.set("model", model);
  return `${AUCTIONAUTO_WEB_BASE}/api/catalog?${q.toString()}`;
}

function auctionApiUrl(page: number, limit: number, make?: string, model?: string): string {
  const q = new URLSearchParams({
    type: "cars",
    page: String(page),
    limit: String(limit),
  });
  if (make) q.set("make", make);
  if (model) q.set("model", model);
  return `${AUCTIONAUTO_WEB_BASE}/api/auction?${q.toString()}`;
}

function mapCatalogPage(
  catalogs: CatalogState[],
  page: number,
): { catalog: CatalogId; localPage: number; pageSize: number; make?: string; model?: string } | null {
  let remaining = page;
  for (const cat of catalogs) {
    if (remaining <= cat.lastPage) {
      return {
        catalog: cat.id,
        localPage: remaining,
        pageSize: cat.pageSize,
        make: cat.make,
        model: cat.model,
      };
    }
    remaining -= cat.lastPage;
  }
  return null;
}

function asItems(raw: unknown): Record<string, unknown>[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((row) => row && typeof row === "object") as Record<string, unknown>[];
}

function sourceIdOf(catalog: CatalogId, item: Record<string, unknown>): string | undefined {
  if (catalog === "usa") {
    const lot = str(item.lotId);
    if (lot) return lot;
  }
  const id = str(item._id);
  return id?.match(/^[a-f0-9]{24}$/i)?.[0]?.toLowerCase() ?? id;
}

function urlOf(catalog: CatalogId, item: Record<string, unknown>, sourceId: string): string {
  if (catalog === "usa") {
    const slug = slugify([str(item.year), str(item.make), str(item.model), sourceId].filter(Boolean).join("-"));
    return `${AUCTIONAUTO_WEB_BASE}/auction/lot/${slug || sourceId}`;
  }
  const titleSlug = slugify(str(item.title) || [str(item.year), str(item.make), str(item.model)].filter(Boolean).join("-"));
  return `${AUCTIONAUTO_WEB_BASE}/catalog/vehicle/${titleSlug ? `${titleSlug}-${sourceId}` : sourceId}`;
}

function unpackFetched(fetched: FetchedListing): CachedItem {
  const fromJson = fetched.json as CachedItem | undefined;
  if (fromJson?.item) return fromJson;
  const fromMeta = fetched.metadata as CachedItem | undefined;
  if (fromMeta?.item) return fromMeta;
  try {
    const parsed = JSON.parse(fetched.html ?? "{}");
    if (parsed?.item) return parsed as CachedItem;
    if (parsed && typeof parsed === "object") {
      return { catalog: countryToCatalog(str(parsed.country)), item: parsed };
    }
  } catch {
    /* ignore */
  }
  return { catalog: "korea", item: {} };
}

function listingFromItem(catalog: CatalogId, item: Record<string, unknown>, pageUrl: string): NormalizedListing {
  const sourceId = sourceIdOf(catalog, item) || "unknown";
  const vin = normalizeKrVin(str(item.vin));
  const title = cleanTitle(str(item.title) || [item.year, item.make, item.model].filter(Boolean).join(" "), vin);
  const country = countryOf(catalog, item);
  const sold = catalog === "usa" ? Boolean(item.soldOut || item.auctionIsFinished) : Boolean(item.soldOut);
  const saleDate = catalog === "usa" ? parseSaleDate(str(item.saleDate), str(item.saleTime)) : undefined;
  const price = priceOf(catalog, item, sold);
  const mileage = mileageOf(item, title);
  const photos = photosOf(item);
  const events = buildEvents({ sold, saleDate, price, sourceId, catalog, auction: str(item.auction) });
  const sourceListedAt =
    saleDate ??
    listedAtFromMongoObjectId(sourceId) ??
    listedAtFromMongoObjectId(item._id) ??
    listedAtFromCiToken(JSON.stringify(item.images ?? []));

  return {
    sourceId,
    sourceUrl: urlOf(catalog, item, sourceId) || pageUrl,
    title,
    priceAmount: price,
    priceCurrency: "USD",
    mileage,
    mileageUnit: catalog === "usa" ? "mi" : "km",
    location: [str(item.city), country].filter(Boolean).join(", ") || country,
    country,
    isActive: !sold,
    listingStatus: sold ? "sold" : "active",
    soldAt: sold ? saleDate : undefined,
    sourceListedAt,
    sourceModifiedAt: sourceListedAt,
    events,
    vehicle: vehicleFromParts({
      vin,
      make: str(item.make),
      model: str(item.model),
      year: num(item.year),
      fuelType: str(item.fuel),
      transmission: str(item.transmission),
      bodyType: str(item.bodyStyle),
      driveType: str(item.drive),
      engineDisplacement: item.engineCapacity != null ? String(item.engineCapacity) : str(item.engineType),
      color: firstColor(item.availableColors),
      country,
    }),
    photos,
  };
}

function priceOf(catalog: CatalogId, item: Record<string, unknown>, sold: boolean): number | undefined {
  if (item.priceOnRequest) return undefined;
  if (catalog === "usa") {
    const bid = num(item.currentBid);
    const buyNow = num(item.buyNowPrice);
    if (sold) return bid ?? buyNow;
    return bid ?? buyNow;
  }
  return num(item.price);
}

function mileageOf(item: Record<string, unknown>, title?: string): number | undefined {
  // Korea catalog often publishes sentinel 0/1 instead of real KM.
  const raw = num(item.odometer) ?? num(item.mileage) ?? num(item.odometerValue);
  if (raw != null && raw > 1) return raw;
  return mileageFromTitle(title ?? str(item.title));
}

/** Titles sometimes embed KM when the API odometer is blank/sentinel, e.g. `…60000KM`. */
function mileageFromTitle(title?: string): number | undefined {
  return extractMileageFromText(title);
}

function photosOf(item: Record<string, unknown>): NormalizedPhoto[] {
  const urls: string[] = [];
  const raw = item.images;
  const list = Array.isArray(raw) ? raw : [];
  for (const img of list) {
    const value = typeof img === "string" ? img : str((img as { url?: unknown })?.url) || str((img as { thumb?: unknown })?.thumb);
    const url = rewriteAuctionautoPhotoUrl(value ?? "");
    if (!url || /logo|icon|favicon|placeholder/i.test(url) || urls.includes(url)) continue;
    urls.push(url);
    if (urls.length >= 40) break;
  }
  return urls.map((sourceUrl, i) => ({ sourceUrl, isPrimary: i === 0, sortOrder: i }));
}

function buildEvents(input: {
  sold: boolean;
  saleDate?: Date;
  price?: number;
  sourceId: string;
  catalog: CatalogId;
  auction?: string;
}): NormalizedEvent[] {
  if (!input.sold || !input.saleDate) return [];
  return [
    {
      eventType: "sale",
      description: input.price ? `Sold for ${input.price.toLocaleString("en-US")} USD` : "Sold",
      occurredAt: input.saleDate,
      metadata: {
        source: "auctionauto",
        field: "sale",
        soldDate: input.saleDate.toISOString().slice(0, 10),
        priceAmount: input.price,
        priceCurrency: "USD",
        sourceListingId: input.sourceId,
        provider: "auctionauto",
        auctionHouse: input.auction,
        catalog: input.catalog,
      },
    },
  ];
}

function parseSaleDate(date?: string, time?: string): Date | undefined {
  if (!date) return undefined;
  const dmy = date.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dmy) {
    const iso = `${dmy[3]}-${dmy[2]!.padStart(2, "0")}-${dmy[1]!.padStart(2, "0")}`;
    const clock = (time && /^\d{1,2}:\d{2}/.test(time) ? time : "12:00").slice(0, 5);
    const parsed = Date.parse(`${iso}T${clock}:00Z`);
    return Number.isFinite(parsed) ? new Date(parsed) : undefined;
  }
  const parsed = Date.parse(date);
  return Number.isFinite(parsed) ? new Date(parsed) : undefined;
}

function countryOf(catalog: CatalogId, item: Record<string, unknown>): string {
  const raw = `${str(item.country) ?? ""} ${str(item.originCountry) ?? ""}`.toLowerCase();
  if (catalog === "usa" || /usa|united states|copart|iaa/.test(raw)) return USA;
  if (catalog === "china" || /china/.test(raw)) return CHINA;
  return SOUTH_KOREA;
}

function countryToCatalog(raw?: string): CatalogId {
  const t = (raw ?? "").toLowerCase();
  if (/china/.test(t)) return "china";
  if (/usa|united states/.test(t)) return "usa";
  return "korea";
}

function cleanTitle(raw: string, vin?: string): string {
  let title = raw.replace(/\s+/g, " ").trim();
  if (vin) title = title.replace(new RegExp(vin, "ig"), "");
  return title.replace(/\s{2,}/g, " ").trim();
}

function firstColor(raw: unknown): string | undefined {
  if (Array.isArray(raw) && raw[0]) return String(raw[0]);
  return undefined;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function str(value: unknown): string | undefined {
  if (value == null) return undefined;
  const t = String(value).trim();
  return t || undefined;
}

function num(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : Number(String(value ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
