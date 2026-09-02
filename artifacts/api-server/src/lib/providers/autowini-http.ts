/**
 * Autowini HTTP client (v2api.autowini.com).
 * Public search works without a login token.
 */

import { HttpsProxyAgent } from "https-proxy-agent";

export const AUTWINI_API_BASE = "https://v2api.autowini.com";
export const AUTWINI_WEB_BASE = "https://www.autowini.com";
export const AUTWINI_COUNTRY_CODE = "C1570"; // S.Korea
export const AUTWINI_USED_CONDITION = "C020";

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024;

export class AutowiniRequestError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public url: string,
  ) {
    super(message);
    this.name = "AutowiniRequestError";
  }
}

export interface AutowiniSearchItem {
  code?: string;
  listingId?: string;
  detailUrl?: string;
  itemName?: string;
  content?: string;
  condition?: string;
  makeName?: string;
  subModelName?: string;
  modelName?: string;
  modelYear?: number;
  modelClass?: string;
  vin?: string;
  locationCode?: string;
  locationName?: string;
  vehicleType?: string;
  steeringType?: string;
  transmissionType?: string;
  drivetrainType?: string;
  fuelType?: string;
  engineVolume?: number;
  price?: number;
  discountPrice?: number | null;
  thumbnails?: string[];
  mainThumbnailPath?: string;
  mileage?: number;
  odometerCheck?: boolean;
  numberOfPassenger?: number;
  passengerCapacity?: number;
  steeringType?: string;
  photoCount?: number;
  hasInsuranceHistory?: boolean;
  hasGuarantee?: boolean;
  hasVideo?: boolean;
  freshStock?: boolean;
  almostSoldOut?: boolean;
  inspectionReportUploaded?: boolean;
  subThumbnail1Path?: string;
  subThumbnail2Path?: string;
  exteriorColor?: string;
  exteriorColorName?: string;
  colorName?: string;
  color?: string;
  firstRegistrationDate?: string;
  [key: string]: unknown;
}

export interface AutowiniSearchResponse {
  result?: string;
  data?: {
    totalCount?: number;
    hidden?: boolean;
    items?: AutowiniSearchItem[];
  };
}

export interface AutowiniDetailItem {
  listingId?: string;
  itemCode?: string;
  itemName?: string;
  modelName?: string;
  vinNumber?: string | null;
  itemPrice?: number;
  fuelTypeName?: string;
  engineVolume?: number;
  mileage?: number;
  driveTypeName?: string;
  passenger?: number;
  transmissionName?: string;
  imageUrl?: string;
  detailUrl?: string;
  tradeCountryName?: string;
  tradePortName?: string;
  exteriorColor?: string;
  exteriorColorName?: string;
  colorName?: string;
  color?: string;
  firstRegistrationDate?: string;
  [key: string]: unknown;
}

export interface AutowiniFilterOption {
  code: string;
  name: string;
  count?: number;
}

export interface AutowiniFilters {
  carMake?: AutowiniFilterOption[];
  carSubModel?: AutowiniFilterOption[];
  fuelType?: AutowiniFilterOption[];
  vehicleType?: AutowiniFilterOption[];
  transmission?: AutowiniFilterOption[];
  driveType?: AutowiniFilterOption[];
  exteriorColor?: AutowiniFilterOption[];
  [key: string]: unknown;
}

export interface AutowiniSearchParams {
  itemType?: string;
  condition?: string;
  make?: string;
  subModel?: string;
  model?: string;
  modelYearFrom?: number;
  modelYearTo?: number;
  mileageFrom?: number;
  mileageTo?: number;
  priceFrom?: number;
  priceTo?: number;
  fuelType?: string;
  vehicleType?: string;
  transmission?: string;
  driveType?: string;
  keyword?: string;
  sorting?: string;
  pageOffset?: number;
  pageSize?: number;
}

let proxyAgent: HttpsProxyAgent<string> | undefined;
let proxyUrlCached: string | undefined;

function getProxyAgent(): HttpsProxyAgent<string> | undefined {
  const url = process.env.AUTWINI_PROXY || process.env.ENCAR_PROXY;
  if (!url) return undefined;
  if (proxyAgent && proxyUrlCached === url) return proxyAgent;
  proxyUrlCached = url;
  proxyAgent = new HttpsProxyAgent(url);
  return proxyAgent;
}

function mobileUa(): string {
  return "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
}

