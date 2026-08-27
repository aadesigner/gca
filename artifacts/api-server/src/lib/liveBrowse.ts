/**
 * Shared live inventory browse logic (used by v1 API and admin test sandbox).
 */
import { db, liveProvidersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import type { LiveProviderAdapter, LiveVehicleFilter, LiveVehicle } from "@workspace/providers";
import { encarLiveAdapter } from "./providers/encarLive";
import { autowiniLiveAdapter } from "./providers/autowiniLive";
import { kbchachachaLiveAdapter } from "./providers/kbchachachaLive";
import {
  computeFingerprint,
  getCached,
  getStaleCached,
  setCached,
  recordCacheHit,
  incrementUpstreamAttempt,
} from "./liveCache";
import { decrypt } from "./crypto";
import { getKrwFxSnapshot, withLivePriceFx } from "./fx";

function withLivePriceFxList(vehicles: LiveVehicle[], fx: Awaited<ReturnType<typeof getKrwFxSnapshot>>) {
  return vehicles.map((v) => withLivePriceFx(v, fx));
}

export const LIVE_ADAPTERS: Record<string, LiveProviderAdapter> = {
  [encarLiveAdapter.internalName]: encarLiveAdapter,
  [autowiniLiveAdapter.internalName]: autowiniLiveAdapter,
  [kbchachachaLiveAdapter.internalName]: kbchachachaLiveAdapter,
};

const LIVE_PROVIDER_ALIASES: Record<string, string> = {
  encar: "encar_live",
  encar_live: "encar_live",
  autowini: "autowini_live",
  autowini_live: "autowini_live",
  kbchachacha: "kbchachacha_live",
  kbchachacha_live: "kbchachacha_live",
  kb: "kbchachacha_live",
  kbc: "kbchachacha_live",
  all: "combined_live",
  combined: "combined_live",
  combined_live: "combined_live",
};

export const COMBINED_LIVE_INTERNAL_NAME = "combined_live";

export function isCombinedLiveSlug(raw?: string | null): boolean {
  return canonicalizeLiveProviderName(raw) === COMBINED_LIVE_INTERNAL_NAME;
}

export function canonicalizeLiveProviderName(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  return LIVE_PROVIDER_ALIASES[key] ?? key;
}

export function registeredLiveProviderNames(): string[] {
  return Object.keys(LIVE_ADAPTERS);
}

export async function listEnabledLiveProviders(): Promise<
  Array<{ id: number; name: string; internalName: string }>
> {
  const rows = await db
    .select({
      id: liveProvidersTable.id,
      name: liveProvidersTable.name,
      internalName: liveProvidersTable.internalName,
    })
    .from(liveProvidersTable)
    .where(eq(liveProvidersTable.isEnabled, true))
    .orderBy(liveProvidersTable.id);
  return rows.filter((row) => LIVE_ADAPTERS[row.internalName]);
}

export async function resolvePublicLiveProvider(slug?: string | null): Promise<{
  provider: {
    id: number;
    name: string;
    internalName: string;
    isEnabled: boolean;
    cacheTtlSeconds: number;
    credentialsEncrypted: string | null;
    credentialsIv: string | null;
  } | null;
  requested?: string;
  unknownAdapter?: boolean;
}> {
  const requested = canonicalizeLiveProviderName(slug);
  if (requested) {
    if (requested === COMBINED_LIVE_INTERNAL_NAME) {
      return { provider: null, requested, unknownAdapter: false };
    }
    if (!LIVE_ADAPTERS[requested]) {
      return { provider: null, requested, unknownAdapter: true };
    }
    const [provider] = await db
      .select()
      .from(liveProvidersTable)
      .where(and(eq(liveProvidersTable.isEnabled, true), eq(liveProvidersTable.internalName, requested)))
      .limit(1);
    return { provider: provider ?? null, requested };
  }

  const enabled = await listEnabledLiveProviders();
  if (enabled.length === 0) return { provider: null };
  return { provider: await getLiveProviderById(enabled[0].id) };
}

export function applyLiveCacheHeaders(
  res: { setHeader: (name: string, value: string) => void },
  cached: boolean,
): void {
  res.setHeader("X-Live-Cache", cached ? "HIT" : "MISS");
  res.setHeader(
    "Cache-Control",
    cached
      ? "public, max-age=45, stale-while-revalidate=180"
      : "public, max-age=15, stale-while-revalidate=120",
  );
}

export function liveBrowseErrorStatus(code: string): number {
  switch (code) {
    case "NOT_FOUND":
    case "VEHICLE_NOT_FOUND":
      return 404;
    case "ADAPTER_MISSING":
    case "NO_LIVE_PROVIDER":
      return 503;
    default:
      return 502;
  }
}

const inflight = new Map<string, Promise<LiveBrowseListResult>>();

function effectiveTtl(seconds: number | null | undefined): number {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 5) return 300;
  return Math.max(seconds, 300);
}

