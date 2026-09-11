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
import { autoplacSearchViaCdp, autoplacUsesCdp } from "./autoplac-cdp";

/**
 * Autoplac search contract (reverse-engineered from Angular SSR / JS chunks):
 *
 *   Live SPA pagination (what CDP must capture):
 *     GET https://api.autoplac.pl/offers/search?vehicleType=PASSENGER&p={page}
 *   Cold HTML navigations to ?p=N reset to page 1 — do not scrape /oferta hrefs
 *   as a pagination fallback (they repeat page-1 cards).
 *
 * SSR ng-state only hydrates page 1 reliably. Detail still works from Node:
 *   GET /offer/{hashedId}, GET /offer/list?ids=a,b
 *
 * Local-only crawl (needs Chrome CDP). Production fleet skips Autoplac.
 */
export const AUTOPLAC_PARSER_VERSION = "autoplac-v1.2.0";
const BASE = "https://autoplac.pl";
const API = "https://api.autoplac.pl";
const LIST_PATH = "/oferty/samochody-osobowe";
const PAGE_SIZE = 24;

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
  "X-Source": "AUTOPLAC_WEB_DESKTOP",
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
  const page = (await (
    await fetch(`${base}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })
  ).json()) as {
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
    // Wait for Angular ng-state transfer payload (search results).
    for (let i = 0; i < 20; i++) {
      const probe = await send<{ result?: { value?: boolean } }>("Runtime.evaluate", {
        expression:
          "!!document.getElementById('ng-state') && /offers\\/search/i.test(document.getElementById('ng-state').textContent || '')",
        returnByValue: true,
      });
      if (probe.result?.value) break;
      await new Promise((r) => setTimeout(r, 400));
    }
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
  // Prefer CDP when configured — Node TLS almost always hits CF on Autoplac.
  if (cdpEndpoint()) {
    try {
      return await fetchHtmlViaCdp(url);
    } catch {
      /* try bare fetch below */
    }
  }
  const fetched = await fetchHtml(url, PL_HEADERS);
  if (!isCfChallenge(fetched.text) && fetched.status < 400) return fetched;
  return fetchHtmlViaCdp(url);
}

function listPageUrl(page: number): string {
  const p = Math.max(1, page);
  return p <= 1 ? `${BASE}${LIST_PATH}` : `${BASE}${LIST_PATH}?p=${p}`;
}

/** Direct search API — usually empty for non-browser TLS; kept as a fast probe. */
async function trySearchApi(page: number): Promise<{
  offerList: unknown[];
  offerCount?: number;
} | null> {
  const p = Math.max(1, page);
  // SPA uses vehicleType=PASSENGER&p=N (seoCategories alone is SSR transfer-state only).
  const qs = new URLSearchParams({
    vehicleType: "PASSENGER",
    p: String(p),
  });
  try {
    const res = await fetch(`${API}/offers/search?${qs}`, {
      headers: API_HEADERS,
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const body = asRecord(await res.json());
    const offerList = asArray(body?.offerList);
    const offerCount = num(body?.offerCount);
    if (!offerList.length) return null;
    return { offerList, offerCount: offerCount ?? undefined };
  } catch {
    return null;
  }
}

function refsFromOfferList(offerList: unknown[]): ListingReference[] {
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
    const brand = str(offer.brand) ?? str(offer.brandName);
    const model = str(offer.model) ?? str(offer.modelName);
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
  return listings;
}

function paginatedRefs(
  page: number,
  offerList: unknown[],
  offerCount?: number,
): { listings: ListingReference[]; pagination: PaginationInfo } {
  const listings = refsFromOfferList(offerList);
  const totalPages =
    offerCount != null ? Math.ceil(offerCount / Math.max(PAGE_SIZE, listings.length || PAGE_SIZE)) : undefined;
  return {
    listings,
    pagination: {
      currentPage: page,
      hasMore: totalPages != null ? page < totalPages : listings.length >= PAGE_SIZE,
      totalPages,
      resultTotal: offerCount,
    },
  };
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
  // Strict: only this offer's gallery from api.photoList — never promoWorkshop /
  // dealer logos (/v1/p/dl/) / related-offer CDN noise scraped from HTML.
  const rows = asArray(photos)
    .map((p) => asRecord(p) ?? (typeof p === "string" ? { url: p } : undefined))
    .filter((p): p is Record<string, unknown> => !!p)
    .sort((a, b) => (num(a.sortNumber) ?? 0) - (num(b.sortNumber) ?? 0));

  const urls: string[] = [];
  const seen = new Set<string>();
  for (const rec of rows) {
    const raw =
      str(rec.originalUrl) ??
      str(rec.webpUrl) ??
      str(rec.url) ??
      // Miniatures only if nothing else exists for this shot.
      str(rec.webpMiniatureUrl) ??
      str(rec.miniatureUrl);
    if (!raw || !/^https?:\/\//i.test(raw)) continue;
    if (!isAutoplacOfferPhotoUrl(raw)) continue;
    const canon = canonicalizeAutoplacPhotoUrl(raw);
    if (!canon || seen.has(canon)) continue;
    seen.add(canon);
    urls.push(canon);
  }
  return urls;
}

/** Autoplac listing photos live at euw2-cdn…/v1/p/{uuid} — not /dl/, warsztaty, assets. */
function isAutoplacOfferPhotoUrl(url: string): boolean {
  try {
    const u = new URL(url);
    if (!/\.autoplac\.pl$/i.test(u.hostname)) return false;
    if (/\/warsztaty\//i.test(u.pathname)) return false;
    if (/\/assets\//i.test(u.pathname)) return false;
    if (/\/v1\/p\/dl\//i.test(u.pathname)) return false;
    return /\/v1\/p\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(u.pathname);
  } catch {
    return false;
  }
}

function canonicalizeAutoplacPhotoUrl(url: string): string | undefined {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/v1\/p\/([0-9a-f-]{36})/i);
    if (!m?.[1]) return undefined;
    // Stable identity without size/query variants (miniatures collapse to same UUID).
    return `https://euw2-cdn.autoplac.pl/v1/p/${m[1].toLowerCase()}`;
  } catch {
    return undefined;
  }
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
  // Never read promoWorkshop / suggested tiles — only this offer + its photoList.
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
  const history = asRecord(payload.vehicleHistory);
  const vin =
    vinOf(offer, description) ??
    vinOf({ vin: payload.vin }, description) ??
    vinOf({ vin: history?.vin }, "");
  const year = parseYear(offer.productionYear) ?? parseYear(str(offer.title));
  const mileage = num(offer.mileage);
  const engineCc = num(offer.engineCapacity);
  const photos = asPhotos(photoUrlsFromList(payload.photoList ?? offer.photoList));
  const events = buildEvents(offer);
  // Registry history (same VIN) — factual, not "suggested" ads.
  const histMileage = num(history?.lastRegisteredMileage);
  if (histMileage != null && histMileage > 0) {
    events.push({
      eventType: "inspection",
      description: `Registry last mileage ${histMileage} km`,
      occurredAt: toDate(history?.updateTime) ?? new Date(),
      metadata: {
        source: "autoplac",
        kind: "registryMileage",
        ownersCount: num(history?.ownersCount),
      },
    });
  }
  const country = countryOf(offer);
  const title =
    str(offer.title) ??
    [brand, model, str(offer.generation), year].filter(Boolean).join(" ");

  const powerKw = num(offer.enginePowerKW);
  const doors = num(offer.doors);
  const seats = num(offer.seats);
  if (powerKw != null || doors != null || seats != null) {
    events.push({
      eventType: "other",
      description: [
        powerKw != null ? `${powerKw} kW` : null,
        doors != null ? `${doors} doors` : null,
        seats != null ? `${seats} seats` : null,
      ]
        .filter(Boolean)
        .join(", "),
      occurredAt: new Date(),
      metadata: { source: "autoplac", kind: "specs", powerKw, doors, seats },
    });
  }
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
    const brandSlug =
      str((this._filters as { brandSlug?: unknown }).brandSlug) ??
      str((this._filters as { brand?: unknown }).brand) ??
      undefined;

    // 1) Probe Node search API (usually empty — bot/TLS gated).
    const apiHit = await trySearchApi(p);
    if (apiHit?.offerList.length) {
      return paginatedRefs(p, apiHit.offerList, apiHit.offerCount);
    }

    // 2) Preferred path: CDP SPA / SSR via brand shards when possible.
    if (autoplacUsesCdp()) {
      const cdpHit = await autoplacSearchViaCdp(p, { brandSlug: brandSlug?.toLowerCase() });
      return paginatedRefs(p, cdpHit.offerList, cdpHit.offerCount);
    }

    // 3) Page-1-only HTML fallback (SSR ng-state). Never href-scrape for p>1.
    if (p > 1) {
      throw new Error(
        `Autoplac discover page ${p} needs CDP (SPA pagination). Set AUTOPLAC_CDP_URL or IMPORT_MOTOR_CDP_URL.`,
      );
    }
    const listUrl = brandSlug
      ? `${BASE}${LIST_PATH}/${encodeURIComponent(brandSlug.toLowerCase())}`
      : listPageUrl(1);
    const fetched = await fetchListHtml(listUrl);
    const state = extractNgState(fetched.text);
    const search = offerSearchBody(state);
    const offerList = asArray(search?.offerList);
    const offerCount = num(search?.offerCount);
    const listings = refsFromOfferList(offerList);
    if (!listings.length) {
      throw new Error(
        `Autoplac discover page 1 returned 0 offers. Ensure AUTOPLAC_CDP_URL points at a cleared Chrome session.`,
      );
    }
    return paginatedRefs(1, offerList, offerCount ?? undefined);
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
    // Never scrape every CDN URL on the page (related offers / promoWorkshop leak in).
    const og =
      raw.match(/property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] ??
      raw.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
    const ogClean = og?.replace(/&amp;/g, "&");
    const scopedPhotos =
      ogClean && isAutoplacOfferPhotoUrl(ogClean)
        ? [canonicalizeAutoplacPhotoUrl(ogClean)].filter((u): u is string => !!u)
        : [];

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