async function fetchViaAgent(
  url: string,
  agent: HttpsProxyAgent<string>,
  init?: RequestInit,
): Promise<Response> {
  const https = await import("node:https");
  const parsed = new URL(url);
  return new Promise<Response>((resolve, reject) => {
    const req = https.request(
      parsed,
      {
        method: init?.method ?? "GET",
        agent,
        headers: init?.headers
          ? Object.fromEntries(
              init.headers instanceof Headers
                ? init.headers.entries()
                : Array.isArray(init.headers)
                  ? init.headers
                  : Object.entries(init.headers as Record<string, string>),
            )
          : undefined,
        signal: init?.signal as AbortSignal | undefined,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const body = Buffer.concat(chunks);
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers)) {
            if (v != null) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
          }
          resolve(
            new Response(body, {
              status: res.statusCode ?? 0,
              statusText: res.statusMessage ?? "",
              headers,
            }),
          );
        });
        res.on("error", reject);
      },
    );
    req.on("error", reject);
    req.end();
  });
}

export async function autowiniFetchJson<T>(
  path: string,
  params?: Record<string, string | number | undefined>,
  options?: { timeoutMs?: number; token?: string },
): Promise<T> {
  const url = new URL(path.startsWith("http") ? path : `${AUTWINI_API_BASE}${path}`);
  if (params) {
    for (const [key, value] of Object.entries(params)) {
      if (value == null || value === "") continue;
      url.searchParams.set(key, String(value));
    }
  }

  const headers: Record<string, string> = {
    "User-Agent": mobileUa(),
    Accept: "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9,ko;q=0.8",
    Origin: "https://m.autowini.com",
    Referer: "https://m.autowini.com/s/search?itemType=cars&condition=C020",
    "wini-code-select-country": AUTWINI_COUNTRY_CODE,
  };
  const token = options?.token || process.env.AUTWINI_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;

  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const agent = getProxyAgent();
    const init: RequestInit = { headers, signal: controller.signal };
    const res = agent ? await fetchViaAgent(url.toString(), agent, init) : await fetch(url, init);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length > MAX_BODY_BYTES) {
      throw new AutowiniRequestError(res.status, "Autowini response too large", url.toString());
    }
    const text = buf.toString("utf8");
    let json: unknown;
    try {
      json = JSON.parse(text) as unknown;
    } catch {
      throw new AutowiniRequestError(res.status, `Autowini returned non-JSON (${res.status})`, url.toString());
    }
    if (!res.ok) {
      const err = json as { errorMessage?: string; error?: string };
      throw new AutowiniRequestError(
        res.status,
        err.errorMessage || err.error || `Autowini HTTP ${res.status}`,
        url.toString(),
      );
    }
    return json as T;
  } catch (err) {
    if (err instanceof AutowiniRequestError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AutowiniRequestError(0, message.includes("abort") ? "Autowini request timed out" : message, url.toString());
  } finally {
    clearTimeout(timer);
  }
}

export async function autowiniSearchCars(
  params: AutowiniSearchParams,
  options?: { token?: string },
): Promise<{ items: AutowiniSearchItem[]; total: number }> {
  const itemType = params.itemType || "cars";
  const json = await autowiniFetchJson<AutowiniSearchResponse>(`/items/${itemType}`, {
    condition: params.condition || AUTWINI_USED_CONDITION,
    make: params.make,
    subModel: params.subModel,
    model: params.model,
    modelYearFrom: params.modelYearFrom,
    modelYearTo: params.modelYearTo,
    mileageFrom: params.mileageFrom,
    mileageTo: params.mileageTo,
    priceFrom: params.priceFrom,
    priceTo: params.priceTo,
    fuelType: params.fuelType,
    vehicleType: params.vehicleType,
    transmission: params.transmission,
    driveType: params.driveType,
    keyword: params.keyword,
    sorting: params.sorting,
    pageOffset: params.pageOffset && params.pageOffset > 1 ? params.pageOffset : undefined,
    pageSize: params.pageSize,
  }, options);
  return {
    items: json.data?.items ?? [],
    total: json.data?.totalCount ?? 0,
  };
}

export async function autowiniFetchDetail(
  listingId: string,
  options?: { token?: string },
): Promise<AutowiniDetailItem | null> {
  const json = await autowiniFetchJson<{ result?: string; data?: AutowiniDetailItem }>(
    `/items/${encodeURIComponent(listingId)}`,
    undefined,
    options,
  );
  return json.data ?? null;
}

let filterCache: { at: number; filters: AutowiniFilters } | null = null;

export async function autowiniFetchFilters(
  itemType = "cars",
  condition = AUTWINI_USED_CONDITION,
): Promise<AutowiniFilters> {
  if (filterCache && Date.now() - filterCache.at < 60 * 60 * 1000) {
    return filterCache.filters;
  }
  const json = await autowiniFetchJson<{ result?: string; data?: AutowiniFilters }>(
    `/items/${itemType}/filters`,
    { condition },
  );
  const filters = json.data ?? {};
  filterCache = { at: Date.now(), filters };
  return filters;
}