function cacheKey(providerId: number, fingerprint: string): string {
  return `${providerId}:${fingerprint}`;
}

export function safeDecryptLiveCredentials(
  encrypted: string | null | undefined,
  iv: string | null | undefined,
): { apiUrl?: string; apiToken?: string } {
  if (!encrypted || !iv) return {};
  try {
    return JSON.parse(decrypt(encrypted, iv)) as { apiUrl?: string; apiToken?: string };
  } catch {
    return {};
  }
}

export async function getLiveProviderById(id: number) {
  const [provider] = await db
    .select()
    .from(liveProvidersTable)
    .where(eq(liveProvidersTable.id, id))
    .limit(1);
  return provider ?? null;
}

export interface LiveBrowseSourceResult {
  id: number;
  name: string;
  internalName: string;
  total: number;
  error?: string;
}

export interface LiveBrowseListResult {
  vehicles: LiveVehicle[];
  total: number;
  limit: number;
  offset: number;
  cached: boolean;
  cachedAt: Date | null;
  provider: { id: number; name: string; internalName: string };
  sources?: LiveBrowseSourceResult[];
}

export async function browseLiveVehicles(
  providerId: number,
  filters: LiveVehicleFilter,
  options?: { bypassCache?: boolean },
): Promise<LiveBrowseListResult> {
  const provider = await getLiveProviderById(providerId);
  if (!provider) {
    throw new LiveBrowseError("NOT_FOUND", "Live feed provider not found");
  }

  const adapter = LIVE_ADAPTERS[provider.internalName];
  if (!adapter) {
    throw new LiveBrowseError("ADAPTER_MISSING", `No adapter for '${provider.internalName}'`);
  }

  const limit = filters.limit ?? 20;
  const offset = filters.offset ?? 0;
  const fingerprint = computeFingerprint({ providerId: provider.id, locale: "en-v8", ...filters });
  const ttl = effectiveTtl(provider.cacheTtlSeconds);
  const key = cacheKey(provider.id, fingerprint);

  const wrap = async (
    vehicles: LiveVehicle[],
    total: number,
    cached: boolean,
    cachedAt: Date | null,
  ): Promise<LiveBrowseListResult> => {
    const fx = await getKrwFxSnapshot();
    return {
      vehicles: withLivePriceFxList(vehicles, fx),
      total,
      limit,
      offset,
      cached,
      cachedAt,
      provider: { id: provider.id, name: provider.name, internalName: provider.internalName },
    };
  };

  if (!options?.bypassCache) {
    const cached = await getCached<{ vehicles: LiveVehicle[]; total: number }>(provider.id, fingerprint);
    if (cached) {
      if (cached.id) recordCacheHit(cached.id, provider.id);
      return wrap(cached.data.vehicles, cached.totalCount, true, cached.cachedAt);
    }

    const stale = await getStaleCached<{ vehicles: LiveVehicle[]; total: number }>(provider.id, fingerprint);
    if (stale) {
      if (!inflight.has(key)) {
        inflight.set(key, refreshLiveList(provider, filters, fingerprint, ttl).finally(() => inflight.delete(key)));
      }
      if (stale.id) recordCacheHit(stale.id, provider.id);
      return wrap(stale.data.vehicles, stale.totalCount, true, stale.cachedAt);
    }
  }

  const pending = inflight.get(key);
  if (pending && !options?.bypassCache) return pending;

  const run = refreshLiveList(provider, filters, fingerprint, ttl).finally(() => inflight.delete(key));
  inflight.set(key, run);
  return run;
}

