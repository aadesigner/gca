import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedEvent,
  NormalizedListing,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import { SLOVAKIA, canonicalCountry } from "../geo";
import { findVinInListing, normalizeKrVin, parseYear, vehicleFromParts, vinCheckDigitOk } from "./kr-common";
import { moneyListing } from "./us-common";
import {
  asArray,
  asPhotos,
  asRecord,
  fetchHtml,
  num,
  str,
} from "./web-html";

export const AAAAUTO_PARSER_VERSION = "aaaauto-v1.0.1";
const BASE = "https://www.aaaauto.sk";
const LIST_PATH = "/ojazdene-vozidla";

const SK_HEADERS = {
  "Accept-Language": "sk-SK,sk;q=0.9,cs;q=0.5,en;q=0.4",
};

export function aaaautoDetailUrl(idOrPath: string, makeSlug?: string, modelSlug?: string): string {
  const raw = idOrPath.trim();
  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `${BASE}${raw}`;
  if (makeSlug && modelSlug) return `${BASE}/detail/${makeSlug}/${modelSlug}/${raw}`;
  return `${BASE}/detail/auto/auto/${raw}`;
}

function extractNgState(html: string): Record<string, unknown> | undefined {
  const match = html.match(/<script id="ng-state" type="application\/json">([\s\S]*?)<\/script>/i);
  if (!match?.[1]) return undefined;
  try {
    const parsed = JSON.parse(match[1]);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function assertNotBotWall(html: string, url: string): void {
  if (/Making sure you're not a bot|Protected by BotStopper|anubis/i.test(html)) {
    throw new Error(`AAA Auto bot challenge at ${url} — retry later or use a residential IP`);
  }
}

function titleOf(value: unknown): string | undefined {
  const rec = asRecord(value);
  return str(rec?.title) ?? str(rec?.name) ?? str(value);
}

function slugOf(value: unknown): string | undefined {
  return str(asRecord(value)?.slug);
}

function carPhotos(car: Record<string, unknown>): string[] {
  const photos = asRecord(car.photos);
  const urls = [
    ...asArray(photos?.default),
    ...asArray(photos?.cool),
    ...asArray(photos?.list),
    ...asArray(photos?.thumbs),
  ]
    .map((p) => {
      if (typeof p === "string") return p;
      const rec = asRecord(p);
      return str(rec?.cdnUrl) ?? str(rec?.url) ?? str(rec?.src);
    })
    .filter((u): u is string => !!u && /^https?:\/\//i.test(u));
  return [...new Set(urls)];
}

function parseIsoDate(raw: unknown): Date | undefined {
  const text = str(raw);
  if (!text) return undefined;
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return Number.isFinite(d.getTime()) ? d : undefined;
}

function mapHistoryLabel(label: string): NormalizedEvent {
  const lower = label.toLowerCase();
  let eventType: NormalizedEvent["eventType"] = "other";
  if (/servis|service|knižk|kniha/i.test(lower)) eventType = "inspection";
  else if (/nov|new|kúpen|koupen|first.?owner|prvý majiteľ/i.test(lower)) eventType = "delivery";
  else if (/havár|accident|poško|damage|crash/i.test(lower)) eventType = "accident";
  else if (/majiteľ|owner|vlastník/i.test(lower)) eventType = "owner_change";
  else if (/predaj|sold|sale/i.test(lower)) eventType = "sale";
  return {
    eventType,
    description: label,
    occurredAt: new Date(),
    metadata: { source: "aaaauto", label },
  };
}

function buildEvents(car: Record<string, unknown>): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  for (const item of asArray(car.history)) {
    const label = str(item);
    if (label) events.push(mapHistoryLabel(label));
  }

  const stk = parseIsoDate(car.technicalControl);
  if (stk) {
    events.push({
      eventType: "inspection",
      description: `STK / technical control valid until ${stk.toISOString().slice(0, 10)}`,
      occurredAt: stk,
      metadata: { source: "aaaauto", kind: "technicalControl" },
    });
  }

  const model = asRecord(car.model);
  const serviceAt = parseIsoDate(model?.lastServiceBookDate);
  if (serviceAt) {
    events.push({
      eventType: "inspection",
      description: "Last service book entry",
      occurredAt: serviceAt,
      metadata: {
        source: "aaaauto",
        kind: "lastServiceBook",
        km: num(model?.lastServiceBookKm),
      },
    });
  }

  const warrantyAt = parseIsoDate(car.factoryWarrantyDate);
  if (warrantyAt) {
    events.push({
      eventType: "other",
      description: "Factory warranty until",
      occurredAt: warrantyAt,
      metadata: {
        source: "aaaauto",
        kind: "factoryWarranty",
        km: num(car.factoryWarrantyKm),
      },
    });
  }

  return events;
}

function normalizeFuel(raw?: string): string | undefined {
  if (!raw) return undefined;
  const t = raw.toLowerCase();
  if (/diesel|nafta/i.test(t)) return "Diesel";
  if (/benzín|benzin|petrol|gasoline|gasolina/i.test(t)) return "Gasoline";
  if (/hybrid/i.test(t)) return "Hybrid";
  if (/elektro|electric|ev\b/i.test(t)) return "Electric";
  if (/lpg|cng|plyn/i.test(t)) return "LPG";
  return raw;
}

function normalizeTransmission(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (/auto/i.test(raw)) return "Automatic";
  if (/manu/i.test(raw)) return "Manual";
  return raw;
}

function normalizeDrive(engine: Record<string, unknown> | undefined): string | undefined {
  if (!engine) return undefined;
  if (engine.is4x4 === true || /4wd|awd|4x4/i.test(str(engine.drive) ?? "")) return "AWD";
  const drive = str(engine.drive);
  if (/fwd|predn/i.test(drive ?? "")) return "FWD";
  if (/rwd|zadn/i.test(drive ?? "")) return "RWD";
  return drive;
}

/**
 * Vehicle country = prior registration / region when AAA exposes it
 * (`countryRegion`, e.g. DE/IT/CH), else dealer `originCountry`, else Slovakia.
 * Marketplace is always European (SK stock).
 */
function listingCountry(car: Record<string, unknown>): string {
  const region = canonicalCountry(str(car.countryRegion) ?? "");
  if (region && !/^(unknown|n\/?a|null)$/i.test(region)) return region;
  const origin = canonicalCountry(str(car.originCountry) ?? "");
  return origin || SLOVAKIA;
}

function parseCar(car: Record<string, unknown>, pageUrl: string): NormalizedListing {
  const makeSlug = slugOf(car.make) ?? "auto";
  const modelSlug = slugOf(car.model) ?? "auto";
  const id = str(car.id) ?? pageUrl.match(/\/(\d+)(?:\?|$)/)?.[1] ?? "unknown";
  const sourceUrl = aaaautoDetailUrl(id, makeSlug, modelSlug);

  const rawVin =
    str(asRecord(car.body)?.vin) ??
    str(car.vin) ??
    findVinInListing(str(car.aiWebCommentGeneral) ?? "", str(car.webHeadline) ?? "", JSON.stringify(car).slice(0, 50_000));
  const vinNorm = rawVin ? normalizeKrVin(rawVin) : undefined;
  const vin = vinNorm && vinCheckDigitOk(vinNorm) ? vinNorm : vinNorm;

  const engine = asRecord(car.engine);
  const body = asRecord(car.body);
  const price = asRecord(car.price);
  const mileage = num(car.mileage);
  const year = parseYear(car.productionYear) ?? parseYear(asRecord(car.model)?.year);
  const make = titleOf(car.make);
  const model = titleOf(car.model);
  const trim = str(asRecord(car.model)?.lineTitle) ?? str(asRecord(car.model)?.generation);
  const title =
    str(car.displayTitle) ??
    str(car.webHeadline) ??
    [make, model, trim, year].filter(Boolean).join(" ");

  const photoUrls = carPhotos(car);
  const photos = vin ? asPhotos(photoUrls) : [];
  const country = listingCountry(car);
  const market = canonicalCountry(str(car.originCountry) ?? "") || SLOVAKIA;
  const branch = titleOf(asRecord(car.adminToolbox)?.branch) ?? str(asRecord(car.branch)?.title);
  const location = [branch, country !== market ? `${country} → ${market}` : undefined, market]
    .filter(Boolean)
    .join(", ");

  const events = buildEvents(car);
  const engineCc = num(engine?.engineSize);
  const isSold = car.isSold === true;

  return moneyListing({
    sourceId: id,
    sourceUrl,
    title,
    price: num(price?.cash) ?? num(price?.leasing) ?? num(price?.oldCash),
    currency: "EUR",
    mileage,
    mileageUnit: str(car.mileageUnit) === "mi" ? "mi" : "km",
    location,
    country,
    sold: isSold,
    events: events.length ? events : undefined,
    vehicle: vehicleFromParts({
      vin,
      make,
      model,
      year,
      trim,
      fuelType: normalizeFuel(titleOf(car.fuel) ?? slugOf(car.fuel)),
      transmission: normalizeTransmission(titleOf(car.gearbox) ?? slugOf(car.gearbox)),
      bodyType: titleOf(body) ?? str(body?.id) ?? slugOf(body),
      color: titleOf(body?.externalColor) ?? str(asRecord(body?.externalColor)?.id),
      driveType: normalizeDrive(engine),
      engineDisplacement: engineCc ? `${engineCc}` : undefined,
      country,
    }),
    photos,
  });
}

export class AaaautoHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "aaaauto";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const url = `${BASE}${LIST_PATH}?page=${Math.max(1, page)}`;
    const fetched = await fetchHtml(url, SK_HEADERS);
    assertNotBotWall(fetched.text, url);
    const state = extractNgState(fetched.text);
    const carList = asRecord(state?.["car-list"]);
    const message = asRecord(carList?.message);
    const paginationRec = asRecord(message?.pagination);
    const items = asArray(message?.items);

    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const car = asRecord(item);
      if (!car) continue;
      const id = str(car.id);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const makeSlug = slugOf(car.make) ?? "auto";
      const modelSlug = slugOf(car.model) ?? "auto";
      const vin = str(asRecord(car.body)?.vin);
      listings.push({
        sourceId: id,
        url: aaaautoDetailUrl(id, makeSlug, modelSlug),
        metadata: {
          vin,
          mileage: num(car.mileage),
          makeSlug,
          modelSlug,
          aaaid: num(car.aaaid) ?? str(car.aaaid),
        },
      });
    }

    // Fallback: scrape detail hrefs if transfer state missing.
    if (!listings.length) {
      for (const match of fetched.text.matchAll(/\/detail\/([a-z0-9-]+)\/([a-z0-9-]+)\/(\d+)/gi)) {
        const id = match[3]!;
        if (seen.has(id)) continue;
        seen.add(id);
        listings.push({
          sourceId: id,
          url: aaaautoDetailUrl(id, match[1], match[2]),
          metadata: { makeSlug: match[1], modelSlug: match[2] },
        });
      }
    }

    const totalPages = num(paginationRec?.totalPages);
    const hasMore =
      paginationRec?.hasMore === true ||
      (totalPages != null ? page < totalPages : listings.length >= 20);

    return {
      listings,
      pagination: {
        currentPage: num(paginationRec?.page) ?? page,
        hasMore,
        totalPages: totalPages ?? undefined,
        resultTotal: num(paginationRec?.totalItems) ?? undefined,
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url, SK_HEADERS);
    assertNotBotWall(fetched.text, url);
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const state = extractNgState(html);
    const id =
      fetched.url.match(/\/detail\/[^/]+\/[^/]+\/(\d+)/i)?.[1] ??
      fetched.url.match(/\/(\d+)(?:\?|$)/)?.[1];
    const detailKey =
      (id && Object.keys(state ?? {}).find((k) => k.startsWith(`detail-${id}`))) ||
      Object.keys(state ?? {}).find((k) => k.startsWith("detail-"));
    const detail = detailKey ? asRecord(state?.[detailKey]) : undefined;
    const car = asRecord(detail?.car);
    if (car) return parseCar(car, fetched.url);

    // Last-resort HTML scrape if Angular state missing.
    const vin = findVinInListing(html);
    const sourceId = id ?? "unknown";
    const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const mileage = num(html.match(/([\d\s]{2,})\s*km/i)?.[1]?.replace(/\s/g, ""));
    const photoUrls = [...html.matchAll(/https:\/\/aaaautoeuimg\.vshcdn\.net\/thumb\/[^"'\s]+/gi)].map((m) => m[0]);
    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title,
      mileage,
      mileageUnit: "km",
      country: SLOVAKIA,
      location: SLOVAKIA,
      vehicle: vehicleFromParts({ vin, country: SLOVAKIA }),
      photos: vin ? asPhotos(photoUrls) : [],
    });
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin;
  }

  extractPhotos(listing: NormalizedListing): NormalizedPhoto[] {
    return listing.photos ?? [];
  }
}
