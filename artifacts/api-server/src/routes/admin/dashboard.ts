import { Router, type IRouter } from "express";
import {
  db,
  pool,
  vehiclesTable,
  listingsTable,
  vehicleObservationsTable,
  providersTable,
  collectionJobsTable,
  apiRequestLogsTable,
  photosTable,
} from "@workspace/db";
import { sql, count, and, gte, eq } from "drizzle-orm";
import { GetDashboardStatsResponse } from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/auth";

const router: IRouter = Router();

/** Full dashboard payload — short TTL is fine for ops tiles. */
const STATS_TTL_MS = 45_000;
/** Exact photo FILTER counts are expensive; refresh rarely. */
const PHOTO_BREAKDOWN_TTL_MS = 10 * 60_000;

type DashboardStatsBody = ReturnType<typeof GetDashboardStatsResponse.parse>;

type PhotoBreakdown = {
  total: number;
  sourceUrl: number;
  selfHosted: number;
  /** true when totals come from pg_class.reltuples / stale ratios */
  approximate: boolean;
};

let statsCache: { expiresAt: number; body: DashboardStatsBody } | null = null;
let statsInflight: Promise<DashboardStatsBody> | null = null;

let photoBreakdownCache: { expiresAt: number; value: PhotoBreakdown } | null = null;
let photoBreakdownInflight: Promise<PhotoBreakdown> | null = null;

function fillDays(rows: Array<{ day: string; count: number }>, days: number): Array<{ date: string; count: number }> {
  const map = new Map(rows.map((r) => [r.day, Number(r.count)]));
  const out: Array<{ date: string; count: number }> = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    out.push({ date: key, count: map.get(key) ?? 0 });
  }
  return out;
}

async function estimatePhotoRelTuples(): Promise<number> {
  const { rows } = await pool.query<{ n: string | number }>(
    `SELECT GREATEST(c.reltuples, 0)::bigint AS n
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = 'photos' AND n.nspname = 'public'
     LIMIT 1`,
  );
  return Math.max(0, Number(rows[0]?.n ?? 0));
}

async function loadExactPhotoBreakdown(): Promise<PhotoBreakdown> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      sourceUrl: sql<number>`count(*) FILTER (WHERE ${photosTable.sourceUrl} IS NOT NULL AND ${photosTable.sourceUrl} <> '')::int`,
      selfHosted: sql<number>`count(*) FILTER (WHERE ${photosTable.storedPath} IS NOT NULL AND ${photosTable.storedPath} <> '')::int`,
    })
    .from(photosTable);

  return {
    total: Number(row?.total ?? 0),
    sourceUrl: Number(row?.sourceUrl ?? 0),
    selfHosted: Number(row?.selfHosted ?? 0),
    approximate: false,
  };
}

function schedulePhotoBreakdownRefresh(): void {
  if (photoBreakdownInflight) return;
  photoBreakdownInflight = loadExactPhotoBreakdown()
    .then((value) => {
      photoBreakdownCache = { expiresAt: Date.now() + PHOTO_BREAKDOWN_TTL_MS, value };
      return value;
    })
    .catch((err) => {
      console.warn("[dashboard] photo breakdown refresh failed:", err instanceof Error ? err.message : err);
      return (
        photoBreakdownCache?.value ?? {
          total: 0,
          sourceUrl: 0,
          selfHosted: 0,
          approximate: true,
        }
      );
    })
    .finally(() => {
      photoBreakdownInflight = null;
    });
}

/**
 * Never block the dashboard on an exact photos COUNT(*).
 * Prefer a fresh exact breakdown (≤10m); otherwise reltuples + last ratios.
 */
async function getPhotoStats(): Promise<PhotoBreakdown> {
  const now = Date.now();
  if (photoBreakdownCache && photoBreakdownCache.expiresAt > now) {
    return photoBreakdownCache.value;
  }

  if (photoBreakdownCache) {
    // Stale exact numbers are still useful — refresh in background.
    schedulePhotoBreakdownRefresh();
    return { ...photoBreakdownCache.value, approximate: true };
  }

  const approxTotal = await estimatePhotoRelTuples();
  schedulePhotoBreakdownRefresh();
  return {
    total: approxTotal,
    // Until the first exact pass finishes, treat source URLs ≈ all rows (typical for crawl ingest).
    sourceUrl: approxTotal,
    selfHosted: 0,
    approximate: true,
  };
}