async function refreshLiveList(
  provider: { id: number; name: string; internalName: string; credentialsEncrypted?: string | null; credentialsIv?: string | null },
  filters: LiveVehicleFilter,
  fingerprint: string,
  ttl: number,
): Promise<LiveBrowseListResult> {
  const adapter = LIVE_ADAPTERS[provider.internalName];
  if (!adapter) {
    throw new LiveBrowseError("ADAPTER_MISSING", `No adapter for '${provider.internalName}'`);
  }
  await incrementUpstreamAttempt(provider.id);
  const credentials = safeDecryptLiveCredentials(provider.credentialsEncrypted, provider.credentialsIv);
  const fx = await getKrwFxSnapshot();
  try {
    const result = await adapter.fetchVehicles(filters, credentials);
    await setCached(provider.id, fingerprint, result, result.total, ttl);
    return {
      vehicles: result.vehicles.map((v) => withLivePriceFx(v, fx)),
      total: result.total,
      limit: filters.limit ?? 20,
      offset: filters.offset ?? 0,
      cached: false,
      cachedAt: new Date(),
      provider: { id: provider.id, name: provider.name, internalName: provider.internalName },
    };
  } catch (err: unknown) {
    const stale = await getStaleCached<{ vehicles: LiveVehicle[]; total: number }>(provider.id, fingerprint);
    if (stale) {
      return {
        vehicles: stale.data.vehicles.map((v) => withLivePriceFx(v, fx)),
        total: stale.totalCount,
        limit: filters.limit ?? 20,
        offset: filters.offset ?? 0,
        cached: true,
        cachedAt: stale.cachedAt,
        provider: { id: provider.id, name: provider.name, internalName: provider.internalName },
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    throw new LiveBrowseError("UPSTREAM_ERROR", msg);
  }
}

export async function browseLiveVehicle(
  providerId: number,
  listingId: string,
  options?: { bypassCache?: boolean },
): Promise<{
  vehicle: LiveVehicle;
  cached: boolean;
  cachedAt: Date | null;
  provider: { id: number; name: string; internalName: string };
}> {
  const provider = await getLiveProviderById(providerId);
  if (!provider) {
    throw new LiveBrowseError("NOT_FOUND", "Live feed provider not found");
  }

  const adapter = LIVE_ADAPTERS[provider.internalName];
  if (!adapter) {
    throw new LiveBrowseError("ADAPTER_MISSING", `No adapter for '${provider.internalName}'`);
  }

  const fingerprint = computeFingerprint({ providerId: provider.id, listingId });
  const meta = { id: provider.id, name: provider.name, internalName: provider.internalName };

  if (!options?.bypassCache) {
    const cached = await getCached<LiveVehicle>(provider.id, fingerprint);
    if (cached) {
      recordCacheHit(cached.id, provider.id);
      const fx = await getKrwFxSnapshot();
      return { vehicle: withLivePriceFx(cached.data, fx), cached: true, cachedAt: cached.cachedAt, provider: meta };
    }
  }

  await incrementUpstreamAttempt(provider.id);
  const credentials = safeDecryptLiveCredentials(provider.credentialsEncrypted, provider.credentialsIv);

  try {
    const vehicle = await adapter.fetchVehicle(listingId, credentials);
    if (!vehicle) {
      throw new LiveBrowseError("VEHICLE_NOT_FOUND", "No live listing found for this ID");
    }
    await setCached(provider.id, fingerprint, vehicle, 1, provider.cacheTtlSeconds);
    const fx = await getKrwFxSnapshot();
    return { vehicle: withLivePriceFx(vehicle, fx), cached: false, cachedAt: new Date(), provider: meta };
  } catch (err: unknown) {
    if (err instanceof LiveBrowseError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new LiveBrowseError("UPSTREAM_ERROR", msg);
  }
}

export class LiveBrowseError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "LiveBrowseError";
  }
}
