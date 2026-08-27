/**
 * Live provider response cache — PostgreSQL-backed TTL cache.
 *
 * Cache entries are keyed by (providerId, queryFingerprint) where the
 * fingerprint is the SHA-256 hash of the normalized query parameters.
 *
 * Lifetime statistics are tracked via counters on the live_providers table:
 *   - totalUpstreamCalls  — incremented BEFORE each upstream adapter call
 *                           (via incrementUpstreamAttempt), so failed calls are
 *                           counted as well as successful ones.
 *   - totalCacheHits      — incremented on every cache hit (awaited)
 *   - lastUpstreamCallAt  — updated only on successful upstream calls and cache
 *                           writes (via setCached), so it reflects the last time
 *                           we got a valid response; survives cache-entry expiry
 *
 * All counter writes are awaited — not fire-and-forget — so they reliably
 * appear in aggregate stats.
 */
import crypto from "crypto";
import { db, liveProviderCacheTable, liveProvidersTable } from "@workspace/db";
import { eq, and, gt, lt, sql } from "drizzle-orm";

const STALE_WINDOW_MS = 30 * 60 * 1000;
const memory = new Map<string, CachedResponse<unknown>>();

function memKey(providerId: number, fingerprint: string): string {
  return `${providerId}:${fingerprint}`;
}

function memGet<T>(providerId: number, fingerprint: string, allowStale: boolean): CachedResponse<T> | null {
  const hit = memory.get(memKey(providerId, fingerprint)) as CachedResponse<T> | undefined;
  if (!hit) return null;
  const now = Date.now();
  if (hit.expiresAt.getTime() > now) return hit;
  if (allowStale && now - hit.cachedAt.getTime() < STALE_WINDOW_MS) return hit;
  return null;
}

function memSet<T>(providerId: number, fingerprint: string, entry: CachedResponse<T>): void {
  memory.set(memKey(providerId, fingerprint), entry);
  if (memory.size > 2_000) {
    const first = memory.keys().next().value;
    if (first) memory.delete(first);
  }
}

/**
 * Compute a stable cache fingerprint for a set of query parameters.
 */
export function computeFingerprint(params: Record<string, unknown>): string {
  const stable = JSON.stringify(
    Object.fromEntries(
      Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .sort(([a], [b]) => a.localeCompare(b))
    )
  );
  return crypto.createHash("sha256").update(stable).digest("hex");
}

export interface CachedResponse<T> {
  id: number;
  data: T;
  totalCount: number;
  cachedAt: Date;
  expiresAt: Date;
}

/**
 * Look up a valid (non-expired) cache entry.
 * Returns null on miss. Opportunistically prunes expired entries (non-critical).
 */
export async function getCached<T>(
  providerId: number,
  fingerprint: string
): Promise<CachedResponse<T> | null> {
  const memHit = memGet<T>(providerId, fingerprint, false);
  if (memHit) return memHit;

  const now = new Date();
  const [row] = await db
    .select()
    .from(liveProviderCacheTable)
    .where(
      and(
        eq(liveProviderCacheTable.providerId, providerId),
        eq(liveProviderCacheTable.queryFingerprint, fingerprint),
        gt(liveProviderCacheTable.expiresAt, now)
      )
    )
    .limit(1);

  if (!row) {
    db.delete(liveProviderCacheTable)
      .where(
        and(
          eq(liveProviderCacheTable.providerId, providerId),
          lt(liveProviderCacheTable.expiresAt, now)
        )
      )
      .catch(() => {});
    return null;
  }

  const entry: CachedResponse<T> = {
    id: row.id,
    data: JSON.parse(row.responseData) as T,
    totalCount: row.totalCount,
    cachedAt: row.cachedAt,
    expiresAt: row.expiresAt,
  };
  memSet(providerId, fingerprint, entry);
  return entry;
}

/** Recently expired cache — used to keep the UI fast while a refresh runs. */
export async function getStaleCached<T>(
  providerId: number,
  fingerprint: string,
): Promise<CachedResponse<T> | null> {
  const memHit = memGet<T>(providerId, fingerprint, true);
  if (memHit) return memHit;

  const since = new Date(Date.now() - STALE_WINDOW_MS);
  const [row] = await db
    .select()
    .from(liveProviderCacheTable)
    .where(
      and(
        eq(liveProviderCacheTable.providerId, providerId),
        eq(liveProviderCacheTable.queryFingerprint, fingerprint),
        gt(liveProviderCacheTable.cachedAt, since),
      ),
    )
    .limit(1);

  if (!row) return null;
  const entry: CachedResponse<T> = {
    id: row.id,
    data: JSON.parse(row.responseData) as T,
    totalCount: row.totalCount,
    cachedAt: row.cachedAt,
    expiresAt: row.expiresAt,
  };
  memSet(providerId, fingerprint, entry);
  return entry;
}