const AUTWINI_PHOTO_HOSTS = new Set(["imagebox.autowini.com", "image.autowini.com"]);

export function isAutowiniPhotoUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" && AUTWINI_PHOTO_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

export async function autowiniFetchBinary(rawUrl: string): Promise<{
  status: number;
  contentType: string;
  body: Buffer;
}> {
  if (!isAutowiniPhotoUrl(rawUrl)) {
    throw new AutowiniRequestError(400, "Not an Autowini photo URL", rawUrl);
  }
  const headers: Record<string, string> = {
    "User-Agent": mobileUa(),
    Accept: "image/jpeg,image/webp,image/png,image/*,*/*;q=0.8",
    Referer: `${AUTWINI_WEB_BASE}/`,
    Origin: AUTWINI_WEB_BASE,
  };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const agent = getProxyAgent();
    const init: RequestInit = { headers, signal: controller.signal, redirect: "manual" };
    let current = rawUrl;
    for (let hop = 0; hop < 4; hop++) {
      const res = agent ? await fetchViaAgent(current, agent, init) : await fetch(current, init);
      if (res.status >= 300 && res.status < 400) {
        const location = res.headers.get("location");
        if (!location) {
          throw new AutowiniRequestError(res.status, "Autowini photo redirect missing location", current);
        }
        const next = new URL(location, current);
        if (!isAutowiniPhotoUrl(next.toString())) {
          throw new AutowiniRequestError(res.status, "Autowini photo redirect blocked", current);
        }
        current = next.toString();
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length > MAX_BODY_BYTES) {
        throw new AutowiniRequestError(res.status, "Autowini image too large", current);
      }
      return {
        status: res.status,
        contentType: res.headers.get("content-type") ?? "",
        body: buf,
      };
    }
    throw new AutowiniRequestError(0, "Too many Autowini photo redirects", rawUrl);
  } catch (err) {
    if (err instanceof AutowiniRequestError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    throw new AutowiniRequestError(
      0,
      message.includes("abort") ? "Autowini request timed out" : message,
      rawUrl,
    );
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveAutowiniMakeCode(raw?: string): Promise<string | undefined> {
  if (!raw?.trim()) return undefined;
  const value = raw.trim();
  if (/^C\d{4}$/i.test(value)) return value.toUpperCase();
  const filters = await autowiniFetchFilters();
  const match = (filters.carMake ?? []).find((opt) => opt.name.toLowerCase() === value.toLowerCase());
  return match?.code ?? value;
}

export async function resolveAutowiniSubModelCode(
  raw?: string,
  makeCode?: string,
): Promise<string | undefined> {
  if (!raw?.trim()) return undefined;
  const value = raw.trim();
  if (/^C\d{4}$/i.test(value)) return value.toUpperCase();
  const filters = await autowiniFetchFilters("cars", AUTWINI_USED_CONDITION);
  const params: Record<string, string | number | undefined> = {
    condition: AUTWINI_USED_CONDITION,
    make: makeCode,
  };
  const json = await autowiniFetchJson<{ result?: string; data?: AutowiniFilters }>(
    "/items/cars/filters",
    params,
  );
  const options = json.data?.carSubModel ?? filters.carSubModel ?? [];
  const match = options.find((opt) => opt.name.toLowerCase() === value.toLowerCase());
  return match?.code ?? value;
}

export async function autowiniFetchSubModels(makeName?: string): Promise<string[]> {
  if (!makeName?.trim()) return [];
  const make = await resolveAutowiniMakeCode(makeName);
  const json = await autowiniFetchJson<{ result?: string; data?: AutowiniFilters }>(
    "/items/cars/filters",
    { condition: AUTWINI_USED_CONDITION, make },
  );
  return [...new Set((json.data?.carSubModel ?? []).map((opt) => opt.name).filter(Boolean))];
}

export async function resolveAutowiniFuelCode(raw?: string): Promise<string | undefined> {
  if (!raw?.trim()) return undefined;
  const value = raw.trim();
  if (/^C\d+/i.test(value)) return value.toUpperCase();
  const filters = await autowiniFetchFilters();
  const options = filters.fuelType ?? [];
  const match = options.find((opt) => opt.name.toLowerCase() === value.toLowerCase());
  if (match?.code) return match.code;
  const aliases: Record<string, string> = {
    petrol: "gasoline",
    gas: "gasoline",
    hybrid: "gasoline+electric",
    ev: "electric vehicle (ev)",
    electric: "electric vehicle (ev)",
  };
  const alias = aliases[value.toLowerCase()];
  const aliased = alias
    ? options.find((opt) => opt.name.toLowerCase() === alias)
    : undefined;
  return aliased?.code;
}