async function computeDashboardStats(): Promise<DashboardStatsBody> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - 7);
  const fourteenStart = new Date(now);
  fourteenStart.setDate(fourteenStart.getDate() - 13);
  fourteenStart.setHours(0, 0, 0, 0);

  const [
    [vinRow],
    [listingAgg],
    [obsRow],
    [providerRow],
    [activeProvRow],
    jobRows,
    [todayJobRow],
    [recordsTodayRow],
    [recordsWeekRow],
    [apiTodayRow],
    [apiWeekRow],
    photoStats,
    byCountryRows,
    byTypeRows,
    byProviderRows,
    obsDayRows,
  ] = await Promise.all([
    db.select({ c: count() }).from(vehiclesTable),
    // One listings scan: total + flags (avoids a second full COUNT).
    db
      .select({
        total: sql<number>`count(*)::int`,
        active: sql<number>`count(*) FILTER (WHERE ${listingsTable.isActive} = true)::int`,
        inactive: sql<number>`count(*) FILTER (WHERE ${listingsTable.isActive} = false)::int`,
        withVin: sql<number>`count(*) FILTER (WHERE ${listingsTable.vin} IS NOT NULL AND ${listingsTable.vin} <> '')::int`,
      })
      .from(listingsTable),
    db.select({ c: count() }).from(vehicleObservationsTable),
    db.select({ c: count() }).from(providersTable),
    db.select({ c: count() }).from(providersTable).where(eq(providersTable.enabled, true)),
    db.select({ status: collectionJobsTable.status, c: count() }).from(collectionJobsTable).groupBy(collectionJobsTable.status),
    db.select({ c: count() }).from(collectionJobsTable).where(
      and(eq(collectionJobsTable.status, "completed"), gte(collectionJobsTable.completedAt, todayStart)),
    ),
    db.select({ c: count() }).from(vehicleObservationsTable).where(gte(vehicleObservationsTable.observedAt, todayStart)),
    db.select({ c: count() }).from(vehicleObservationsTable).where(gte(vehicleObservationsTable.observedAt, weekStart)),
    db.select({ c: count() }).from(apiRequestLogsTable).where(gte(apiRequestLogsTable.requestedAt, todayStart)),
    db.select({ c: count() }).from(apiRequestLogsTable).where(gte(apiRequestLogsTable.requestedAt, weekStart)),
    getPhotoStats(),
    db
      .select({
        country: providersTable.country,
        providers: sql<number>`count(distinct ${providersTable.id})::int`,
        listings: sql<number>`count(${listingsTable.id})::int`,
        activeListings: sql<number>`count(${listingsTable.id}) FILTER (WHERE ${listingsTable.isActive} = true)::int`,
        vehicles: sql<number>`count(distinct ${listingsTable.vehicleId})::int`,
      })
      .from(providersTable)
      .leftJoin(listingsTable, eq(listingsTable.providerId, providersTable.id))
      .groupBy(providersTable.country)
      .orderBy(sql`count(${listingsTable.id}) DESC`),
    db
      .select({
        type: providersTable.type,
        providers: sql<number>`count(distinct ${providersTable.id})::int`,
        listings: sql<number>`count(${listingsTable.id})::int`,
      })
      .from(providersTable)
      .leftJoin(listingsTable, eq(listingsTable.providerId, providersTable.id))
      .groupBy(providersTable.type)
      .orderBy(sql`count(${listingsTable.id}) DESC`),
    db
      .select({
        id: providersTable.id,
        name: providersTable.name,
        country: providersTable.country,
        type: providersTable.type,
        enabled: providersTable.enabled,
        listings: sql<number>`count(${listingsTable.id})::int`,
        vehicles: sql<number>`count(distinct ${listingsTable.vehicleId})::int`,
      })
      .from(providersTable)
      .leftJoin(listingsTable, eq(listingsTable.providerId, providersTable.id))
      .groupBy(providersTable.id, providersTable.name, providersTable.country, providersTable.type, providersTable.enabled)
      .orderBy(sql`count(${listingsTable.id}) DESC`)
      .limit(16),
    db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${vehicleObservationsTable.observedAt}), 'YYYY-MM-DD')`,
        count: sql<number>`count(*)::int`,
      })
      .from(vehicleObservationsTable)
      .where(gte(vehicleObservationsTable.observedAt, fourteenStart))
      .groupBy(sql`date_trunc('day', ${vehicleObservationsTable.observedAt})`)
      .orderBy(sql`date_trunc('day', ${vehicleObservationsTable.observedAt})`),
  ]);

  const jobStatusMap = Object.fromEntries(jobRows.map((r) => [r.status, Number(r.c)]));
  const byCountry = byCountryRows.map((r) => ({
    country: r.country || "Unknown",
    providers: Number(r.providers ?? 0),
    listings: Number(r.listings ?? 0),
    activeListings: Number(r.activeListings ?? 0),
    vehicles: Number(r.vehicles ?? 0),
  }));

  return GetDashboardStatsResponse.parse({
    totalVins: Number(vinRow?.c ?? 0),
    totalListings: Number(listingAgg?.total ?? 0),
    totalObservations: Number(obsRow?.c ?? 0),
    totalProviders: Number(providerRow?.c ?? 0),
    activeProviders: Number(activeProvRow?.c ?? 0),
    pendingJobs: jobStatusMap["pending"] ?? 0,
    activeJobs: jobStatusMap["running"] ?? 0,
    failedJobs: jobStatusMap["failed"] ?? 0,
    completedJobsToday: Number(todayJobRow?.c ?? 0),
    recordsToday: Number(recordsTodayRow?.c ?? 0),
    recordsThisWeek: Number(recordsWeekRow?.c ?? 0),
    apiRequestsToday: Number(apiTodayRow?.c ?? 0),
    apiRequestsThisWeek: Number(apiWeekRow?.c ?? 0),
    countriesCount: byCountry.length,
    photosCount: photoStats.total,
    photosSourceUrlCount: photoStats.sourceUrl,
    photosSelfHostedCount: photoStats.selfHosted,
    activeListings: Number(listingAgg?.active ?? 0),
    inactiveListings: Number(listingAgg?.inactive ?? 0),
    listingsWithVin: Number(listingAgg?.withVin ?? 0),
    byCountry,
    byType: byTypeRows.map((r) => ({
      type: r.type || "unknown",
      providers: Number(r.providers ?? 0),
      listings: Number(r.listings ?? 0),
    })),
    byProvider: byProviderRows.map((r) => ({
      id: r.id,
      name: r.name,
      country: r.country,
      type: r.type,
      enabled: r.enabled,
      listings: Number(r.listings ?? 0),
      vehicles: Number(r.vehicles ?? 0),
    })),
    observationsByDay: fillDays(
      obsDayRows.map((r) => ({ day: r.day, count: Number(r.count ?? 0) })),
      14,
    ),
  });
}

async function getDashboardStats(fresh: boolean): Promise<{ body: DashboardStatsBody; cache: "HIT" | "MISS" | "BYPASS" }> {
  const now = Date.now();
  if (!fresh && statsCache && statsCache.expiresAt > now) {
    return { body: statsCache.body, cache: "HIT" };
  }

  if (!fresh && statsInflight) {
    const body = await statsInflight;
    return { body, cache: "HIT" };
  }

  const promise = computeDashboardStats().then((body) => {
    statsCache = { expiresAt: Date.now() + STATS_TTL_MS, body };
    return body;
  });

  if (!fresh) {
    statsInflight = promise;
    try {
      const body = await promise;
      return { body, cache: "MISS" };
    } finally {
      if (statsInflight === promise) statsInflight = null;
    }
  }

  const body = await promise;
  return { body, cache: "BYPASS" };
}

// GET /api/admin/dashboard/stats
// Optional ?fresh=1 bypasses the short TTL (still avoids blocking on photo COUNT).
router.get("/admin/dashboard/stats", requireAdmin, async (req, res): Promise<void> => {
  const fresh = req.query.fresh === "1" || req.query.fresh === "true";
  try {
    const { body, cache } = await getDashboardStats(fresh);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Dashboard-Cache", cache);
    res.json(body);
  } catch (err) {
    console.error("[dashboard] stats failed:", err);
    res.status(500).json({ error: "Failed to load dashboard stats" });
  }
});

export default router;
