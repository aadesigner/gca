import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedEvent,
  NormalizedListing,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import { POLAND, canonicalCountry } from "../geo";
import {
  normalizeEuBodyType,
  normalizeEuColor,
  normalizeEuFuel,
  normalizeEuTransmission,
} from "./eu-locale";
import { normalizePlBody, normalizePlColor, normalizePlFuel, normalizePlTransmission } from "./pl-locale";
import { findVinInListing, normalizeKrVin, parseYear, vehicleFromParts, vinCheckDigitOk } from "./kr-common";
import { moneyListing } from "./us-common";
import {
  asArray,
  asPhotos,
  asRecord,
  fetchHtml,
  MARKET_UA,
  num,
  str,
} from "./web-html";

export const AUTOPLAC_PARSER_VERSION = "autoplac-v1.0.1";
const BASE = "https://www.autoplac.pl";
const API = "https://api.autoplac.pl";
const LIST_PATH = "/oferty/samochody-osobowe";

const PL_HEADERS = {
  "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.5",
  Referer: `${BASE}/`,
};

const API_HEADERS = {
  Accept: "application/json, text/plain, */*",
  "User-Agent": MARKET_UA,
  Origin: BASE,
  Referer: `${BASE}${LIST_PATH}`,
  "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.5",
};

function isCfChallenge(html: string): boolean {
  return /just a moment|cf-challenge|attention required|challenge-platform/i.test(html.slice(0, 8_000));
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

function cdpEndpoint(): string | undefined {
  return process.env.AUTOPLAC_CDP_URL?.trim() || process.env.IMPORT_MOTOR_CDP_URL?.trim() || undefined;
}

/** Fetch HTML through Chrome CDP when Node TLS is Cloudflare-blocked. */
async function fetchHtmlViaCdp(url: string): Promise<{ text: string; status: number; finalUrl: string }> {
  const endpoint = cdpEndpoint();
  if (!endpoint) {
    throw new Error(
      `Autoplac Cloudflare challenge on ${url} — set AUTOPLAC_CDP_URL or IMPORT_MOTOR_CDP_URL (Chrome --remote-debugging-port=9222)`,
    );
  }
  const base = endpoint.replace(/\/$/, "");
  const page = await (await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json() as {
    id?: string;
    webSocketDebuggerUrl?: string;
  };
  if (!page.webSocketDebuggerUrl || !page.id) {
    throw new Error(`Autoplac CDP could not open a tab for ${url}`);
  }

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Autoplac CDP websocket connect timed out")), 15_000);
    ws.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Autoplac CDP websocket failed"));
    });
  });

  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data)) as {
      id?: number;
      result?: unknown;
      error?: { message?: string };
    };
    if (msg.id == null) return;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message ?? "CDP error"));
    else p.resolve(msg.result);
  });

  const send = <T = unknown>(method: string, params?: Record<string, unknown>, timeoutMs = 60_000): Promise<T> =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, {
        resolve: (v) => resolve(v as T),
        reject,
      });
      ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (pending.has(id)) {
          pending.delete(id);
          reject(new Error(`Autoplac CDP ${method} timed out`));
        }
      }, timeoutMs);
    });

  try {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Page.navigate", { url });
    for (let i = 0; i < 45; i++) {
      await new Promise((r) => setTimeout(r, 800));
      const titleRes = await send<{ result?: { value?: string } }>("Runtime.evaluate", {
        expression: "document.title",
        returnByValue: true,
      });
      const title = titleRes.result?.value ?? "";
      if (title && !/just a moment|attention required/i.test(title)) break;
      if (i === 44) {
        throw new Error(`Autoplac CDP stuck on Cloudflare for ${url}`);
      }
    }
    await new Promise((r) => setTimeout(r, 1200));
    const htmlRes = await send<{ result?: { value?: string } }>("Runtime.evaluate", {
      expression: "document.documentElement.outerHTML",
      returnByValue: true,
    });
    const hrefRes = await send<{ result?: { value?: string } }>("Runtime.evaluate", {
      expression: "location.href",
      returnByValue: true,
    });
    const text = htmlRes.result?.value ?? "";
    if (!text || isCfChallenge(text)) {
      throw new Error(`Autoplac CDP returned Cloudflare challenge for ${url}`);
    }
    return { text, status: 200, finalUrl: hrefRes.result?.value ?? url };
  } finally {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    try {
      await fetch(`${base}/json/close/${page.id}`);
    } catch {
      /* ignore */
    }
  }
}

