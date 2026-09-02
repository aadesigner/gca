export interface LiveVehicle {
  listingId: string;
  vin?: string;
  make?: string;
  model?: string;
  modelGroup?: string;
  badge?: string;
  trim?: string;
  year?: number;
  mileage?: number;
  price?: number;
  currency?: string;
  priceOnRequest?: boolean;
  msrp?: number;
  msrpUsd?: number | null;
  msrpEur?: number | null;
  fuel?: string;
  transmission?: string;
  drivetrain?: string;
  bodyType?: string;
  color?: string;
  engineDisplacement?: string;
  location?: string;
  country?: string;
  photos?: string[];
  listingUrl?: string;
  status: string;
  accidentCount?: number;
  ownerChangeCount?: number;
  priceUsd?: number | null;
  priceEur?: number | null;
  fx?: {
    usdPerKrw: number;
    eurPerKrw: number;
    krwPerUsd: number;
    krwPerEur: number;
    fetchedAt: string;
    source: string;
  } | null;
  createdDate?: string;
  updatedDate?: string;
  soldDate?: string;
  sourceProvider?: {
    id: number;
    name: string;
    internalName: string;
  };
}

export type LiveFeedId = number | "combined";

export interface LiveVehicleFilters {
  make?: string;
  model?: string;
  modelGroup?: string;
  badgeGroup?: string;
  yearFrom?: number;
  yearTo?: number;
  priceMin?: number;
  priceMax?: number;
  mileageMin?: number;
  mileageMax?: number;
  engineMin?: number;
  engineMax?: number;
  fuel?: string;
  transmission?: string;
  drivetrain?: string;
  bodyType?: string;
  color?: string;
  location?: string;
  carType?: "import" | "domestic" | "all";
  search?: string;
  sortBy?: "price" | "year" | "mileage" | "createdDate";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

export interface LiveFeedCapabilities {
  supportsFiltering: boolean;
  supportedFilters: string[];
  supportsSorting: boolean;
  supportedSortFields: string[];
  supportsSearch: boolean;
  maxPageSize: number;
}

export interface LiveFeedFilterOptions {
  makes: string[];
  models?: string[];
  fuels: string[];
  transmissions: string[];
  drivetrains: string[];
  bodyTypes: string[];
  carTypes: Array<{ value: string; label: string }>;
  sortOptions: Array<{ value: string; label: string }>;
}

export interface LiveVehicleEvent {
  eventType: string;
  description: string;
  occurredAt?: string;
  metadata?: Record<string, unknown>;
}

export interface LiveVehicleDetail {
  vehicle: LiveVehicle;
  vin?: string;
  trim?: string;
  bodyType?: string;
  color?: string;
  engineDisplacement?: string;
  features?: string[];
  photos: string[];
  events: LiveVehicleEvent[];
  registry?: {
    available: boolean;
    firstDate?: string;
    ownerChangeCount?: number;
    accidentCount?: number;
    myAccidentCost?: number;
    otherAccidentCost?: number;
    totalLossCount?: number;
    floodDamage?: boolean;
    loan?: number;
    ownerChanges?: Array<{
      date: string;
      sequence?: number;
      info?: string;
      plate?: string;
      mileageKm?: number;
      mileageMiles?: number;
      mileageNote?: string;
      source?: string;
    }>;
    accidents?: Array<{
      date?: string;
      type?: string;
      repairTotal?: number;
      insuranceBenefit?: number;
    }>;
  };
  diagnosis?: Record<string, unknown> | null;
  inspection?: Record<string, unknown> | null;
  listingUrl?: string;
  ownerChanges?: Array<{
    date: string;
    sequence?: number;
    info?: string;
    plate?: string;
    mileageKm?: number;
    mileageMiles?: number;
    mileageNote?: string;
    source?: string;
  }>;
  accidents?: Array<{
    date?: string;
    type?: string;
    mileageKm?: number;
    mileageMiles?: number;
    source?: string;
  }>;
  mileageHistory?: Array<{
    date: string;
    mileageKm: number;
    mileageMiles: number;
    kind?: string;
    source?: string;
    sources?: string[];
    latest?: boolean;
    tag?: "latest";
  }>;
  /** True when only list-level fields were available (inspection/registry missing). */
  partial?: boolean;
}

export interface LiveFeedBrowseResponse {
  success: boolean;
  data: {
    vehicles: LiveVehicle[];
    total: number;
    limit: number;
    offset: number;
    cached: boolean;
    cachedAt: string | null;
    provider: { id: number; name: string; internalName: string };
    sources?: Array<{
      id: number;
      name: string;
      internalName: string;
      total: number;
      error?: string;
    }>;
  };
}

const BASE = "/api/admin/live-feeds";
const BROWSE_MEM_TTL_MS = 3 * 60 * 1000;
const browseMemory = new Map<string, { response: LiveFeedBrowseResponse; at: number }>();

function browseMemKey(feedId: LiveFeedId, filters: LiveVehicleFilters) {
  const stable = Object.fromEntries(
    Object.entries(filters)
      .filter(([, v]) => v !== undefined && v !== "" && v !== null)
      .sort(([a], [b]) => a.localeCompare(b)),
  );
  return `${feedId}:${JSON.stringify(stable)}`;
}

function rememberBrowse(feedId: LiveFeedId, filters: LiveVehicleFilters, response: LiveFeedBrowseResponse) {
  browseMemory.set(browseMemKey(feedId, filters), { response, at: Date.now() });
  if (browseMemory.size > 80) {
    const first = browseMemory.keys().next().value;
    if (first) browseMemory.delete(first);
  }
}

export function peekLiveBrowseCache(feedId: LiveFeedId, filters: LiveVehicleFilters) {
  const hit = browseMemory.get(browseMemKey(feedId, filters));
  if (!hit || Date.now() - hit.at > BROWSE_MEM_TTL_MS) return null;
  return { response: hit.response, ageMs: Date.now() - hit.at };
}

async function apiFetch<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs, ...fetchInit } = init ?? {};
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs ?? 20_000);
  const linkedAbort = () => controller.abort();
  fetchInit.signal?.addEventListener("abort", linkedAbort, { once: true });
  let res: Response;
  try {
    res = await fetch(url, {
      ...fetchInit,
      signal: controller.signal,
      credentials: "include",
      headers: { "Content-Type": "application/json", ...(fetchInit.headers ?? {}) },
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error("Live feed request timed out. Encar may be blocked or responding too slowly.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    fetchInit.signal?.removeEventListener("abort", linkedAbort);
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

function buildQuery(filters: LiveVehicleFilters, extra?: Record<string, string | boolean>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "" && value !== null) {
      params.set(key, String(value));
    }
  }
  if (extra) {
    for (const [key, value] of Object.entries(extra)) {
      if (value !== undefined && value !== "") params.set(key, String(value));
    }
  }
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export async function fetchLiveFeedCapabilities(
  feedId: LiveFeedId,
  extra?: { make?: string; carType?: string },
) {
  const params = new URLSearchParams();
  if (extra?.make) params.set("make", extra.make);
  if (extra?.carType) params.set("carType", extra.carType);
  const qs = params.toString();
  return apiFetch<{
    provider: { id: number; name: string; internalName: string; isEnabled: boolean };
    capabilities: LiveFeedCapabilities;
    filterOptions: LiveFeedFilterOptions;
    categories: {
      fuels: string[];
      transmissions: string[];
      drivetrains: string[];
      statuses: string[];
    };
  }>(`${BASE}/${feedId}/capabilities${qs ? `?${qs}` : ""}`);
}

export async function browseLiveFeedVehicles(
  feedId: LiveFeedId,
  filters: LiveVehicleFilters,
  options?: { bypassCache?: boolean; signal?: AbortSignal },
) {
  const qs = buildQuery(filters, options?.bypassCache ? { bypassCache: "true" } : undefined);
  const res = await apiFetch<LiveFeedBrowseResponse>(`${BASE}/${feedId}/vehicles${qs}`, {
    signal: options?.signal,
    timeoutMs: feedId === "combined" ? 45_000 : 20_000,
  });
  if (res.success) {
    res.data.vehicles = res.data.vehicles.map((vehicle) => ({
      ...vehicle,
      photos: vehicle.photos?.map((src) => encarPhotoUrl(src, "card")).filter(Boolean),
    }));
    rememberBrowse(feedId, filters, res);
  }
  return res;
}

export async function fetchLiveFeedVehicleDetail(
  feedId: LiveFeedId,
  listingId: string,
  extra?: { providerId?: number },
) {
  const params = new URLSearchParams();
  if (extra?.providerId) params.set("providerId", String(extra.providerId));
  const qs = params.toString();
  const res = await apiFetch<{ success: boolean; data: LiveVehicleDetail }>(
    `${BASE}/${feedId}/vehicles/${encodeURIComponent(listingId)}/detail${qs ? `?${qs}` : ""}`,
    { timeoutMs: 25_000 },
  );
  if (res.success && res.data) {
    res.data.photos = (res.data.photos ?? []).map((src) => encarPhotoUrl(src, "display"));
    if (res.data.vehicle?.photos) {
      res.data.vehicle.photos = res.data.vehicle.photos.map((src) => encarPhotoUrl(src, "card"));
    }
  }
  return res;
}

export function formatKrwPrice(price?: number, currency = "KRW") {
  if (price == null) return "—";
  if (currency === "KRW") {
    return `₩${price.toLocaleString("ko-KR")}`;
  }
  return `${currency} ${price.toLocaleString()}`;
}

export function formatKm(mileage?: number) {
  if (mileage == null) return "—";
  const miles = Math.round(mileage * 0.621371);
  return `${mileage.toLocaleString()} km (${miles.toLocaleString()} mi)`;
}

const ENCAR_PHOTO_SIZES = {
  card: { rh: "290", cw: "387", ch: "290" },
  thumb: { rh: "176", cw: "236", ch: "176" },
  display: { rh: "1650", cw: "2200", ch: "1650" },
} as const;

export function isAutowiniPhotoUrl(url: string): boolean {
  try {
    const parsed = url.startsWith("//") ? new URL(`https:${url}`) : new URL(url);
    const host = parsed.hostname.toLowerCase();
    return host === "imagebox.autowini.com" || host === "image.autowini.com";
  } catch {
    return false;
  }
}

/** Auctionauto wraps Autowini files on a CDN that 404s; the original host still serves them. */
export function rewriteAuctionautoPhotoUrl(url: string): string {
  const wrapped = url.match(/static\.auctionauto\.com\.ua\/images\/image\.autowini\.com\/(.+)$/i);
  if (wrapped) return `https://image.autowini.com/${wrapped[1]}`;
  return url;
}

/** Same-origin Autowini photo path so the CDN never sees our dashboard Referer. */
export function autowiniPhotoProxyPath(url: string, size: keyof typeof ENCAR_PHOTO_SIZES = "card"): string {
  let normalized = url;
  if (size === "card" || size === "thumb") {
    normalized = normalized.replace(/_720(\.[a-z0-9]+)$/i, "_320$1");
  }
  const parsed = normalized.startsWith("//") ? new URL(`https:${normalized}`) : new URL(normalized);
  if (parsed.hostname.toLowerCase() === "image.autowini.com") {
    return `/media/autowini-img${parsed.pathname}${parsed.search}`;
  }
  return `/media/autowini${parsed.pathname}${parsed.search}`;
}

/** Use Encar’s small CDN size for grid cards; full size in the gallery. */
export function encarPhotoUrl(url: string | undefined, size: keyof typeof ENCAR_PHOTO_SIZES): string {
  if (!url) return "";
  const rewritten = rewriteAuctionautoPhotoUrl(url);
  if (rewritten.startsWith("/media/autowini") || rewritten.startsWith("/api/admin/media/proxy")) return rewritten;
  if (isAutowiniPhotoUrl(rewritten)) return autowiniPhotoProxyPath(rewritten, size);
  if (!/encar\.com/i.test(rewritten)) return rewritten;
  try {
    const parsed = new URL(rewritten, window.location.origin);
    const dim = ENCAR_PHOTO_SIZES[size];
    parsed.searchParams.set("impolicy", "heightRate");
    parsed.searchParams.set("rh", dim.rh);
    parsed.searchParams.set("cw", dim.cw);
    parsed.searchParams.set("ch", dim.ch);
    parsed.searchParams.set("cg", "Center");
    return parsed.toString();
  } catch {
    return rewritten;
  }
}

export function liveVehicleHref(
  feedPath: string | number,
  listingId: string,
  providerId?: number,
) {
  const params = new URLSearchParams();
  if (providerId) params.set("providerId", String(providerId));
  const qs = params.toString();
  return `/live-feeds/${feedPath}/test/${encodeURIComponent(listingId)}${qs ? `?${qs}` : ""}`;
}

const SNAPSHOT_PREFIX = "live-feed-vehicle:";

export function rememberLiveVehicleSnapshot(feedId: LiveFeedId, vehicle: LiveVehicle) {
  try {
    sessionStorage.setItem(
      `${SNAPSHOT_PREFIX}${feedId}:${vehicle.listingId}`,
      JSON.stringify(vehicle),
    );
    sessionStorage.setItem(`${SNAPSHOT_PREFIX}last-browse`, window.location.pathname + window.location.search);
  } catch {
    // private mode / quota
  }
}

export function readLiveVehicleSnapshot(feedId: LiveFeedId, listingId: string): LiveVehicle | null {
  try {
    const raw = sessionStorage.getItem(`${SNAPSHOT_PREFIX}${feedId}:${listingId}`);
    return raw ? (JSON.parse(raw) as LiveVehicle) : null;
  } catch {
    return null;
  }
}

export function readLiveBrowseHref(fallback: string) {
  try {
    return sessionStorage.getItem(`${SNAPSHOT_PREFIX}last-browse`) || fallback;
  } catch {
    return fallback;
  }
}

export function snapshotToDetail(vehicle: LiveVehicle): LiveVehicleDetail {
  return {
    vehicle,
    vin: vehicle.vin,
    trim: vehicle.trim,
    bodyType: vehicle.bodyType,
    color: vehicle.color,
    engineDisplacement: vehicle.engineDisplacement,
    features: vehicle.features,
    photos: vehicle.photos ?? [],
    events: [],
    listingUrl: vehicle.listingUrl,
    partial: true,
  };
}

export function filterIsSupported(
  capabilities: LiveFeedCapabilities | null,
  key: keyof LiveVehicleFilters,
): boolean {
  if (!capabilities) return true;
  return capabilities.supportedFilters.includes(key);
}
