import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedEvent,
  NormalizedListing,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import { parseTitleState, textIndicatesSalvage } from "../salvage-title";
import { findVinInListing, normalizeKrVin, parseYear, vehicleFromParts, vinCheckDigitOk } from "./kr-common";
import { asArray, asPhotos, asRecord, num, str } from "./web-html";
import { USA, normalizeVin, usMiListing } from "./us-common";

export const BIDEXPORT_PARSER_VERSION = "bidexport-v1.1.0";
const BASE = "https://bidexport.com";
const PAGE_SIZE = 40;
/** Default vehicle categories — cars + trucks (and close truck-adjacent salvage types). */
const DEFAULT_SALVAGE_TYPES = ["AUTOMOBILE", "TRUCK"] as const;

const JSON_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Origin: BASE,
  Referer: `${BASE}/online-auto-auction-search/filter`,
  "X-Requested-With": "XMLHttpRequest",
};

export function bidexportDetailUrl(stockOrUrl: string, slugParts?: {
  year?: string | number;
  make?: string;
  model?: string;
  vin?: string;
}): string {
  const raw = stockOrUrl.trim();
  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `${BASE}${raw}`;
  const stock = raw.replace(/^vehicle\//i, "").split("/")[0]!;
  if (slugParts?.year && slugParts.make && slugParts.model && slugParts.vin) {
    const slug = [slugParts.year, slugParts.make, slugParts.model, slugParts.vin]
      .map((p) =>
        String(p)
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-|-$/g, ""),
      )
      .filter(Boolean)
      .join("-");
    return `${BASE}/vehicle/${stock}/${slug}`;
  }
  return `${BASE}/vehicle/${stock}`;
}