async function fetchListHtml(url: string): Promise<{ text: string; status: number; finalUrl: string }> {
  const fetched = await fetchHtml(url, PL_HEADERS);
  if (!isCfChallenge(fetched.text) && fetched.status < 400) return fetched;
  return fetchHtmlViaCdp(url);
}

export function autoplacDetailUrl(idOrPath: string, brandSlug?: string, modelSlug?: string): string {
  const raw = idOrPath.trim();
  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `${BASE}${raw}`;
  if (brandSlug && modelSlug) {
    return `${BASE}/oferta/${brandSlug}/${modelSlug}/${raw}`;
  }
  return `${BASE}/oferta/auto/auto/${raw}`;
}

function hashedIdFromUrl(url: string): string {
  const path = url.split("?")[0]!.replace(/\/+$/, "");
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] || path;
}

function slugifyPart(value?: string): string | undefined {
  if (!value) return undefined;
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function offerSearchBody(state: Record<string, unknown> | undefined): Record<string, unknown> | undefined {
  if (!state) return undefined;
  const key = Object.keys(state).find((k) => /api\.autoplac\.pl\/offers\/search/i.test(k));
  if (!key) return undefined;
  const wrap = asRecord(state[key]);
  return asRecord(wrap?.body) ?? wrap;
}

function photoUrlsFromList(photos: unknown): string[] {
  const urls = asArray(photos)
    .map((p) => {
      const rec = asRecord(p);
      return (
        str(rec?.webpUrl) ??
        str(rec?.url) ??
        str(rec?.webpMiniatureUrl) ??
        str(rec?.miniatureUrl) ??
        str(p)
      );
    })
    .filter((u): u is string => !!u && /^https?:\/\//i.test(u))
    .filter((u) => !/\/assets\/(?:banners|icons)\//i.test(u));
  return [...new Set(urls)];
}

function normalizeDrive(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  if (/four|4x4|awd|all.?wheel/i.test(raw)) return "AWD";
  if (/front|fwd/i.test(raw)) return "FWD";
  if (/rear|rwd/i.test(raw)) return "RWD";
  return raw;
}

function fuelOf(offer: Record<string, unknown>): string | undefined {
  return (
    normalizeEuFuel(str(offer.fuelType)) ??
    normalizePlFuel(str(offer.fuelTypeText)) ??
    normalizeEuFuel(str(offer.fuelTypeText))
  );
}

function transmissionOf(offer: Record<string, unknown>): string | undefined {
  return (
    normalizeEuTransmission(str(offer.transmissionType)) ??
    normalizePlTransmission(str(offer.transmissionTypeText)) ??
    normalizeEuTransmission(str(offer.transmissionTypeText))
  );
}

function bodyOf(offer: Record<string, unknown>): string | undefined {
  return (
    normalizeEuBodyType(str(offer.bodyType)) ??
    normalizePlBody(str(offer.bodyTypeText)) ??
    normalizeEuBodyType(str(offer.bodyTypeText))
  );
}

function colorOf(offer: Record<string, unknown>): string | undefined {
  return (
    normalizeEuColor(str(offer.colorText)) ??
    normalizePlColor(str(offer.colorText)) ??
    normalizeEuColor(str(offer.color)) ??
    normalizePlColor(str(offer.color))
  );
}

function priceOf(offer: Record<string, unknown>): number | undefined {
  const info = asRecord(offer.priceInfo);
  const primary = asRecord(info?.primary);
  return num(primary?.price) ?? num(primary?.valueWithoutCurrency) ?? num(offer.price);
}

function currencyOf(offer: Record<string, unknown>): string {
  const info = asRecord(offer.priceInfo);
  return str(info?.currency) ?? str(offer.currency) ?? "PLN";
}

function locationOf(offer: Record<string, unknown>): string {
  const info = asRecord(offer.locationInfo);
  const city = str(info?.city) ?? str(offer.city);
  const region = str(info?.voivodeshipDisplay) ?? str(offer.voivodeshipDisplay) ?? str(offer.voivodeship);
  const countryName =
    canonicalCountry(str(info?.locationCountryName) ?? str(offer.locationCountryName) ?? "") ||
    canonicalCountry(str(info?.locationCountry) ?? str(offer.locationCountry) ?? "") ||
    POLAND;
  return [city, region, countryName].filter(Boolean).join(", ");
}

function countryOf(offer: Record<string, unknown>): string {
  const info = asRecord(offer.locationInfo);
  return (
    canonicalCountry(str(info?.locationCountryName) ?? "") ||
    canonicalCountry(str(offer.locationCountryName) ?? "") ||
    canonicalCountry(str(info?.locationCountry) ?? "") ||
    canonicalCountry(str(offer.locationCountry) ?? "") ||
    POLAND
  );
}

function toDate(raw: unknown): Date | undefined {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const ms = raw > 1e12 ? raw : raw * 1000;
    const d = new Date(ms);
    return Number.isFinite(d.getTime()) ? d : undefined;
  }
  const text = str(raw);
  if (!text) return undefined;
  const d = new Date(text);
  return Number.isFinite(d.getTime()) ? d : undefined;
}

function buildEvents(offer: Record<string, unknown>): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const firstReg = toDate(offer.firstRegistrationDate);
  if (firstReg) {
    events.push({
      eventType: "delivery",
      description: `First registration ${firstReg.toISOString().slice(0, 10)}`,
      occurredAt: firstReg,
      metadata: { source: "autoplac", kind: "firstRegistration" },
    });
  }
  if (offer.noAccidents === true) {
    events.push({
      eventType: "other",
      description: "Declared accident-free",
      occurredAt: new Date(),
      metadata: { source: "autoplac", kind: "noAccidents" },
    });
  }
  if (offer.damaged === true) {
    events.push({
      eventType: "accident",
      description: "Listed as damaged",
      occurredAt: new Date(),
      metadata: { source: "autoplac", kind: "damaged" },
    });
  }
  if (offer.firstOwner === true) {
    events.push({
      eventType: "other",
      description: "First owner",
      occurredAt: new Date(),
      metadata: { source: "autoplac", kind: "firstOwner" },
    });
  }
  if (offer.domestic === true) {
    events.push({
      eventType: "other",
      description: "Domestic (Poland) vehicle",
      occurredAt: new Date(),
      metadata: { source: "autoplac", kind: "domestic" },
    });
  }
  const insurance = toDate(offer.insuranceEndDate);
  if (insurance) {
    events.push({
      eventType: "other",
      description: `Insurance valid until ${insurance.toISOString().slice(0, 10)}`,
      occurredAt: insurance,
      metadata: { source: "autoplac", kind: "insuranceEnd" },
    });
  }
  return events;
}

function vinOf(offer: Record<string, unknown>, description?: string): string | undefined {
  const raw = str(offer.vin) ?? findVinInListing(description ?? "", str(offer.title) ?? "");
  if (!raw) return undefined;
  const vin = normalizeKrVin(raw);
  if (!vin) return undefined;
  if (!vinCheckDigitOk(vin)) return undefined;
  return vin;
}

function parseOfferPayload(
  payload: Record<string, unknown>,
  pageUrl: string,
): NormalizedListing {
  const offer = asRecord(payload.offer) ?? payload;
  const hashedId =
    str(offer.hashedId) ??
    hashedIdFromUrl(str(offer.webUrl) ?? str(offer.offerUrl) ?? pageUrl);
  const brand = str(offer.brand);
  const model = str(offer.model);
  const sourceUrl =
    str(offer.webUrl)?.startsWith("http")
      ? str(offer.webUrl)!
      : str(offer.webUrl)
        ? `${BASE}${str(offer.webUrl)}`
        : autoplacDetailUrl(hashedId, slugifyPart(brand), slugifyPart(model));

  const description = str(offer.description) ?? "";
  const vin = vinOf(offer, description);
  const year = parseYear(offer.productionYear) ?? parseYear(str(offer.title));
  const mileage = num(offer.mileage);
  const engineCc = num(offer.engineCapacity);
  const photos = asPhotos(photoUrlsFromList(payload.photoList ?? offer.photoList));
  const events = buildEvents(offer);
  const country = countryOf(offer);
  const title =
    str(offer.title) ??
    [brand, model, str(offer.generation), year].filter(Boolean).join(" ");

  return moneyListing({
    sourceId: hashedId,
    sourceUrl,
    title,
    price: priceOf(offer),
    currency: currencyOf(offer),
    mileage,
    mileageUnit: "km",
    location: locationOf(offer),
    country,
    sold: /sold|ended|inactive|deleted/i.test(str(offer.status) ?? "") || offer.status === false,
    vehicle: vehicleFromParts({
      vin,
      make: brand,
      model,
      year,
      trim: [str(offer.generation), str(offer.version)].filter(Boolean).join(" ") || undefined,
      fuelType: fuelOf(offer),
      transmission: transmissionOf(offer),
      bodyType: bodyOf(offer),
      color: colorOf(offer),
      driveType: normalizeDrive(str(offer.driveType) ?? str(offer.driveTypeText)),
      engineDisplacement: engineCc ? String(engineCc) : undefined,
      country,
    }),
    photos,
    events: events.length ? events : undefined,
  });
}

export class AutoplacHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "autoplac";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const p = Math.max(1, page);
    const url = p <= 1 ? `${BASE}${LIST_PATH}` : `${BASE}${LIST_PATH}?p=${p}`;
    const fetched = await fetchListHtml(url);
    const state = extractNgState(fetched.text);
    const search = offerSearchBody(state);
    const offerList = asArray(search?.offerList);
    const offerCount = num(search?.offerCount);

    const listings: ListingReference[] = [];
    const seen = new Set<string>();

    for (const row of offerList) {
      const wrap = asRecord(row);
      const offer = asRecord(wrap?.offer) ?? wrap;
      if (!offer) continue;
      const hashedId = str(offer.hashedId);
      if (!hashedId || seen.has(hashedId)) continue;
      seen.add(hashedId);
      const webUrl = str(offer.webUrl);
      const brand = str(offer.brand);
      const model = str(offer.model);
      listings.push({
        sourceId: hashedId,
        url: webUrl?.startsWith("http")
          ? webUrl
          : webUrl
            ? `${BASE}${webUrl}`
            : autoplacDetailUrl(hashedId, slugifyPart(brand), slugifyPart(model)),
        metadata: {
          offerId: num(offer.id) ?? str(offer.id),
          mileage: num(offer.mileage),
          price: priceOf(offer),
          vinAvailable: offer.vinAvailable === true,
          make: brand,
          model,
        },
      });
    }

    if (!listings.length) {
      for (const match of fetched.text.matchAll(/href="(\/oferta\/[^"]+)"/gi)) {
        const path = match[1]!.split("?")[0]!;
        const id = hashedIdFromUrl(path);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        listings.push({ sourceId: id, url: `${BASE}${path}` });
      }
    }

    const pageSize = Math.max(listings.length, 24);
    const totalPages = offerCount != null ? Math.ceil(offerCount / pageSize) : undefined;

    return {
      listings,
      pagination: {
        currentPage: p,
        hasMore: totalPages != null ? p < totalPages : listings.length >= 20,
        totalPages,
        resultTotal: offerCount ?? undefined,
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const hashedId = hashedIdFromUrl(url);
    const apiUrl = `${API}/offer/${encodeURIComponent(hashedId)}`;
    const res = await fetch(apiUrl, {
      headers: API_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`Autoplac API ${res.status} at ${apiUrl}`);
    }
    // Empty object means bad id / removed offer.
    if (text === "{}" || text === "null") {
      throw new Error(`Autoplac offer empty for ${hashedId}`);
    }
    return {
      url: url.startsWith("http") ? url : autoplacDetailUrl(hashedId),
      html: text,
      statusCode: res.status,
      headers: { "content-type": "application/json" },
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const raw = fetched.html ?? "";
    try {
      const parsed = JSON.parse(raw) as unknown;
      const root = asRecord(parsed);
      if (root && (root.offer || root.photoList || root.vin || root.hashedId)) {
        return parseOfferPayload(root, fetched.url);
      }
    } catch {
      /* fall through to HTML / ng-state */
    }

    const state = extractNgState(raw);
    if (state) {
      const key = Object.keys(state).find((k) => /api\.autoplac\.pl\/offer\//i.test(k));
      const wrap = key ? asRecord(state[key]) : undefined;
      const body = asRecord(wrap?.body) ?? wrap;
      if (body && (body.offer || body.photoList)) {
        return parseOfferPayload(body, fetched.url);
      }
    }

    const hashedId = hashedIdFromUrl(fetched.url);
    const vin = findVinInListing(raw);
    const title = raw.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const mileage = num(raw.match(/([\d\s]{2,})\s*km/i)?.[1]?.replace(/\s/g, ""));
    // HTML fallback only — API/ng-state paths above carry the real photoList.
    // Never scrape every CDN URL on the page (related offers leak in).
    const og =
      raw.match(/property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] ??
      raw.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
    const scopedPhotos = og ? [og.replace(/&amp;/g, "&")] : [];

    return moneyListing({
      sourceId: hashedId,
      sourceUrl: fetched.url,
      title,
      mileage,
      mileageUnit: "km",
      currency: "PLN",
      country: POLAND,
      location: POLAND,
      vehicle: vehicleFromParts({ vin, country: POLAND }),
      photos: asPhotos(scopedPhotos),
    });
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin;
  }

  extractPhotos(listing: NormalizedListing): NormalizedPhoto[] {
    return listing.photos ?? [];
  }
}