/**
 * Record an upstream attempt BEFORE calling the adapter.
 * Awaited so the count is reliable even when the upstream call fails.
 *
 * Note: lastUpstreamCallAt is NOT updated here — it is updated only by
 * setCached() on a successful response, distinguishing attempts from successes.
 */
export async function incrementUpstreamAttempt(providerId: number): Promise<void> {
  await db
    .update(liveProvidersTable)
    .set({ totalUpstreamCalls: sql`${liveProvidersTable.totalUpstreamCalls} + 1` })
    .where(eq(liveProvidersTable.id, providerId));
}

/**
 * Store or refresh a cache entry with a TTL in seconds, and record the
 * successful call timestamp. Call this only after a successful adapter response.
 */
export async function setCached<T>(
  providerId: number,
  fingerprint: string,
  data: T,
  totalCount: number,
  ttlSeconds: number
): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const responseData = JSON.stringify(data);
  const entry: CachedResponse<T> = {
    id: 0,
    data,
    totalCount,
    cachedAt: now,
    expiresAt,
  };
  memSet(providerId, fingerprint, entry);

  // Upsert cache entry and record the last-successful-call timestamp in parallel
  await Promise.all([
    db
      .insert(liveProviderCacheTable)
      .values({
        providerId,
        queryFingerprint: fingerprint,
        responseData,
        totalCount,
        cachedAt: now,
        expiresAt,
        hitCount: 0,
      })
      .onConflictDoUpdate({
        target: [liveProviderCacheTable.providerId, liveProviderCacheTable.queryFingerprint],
        set: {
          responseData,
          totalCount,
          cachedAt: now,
          expiresAt,
          hitCount: 0,
        },
      }),

    // Record the timestamp of the last successful upstream response
    db
      .update(liveProvidersTable)
      .set({ lastUpstreamCallAt: now })
      .where(eq(liveProvidersTable.id, providerId)),
  ]);
}

/**
 * Increment hit counters. Fire-and-forget so cache hits stay off the request path.
 */
export function recordCacheHit(id: number, providerId: number): void {
  void Promise.all([
    db
      .update(liveProviderCacheTable)
      .set({ hitCount: sql`${liveProviderCacheTable.hitCount} + 1` })
      .where(eq(liveProviderCacheTable.id, id)),
    db
      .update(liveProvidersTable)
      .set({ totalCacheHits: sql`${liveProvidersTable.totalCacheHits} + 1` })
      .where(eq(liveProvidersTable.id, providerId)),
  ]).catch(() => {});
}

/**
 * Aggregate cache statistics for a provider.
 *
 * - Historical totals come from provider lifetime counters (unaffected by
 *   cache-entry expiry or upsert cycles).
 * - activeCacheEntries counts only non-expired rows.
 * - lastUpstreamCall is read from the provider row (not the cache table)
 *   so it survives after all cache entries have expired or been replaced.
 */
export async function getProviderStats(providerId: number): Promise<{
  activeCacheEntries: number;
  cacheHits: number;
  cacheMisses: number;
  totalRequests: number;
  cacheHitRate: number;
  lastUpstreamCall: Date | null;
}> {
  const now = new Date();

  const [[providerRow], [cacheRow]] = await Promise.all([
    db
      .select({
        totalUpstreamCalls: liveProvidersTable.totalUpstreamCalls,
        totalCacheHits: liveProvidersTable.totalCacheHits,
        lastUpstreamCallAt: liveProvidersTable.lastUpstreamCallAt,
      })
      .from(liveProvidersTable)
      .where(eq(liveProvidersTable.id, providerId)),

    db
      .select({ entries: sql<number>`COUNT(*)` })
      .from(liveProviderCacheTable)
      .where(
        and(
          eq(liveProviderCacheTable.providerId, providerId),
          gt(liveProviderCacheTable.expiresAt, now)
        )
      ),
  ]);

  const upstreamCalls = Number(providerRow?.totalUpstreamCalls ?? 0);
  const cacheHits = Number(providerRow?.totalCacheHits ?? 0);
  const totalRequests = upstreamCalls + cacheHits;

  return {
    activeCacheEntries: Number(cacheRow?.entries ?? 0),
    cacheHits,
    cacheMisses: upstreamCalls,
    totalRequests,
    cacheHitRate:
      totalRequests > 0 ? Math.round((cacheHits / totalRequests) * 1000) / 1000 : 0,
    lastUpstreamCall: providerRow?.lastUpstreamCallAt ?? null,
  };
}