function stockFromUrl(url: string): string {
  const m = url.match(/\/vehicle\/([^/?#]+)/i);
  if (m?.[1]) return m[1];
  const parts = url.split("/").filter(Boolean);
  return parts[parts.length - 1] || url;
}

function vinFromUrl(url: string): string | undefined {
  const m = url.match(/\/vehicle\/[^/]+\/([^/?#]+)/i);
  if (!m?.[1]) return undefined;
  const tail = m[1].split("-").pop();
  const vin = normalizeVin(tail);
  return vin && vin.length === 17 ? vin : undefined;
}

async function postJson(url: string, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify(body),
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`BidExport ${res.status} at ${url}`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`BidExport non-JSON at ${url}`);
  }
}

/** Unwrap `{data:{count,data}}` / `{count,data:[]}` / array shapes used across list + detail. */
function unwrapPayload(raw: unknown): { count?: number; items: Record<string, unknown>[] } {
  const root = asRecord(raw) ?? {};
  let cursor: unknown = root;
  // Detail often nests as data.data; list is {count,data:[]}
  for (let i = 0; i < 3; i++) {
    const rec = asRecord(cursor);
    if (!rec) break;
    if (Array.isArray(rec.data)) {
      return { count: num(rec.count), items: rec.data.map((x) => asRecord(x) ?? {}).filter(Boolean) as Record<string, unknown>[] };
    }
    if (asRecord(rec.data)) {
      cursor = rec.data;
      continue;
    }
    break;
  }
  const rec = asRecord(cursor) ?? root;
  if (Array.isArray(cursor)) {
    return { items: cursor.map((x) => asRecord(x) ?? {}).filter(Boolean) as Record<string, unknown>[] };
  }
  // Single detail object (has vin/make)
  if (rec.vin || rec.Vin || rec.stockNumber || rec.StockNumber || rec.make || rec.Make) {
    return { count: num(rec.count) ?? 1, items: [rec] };
  }
  if (Array.isArray(rec.data)) {
    return { count: num(rec.count), items: rec.data.map((x) => asRecord(x) ?? {}).filter(Boolean) as Record<string, unknown>[] };
  }
  return { count: num(rec.count), items: [] };
}

function mapValues(obj: unknown): unknown[] {
  if (!obj) return [];
  if (Array.isArray(obj)) return obj;
  const rec = asRecord(obj);
  if (!rec) return [];
  return Object.keys(rec)
    .sort((a, b) => Number(a) - Number(b) || a.localeCompare(b))
    .map((k) => rec[k]);
}

function photoUrls(item: Record<string, unknown>): string[] {
  // Prefer full ImageURL; never short-circuit on an empty `images: []` (?? only skips nullish).
  const buckets = [item.ImageURL, item.images, item.ImageURLThumbNail];
  const fromImages: string[] = [];
  for (const bucket of buckets) {
    for (const v of mapValues(bucket)) {
      const u = str(v);
      if (u && /^https?:\/\//i.test(u)) fromImages.push(u);
    }
  }
  return [...new Set(fromImages)].filter((u) => !/blank-placeholder|placeholder-image/i.test(u));
}

function additionalMap(item: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of mapValues(item.AdditionalVehicleInformation ?? item.additionalVehicleInformation)) {
    const rec = asRecord(row);
    const name = str(rec?.Name) ?? str(rec?.name);
    const value = str(rec?.Value) ?? str(rec?.value);
    if (name && value) out[name] = value;
  }
  return out;
}

function field(item: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const v = item[key];
    if (typeof v === "string" || typeof v === "number") {
      const s = str(v);
      if (s) return s;
    }
  }
  return undefined;
}

function vinBlock(item: Record<string, unknown>): Record<string, unknown> {
  return asRecord(item.Vin) ?? asRecord(item.vin) ?? {};
}

function extractVin(item: Record<string, unknown>, fallback?: string): string | undefined {
  const block = vinBlock(item);
  const raw =
    str(block.ID) ??
    str(block.id) ??
    (typeof item.vin === "string" ? item.vin : undefined) ??
    field(item, "vin") ??
    fallback;
  const vin = normalizeVin(raw);
  if (!vin) return undefined;
  if (vin.length === 17 && !vinCheckDigitOk(vin)) {
    // Still keep labeled auction VINs when check digit fails (some salvage VIN fields are odd).
    return vin;
  }
  return vin;
}

function mileageOf(item: Record<string, unknown>): number | undefined {
  return (
    num(item.mileage) ??
    num(item.odometer) ??
    num(item.Odometer) ??
    num(String(item.Odometer ?? "").replace(/[^\d.]/g, ""))
  );
}

function priceOf(item: Record<string, unknown>): number | undefined {
  const stockPriceList = asRecord(item.stockPriceListInfo);
  return (
    num(item.currentBid) ??
    num(item.CurrentBid) ??
    num(stockPriceList?.Price) ??
    num(item.stockPrice) ??
    num(item.Start) ??
    num(item.start)
  );
}

function locationOf(item: Record<string, unknown>): string {
  const addr = asRecord(item.AddressofStock) ?? asRecord(item.addressofStock) ?? {};
  const city = str(addr.City) ?? str(addr.city);
  const state = str(addr.State) ?? str(addr.state);
  const branch = field(item, "BranchName", "branchName");
  const country =
    str(addr.Country) ?? str(addr.country) ?? field(item, "locationCountry") ?? "USA";
  const bits = [branch, city, state, /usa|united states/i.test(country) ? USA : country].filter(Boolean);
  return [...new Set(bits)].join(", ") || USA;
}

function driveOf(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (/^all|awd|4x4|4wd/i.test(raw)) return "AWD";
  if (/front|fwd/i.test(raw)) return "FWD";
  if (/rear|rwd/i.test(raw)) return "RWD";
  return raw;
}

function buildEvents(item: Record<string, unknown>, extras: Record<string, string>): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const when = new Date();
  const pushExtra = (field: string, label: string, value?: string | null) => {
    const text = value?.replace(/\s+/g, " ").trim();
    if (!text || /^unknown$/i.test(text) || text === "-" || text === "N/A") return;
    events.push({
      eventType: "other",
      description: `${label}: ${text}`,
      occurredAt: when,
      metadata: { source: "bidexport", field, value: text },
    });
  };

  const primary = field(item, "PrimaryDamage", "primaryDamage") ?? extras["Primary Damage"];
  const secondary = field(item, "SecondaryDamage", "secondaryDamage");
  const loss = field(item, "LossType", "lossType");
  // Lot specs belong in Extra — not the VIN timeline.
  pushExtra("condition", "Primary damage", primary);
  pushExtra("secondary_damage", "Secondary damage", secondary);
  pushExtra("loss_type", "Loss type", loss);

  const saleDoc =
    field(item, "SaleDocument", "saleDocument") ??
    field(item, "SaleDocumentBrand", "saleDocumentBrand") ??
    field(item, "CertState", "certState");
  if (saleDoc) {
    const state = parseTitleState(saleDoc);
    events.push({
      eventType: "title_status",
      description: saleDoc,
      occurredAt: when,
      metadata: {
        source: "bidexport",
        kind: "saleDocument",
        salvage: textIndicatesSalvage(saleDoc) || undefined,
        state,
      },
    });
  }
  const airbag = extras["Driver Airbag"] ?? extras["Airbag"];
  pushExtra("airbags", "Airbags", airbag);
  const keys = extras["Keys"] ?? extras["Key"] ?? field(item, "HasKeys", "hasKeys");
  if (keys) {
    const yes = /^(y|yes|true|1)$/i.test(keys) ? "Yes" : /^(n|no|false|0)$/i.test(keys) ? "No" : keys;
    pushExtra("keys", "Keys", yes);
  }
  return events;
}

function parseLot(item: Record<string, unknown>, pageUrl: string): NormalizedListing {
  const extras = additionalMap(item);
  const vinInfo = vinBlock(item);
  const stock =
    field(item, "StockNumber", "stockNumber") ??
    stockFromUrl(pageUrl);
  const make = field(item, "Make", "make") ?? str(vinInfo.Make) ?? str(vinInfo.make);
  const model = field(item, "Model", "model") ?? str(vinInfo.Model) ?? str(vinInfo.model);
  const year =
    parseYear(field(item, "Year", "year")) ??
    parseYear(str(vinInfo.Year) ?? str(vinInfo.year));
  const vin = extractVin(item, vinFromUrl(pageUrl));
  const title =
    [year, make, model, field(item, "trim", "series") ?? str(vinInfo.Series)]
      .filter(Boolean)
      .join(" ") || `BidExport ${stock}`;
  const sourceUrl = bidexportDetailUrl(stock, {
    year,
    make,
    model,
    vin,
  });
  const bodyType =
    field(item, "bodyStyle", "BodyStyle") ??
    extras["Body Style"] ??
    str(vinInfo.Body) ??
    str(vinInfo.body) ??
    field(item, "SalvageType", "salvageType");
  const color = extras.Color ?? extras.color ?? field(item, "color");
  const fuel =
    field(item, "fuelType", "FuelType") ?? str(vinInfo.FuelType) ?? str(vinInfo.fuelType);
  const transmission =
    field(item, "transmission", "vehicleTransmission", "Transmission") ??
    str(vinInfo.Transmission) ??
    str(vinInfo.transmission);
  const drive = driveOf(
    field(item, "driveLineType", "DriveLineType") ?? str(vinInfo.DriveLineType) ?? str(vinInfo.driveLineType),
  );
  const engine =
    field(item, "engine") ?? extras["Engine Size"] ?? str(vinInfo.Engine) ?? str(vinInfo.engine);
  const statusId = num(item.StatusId) ?? num(item.statusId);
  // StatusId 4 appears on active list lots; treat missing as active.
  const sold = statusId === 0 || /sold|ended|inactive/i.test(field(item, "VehicleStatus", "vehicleStatus") ?? "");

  const events = buildEvents(item, extras);
  const photos = asPhotos(photoUrls(item));

  return usMiListing({
    sourceId: stock,
    sourceUrl,
    title,
    price: priceOf(item),
    mileage: mileageOf(item),
    location: locationOf(item),
    country: USA,
    sold,
    vehicle: vehicleFromParts({
      vin,
      make,
      model,
      year,
      trim: field(item, "trim", "series") ?? str(vinInfo.Series) ?? str(vinInfo.series),
      bodyType,
      color,
      fuelType: fuel,
      transmission,
      driveType: drive,
      engineDisplacement: engine,
      country: USA,
    }),
    photos,
    events: events.length ? events : undefined,
  });
}

function salvageTypesFromFilters(filters: Record<string, unknown>): string[] {
  const raw = filters.salvageTypes ?? filters.salvageType ?? filters.types;
  if (typeof raw === "string" && raw.trim()) {
    return raw
      .split(/[,|]/)
      .map((s) => s.trim().toUpperCase().replace(/-/g, " "))
      .filter(Boolean);
  }
  if (Array.isArray(raw)) {
    return raw
      .map((s) => String(s).trim().toUpperCase().replace(/-/g, " "))
      .filter(Boolean);
  }
  return [...DEFAULT_SALVAGE_TYPES];
}

export class BidexportHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "bidexport";
  private readonly salvageTypes: string[];

  constructor(private _baseUrl?: string, private filters: Record<string, unknown> = {}) {
    this.salvageTypes = salvageTypesFromFilters(filters);
  }

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const p = Math.max(1, page);
    const typeCount = Math.max(1, this.salvageTypes.length);
    const typeIndex = (p - 1) % typeCount;
    const pageInType = Math.floor((p - 1) / typeCount) + 1;
    const salvageType = this.salvageTypes[typeIndex]!;
    const skip = (pageInType - 1) * PAGE_SIZE;
    const sort = encodeURIComponent(JSON.stringify({ Year: -1 }));
    const url = `${BASE}/filter?limit=${PAGE_SIZE}&skip=${skip}&sort=${sort}`;
    const raw = await postJson(url, {
      SalvageType: salvageType,
      Images: true,
    });
    const { count, items } = unwrapPayload(raw);

    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const stock = field(item, "StockNumber", "stockNumber");
      if (!stock || seen.has(stock)) continue;
      seen.add(stock);
      const vin = extractVin(item);
      const make = field(item, "Make", "make");
      const model = field(item, "Model", "model");
      const year = parseYear(field(item, "Year", "year"));
      listings.push({
        sourceId: stock,
        url: bidexportDetailUrl(stock, { year, make, model, vin }),
        metadata: {
          vin,
          mileage: mileageOf(item),
          price: priceOf(item),
          salvageType: field(item, "SalvageType", "salvageType") ?? salvageType,
          make,
          model,
          year,
        },
      });
    }

    const totalPagesInType = count != null ? Math.ceil(count / PAGE_SIZE) : undefined;
    const hasMoreInType = totalPagesInType != null ? pageInType < totalPagesInType : listings.length >= PAGE_SIZE;

    return {
      listings,
      pagination: {
        currentPage: p,
        hasMore: hasMoreInType || typeIndex < typeCount - 1,
        totalPages: totalPagesInType != null ? totalPagesInType * typeCount : undefined,
        resultTotal: count,
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const stock = stockFromUrl(url);
    const vinHint = vinFromUrl(url);
    const raw = await postJson(`${BASE}/filter`, {
      StockNumber: stock,
      userId: "",
      emptyHandler: { vin: (vinHint || "").toLowerCase() },
    });
    return {
      url: url.startsWith("http") ? url : bidexportDetailUrl(stock),
      html: JSON.stringify(raw),
      statusCode: 200,
      headers: { "content-type": "application/json" },
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const rawText = fetched.html ?? "";
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      parsed = undefined;
    }

    if (parsed) {
      const { items } = unwrapPayload(parsed);
      const stock = stockFromUrl(fetched.url);
      const item =
        items.find((row) => field(row, "StockNumber", "stockNumber") === stock) ??
        items[0];
      if (item) return parseLot(item, fetched.url);
    }

    // Fallback: treat stored discover metadata-less HTML/JSON snippet
    const stock = stockFromUrl(fetched.url);
    const vin = findVinInListing(rawText) ?? vinFromUrl(fetched.url);
    return usMiListing({
      sourceId: stock,
      sourceUrl: fetched.url,
      vehicle: vehicleFromParts({ vin, country: USA }),
      photos: [],
      location: USA,
      country: USA,
    });
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin;
  }

  extractPhotos(listing: NormalizedListing): NormalizedPhoto[] {
    return listing.photos ?? [];
  }
}
