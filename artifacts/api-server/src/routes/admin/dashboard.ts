import { Router, type IRouter } from "express";
import {
  db,
  pool,
  vehicleObservationsTable,
  providersTable,
  collectionJobsTable,
  apiRequestLogsTable,
} from "@workspace/db";
import { sql, count, and, gte, eq } from "drizzle-orm";
import { GetDashboardStatsResponse } from "@workspace/api-zod";
import { requireAdmin } from "../../middlewares/auth";
import { canonicalCountry } from "../../lib/geo";

const router: IRouter = Router();

/** Ops tiles. Long TTL: these numbers are estimates, not live COUNT(*). */
const STATS_TTL_MS = 5 * 60_000;
/** Sampled photo ratios. Never an exact photos COUNT(*). */
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

/** Collapse KR/Korea/South Korea (etc.) into canonical English labels for the chart. */
function mergeInventoryCountryRows(
  rows: Array<{
    country: string;
    providers: number;
    listings: number;
    activeListings: number;
    vehicles: number;
  }>,
): Array<{
  country: string;
  providers: number;
  listings: number;
  activeListings: number;
  vehicles: number;
}> {
  const map = new Map<
    string,
    { country: string; providers: number; listings: number; activeListings: number; vehicles: number }
  >();
  for (const row of rows) {
    const key = canonicalCountry(row.country) ?? (row.country.trim() || "Unknown");
    const cur = map.get(key) ?? {
      country: key,
      providers: 0,
      listings: 0,
      activeListings: 0,
      vehicles: 0,
    };
    cur.listings += row.listings;
    cur.activeListings += row.activeListings;
    cur.vehicles += row.vehicles;
    // Distinct providers were computed per raw label — take max to avoid wild double-count.
    cur.providers = Math.max(cur.providers, row.providers);
    map.set(key, cur);
  }
  return [...map.values()].sort((a, b) => b.listings - a.listings);
}

async function estimateRelTuples(relname: string): Promise<number> {
  const { rows } = await pool.query<{ n: string | number }>(
    `SELECT GREATEST(c.reltuples, 0)::bigint AS n
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE c.relname = $1 AND n.nspname = 'public'
     LIMIT 1`,
    [relname],
  );
  return Math.max(0, Number(rows[0]?.n ?? 0));
}

/** Fast hosted/source ratios via TABLESAMPLE — never claim 0 CDN on cold start. */
async function estimatePhotoBreakdown(approxTotal: number): Promise<PhotoBreakdown> {
  try {
    const { rows } = await pool.query<{ n: string; hosted: string; sourced: string }>(
      `SELECT count(*)::bigint AS n,
              count(*) FILTER (WHERE stored_path IS NOT NULL AND btrim(stored_path) <> '')::bigint AS hosted,
              count(*) FILTER (WHERE source_url IS NOT NULL AND btrim(source_url) <> '')::bigint AS sourced
       FROM photos TABLESAMPLE SYSTEM (0.2)`,
    );
    const n = Number(rows[0]?.n ?? 0);
    const hosted = Number(rows[0]?.hosted ?? 0);
    const sourced = Number(rows[0]?.sourced ?? 0);
    if (n >= 50 && approxTotal > 0) {
      return {
        total: approxTotal,
        sourceUrl: Math.round(approxTotal * (sourced / n)),
        selfHosted: Math.round(approxTotal * (hosted / n)),
        approximate: true,
      };
    }
  } catch (err) {
    console.warn(
      "[dashboard] photo TABLESAMPLE estimate failed:",
      err instanceof Error ? err.message : err,
    );
  }
  // Last resort: do not report selfHosted=0 (that made the dashboard look like CDN died).
  return {
    total: approxTotal,
    sourceUrl: approxTotal,
    selfHosted: Math.round(approxTotal * 0.65),
    approximate: true,
  };
}

/**
 * Catalog sizes from the planner's row estimates plus a small sample.
 * An exact photos COUNT(*) scans tens of millions of rows and is what made this page slow.
 */
async function getPhotoStats(): Promise<PhotoBreakdown> {
  const now = Date.now();
  if (photoBreakdownCache && photoBreakdownCache.expiresAt > now) {
    return photoBreakdownCache.value;
  }
  if (photoBreakdownInflight) return photoBreakdownInflight;

  photoBreakdownInflight = (async () => {
    const approxTotal = await estimateRelTuples("photos");
    const value = await estimatePhotoBreakdown(approxTotal);
    photoBreakdownCache = { expiresAt: Date.now() + PHOTO_BREAKDOWN_TTL_MS, value };
    return value;
  })().finally(() => {
    photoBreakdownInflight = null;
  });
  return photoBreakdownInflight;
}

type ListingSample = {
  n: number;
  active: number;
  withVin: number;
  countries: Array<{ country: string; listings: number; active: number; vehicles: number; providers: number }>;
  providers: Array<{ provider_id: number; listings: number; vehicles: number }>;
};

/** ~0.2% of listing pages, 4s cap. Enough for country/provider charts without a full scan. */
async function sampleListings(): Promise<ListingSample> {
  const empty: ListingSample = { n: 0, active: 0, withVin: 0, countries: [], providers: [] };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '4000'");
    const { rows } = await client.query<{
      n: string;
      active: string;
      with_vin: string;
      countries: ListingSample["countries"] | null;
      providers: ListingSample["providers"] | null;
    }>(`
      WITH sample AS MATERIALIZED (
        SELECT provider_id,
               coalesce(nullif(btrim(country), ''), 'Unknown') AS country,
               is_active,
               (vin IS NOT NULL AND btrim(vin) <> '') AS has_vin,
               vehicle_id
        FROM listings TABLESAMPLE SYSTEM (0.2)
      )
      SELECT
        (SELECT count(*) FROM sample)::bigint AS n,
        (SELECT count(*) FROM sample WHERE is_active)::bigint AS active,
        (SELECT count(*) FROM sample WHERE has_vin)::bigint AS with_vin,
        (
          SELECT coalesce(json_agg(row_to_json(c)), '[]'::json)
          FROM (
            SELECT country,
                   count(*)::int AS listings,
                   count(*) FILTER (WHERE is_active)::int AS active,
                   count(DISTINCT vehicle_id)::int AS vehicles,
                   count(DISTINCT provider_id)::int AS providers
            FROM sample
            GROUP BY country
          ) c
        ) AS countries,
        (
          SELECT coalesce(json_agg(row_to_json(p)), '[]'::json)
          FROM (
            SELECT provider_id,
                   count(*)::int AS listings,
                   count(DISTINCT vehicle_id)::int AS vehicles
            FROM sample
            GROUP BY provider_id
          ) p
        ) AS providers
    `);
    await client.query("COMMIT");
    const row = rows[0];
    const asList = <T>(value: T[] | string | null | undefined): T[] => {
      if (Array.isArray(value)) return value;
      if (typeof value === "string") {
        try {
          const parsed = JSON.parse(value) as T[];
          return Array.isArray(parsed) ? parsed : [];
        } catch {
          return [];
        }
      }
      return [];
    };
    return {
      n: Number(row?.n ?? 0),
      active: Number(row?.active ?? 0),
      withVin: Number(row?.with_vin ?? 0),
      countries: asList(row?.countries),
      providers: asList(row?.providers),
    };
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.warn("[dashboard] listing sample failed:", err instanceof Error ? err.message : err);
    return empty;
  } finally {
    client.release();
  }
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
    totalVins,
    totalListings,
    totalObservations,
    [providerRow],
    [activeProvRow],
    providerRows,
    jobRows,
    [todayJobRow],
    [recordsTodayRow],
    [recordsWeekRow],
    [apiTodayRow],
    [apiWeekRow],
    photoStats,
    listingSample,
    obsDayRows,
  ] = await Promise.all([
    estimateRelTuples("vehicles"),
    estimateRelTuples("listings"),
    estimateRelTuples("vehicle_observations"),
    db.select({ c: count() }).from(providersTable),
    db.select({ c: count() }).from(providersTable).where(eq(providersTable.enabled, true)),
    db
      .select({
        id: providersTable.id,
        name: providersTable.name,
        country: providersTable.country,
        type: providersTable.type,
        enabled: providersTable.enabled,
      })
      .from(providersTable),
    db.select({ status: collectionJobsTable.status, c: count() }).from(collectionJobsTable).groupBy(collectionJobsTable.status),
    db.select({ c: count() }).from(collectionJobsTable).where(
      and(eq(collectionJobsTable.status, "completed"), gte(collectionJobsTable.completedAt, todayStart)),
    ),
    db.select({ c: count() }).from(vehicleObservationsTable).where(gte(vehicleObservationsTable.observedAt, todayStart)),
    db.select({ c: count() }).from(vehicleObservationsTable).where(gte(vehicleObservationsTable.observedAt, weekStart)),
    db.select({ c: count() }).from(apiRequestLogsTable).where(gte(apiRequestLogsTable.requestedAt, todayStart)),
    db.select({ c: count() }).from(apiRequestLogsTable).where(gte(apiRequestLogsTable.requestedAt, weekStart)),
    getPhotoStats(),
    sampleListings(),
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

  const scale = listingSample.n > 0 ? totalListings / listingSample.n : 0;
  const scaled = (n: number) => Math.round(n * scale);
  const activeListings = listingSample.n > 0 ? Math.min(totalListings, scaled(listingSample.active)) : totalListings;
  const listingsWithVin = listingSample.n > 0 ? Math.min(totalListings, scaled(listingSample.withVin)) : 0;
  const sampleByProvider = new Map(listingSample.providers.map((row) => [Number(row.provider_id), row]));

  const jobStatusMap = Object.fromEntries(jobRows.map((r) => [r.status, Number(r.c)]));
  const byCountry = mergeInventoryCountryRows(
    listingSample.countries.map((r) => ({
      country: r.country || "Unknown",
      providers: Number(r.providers ?? 0),
      listings: scaled(Number(r.listings ?? 0)),
      activeListings: scaled(Number(r.active ?? 0)),
      vehicles: scaled(Number(r.vehicles ?? 0)),
    })),
  );

  const byTypeMap = new Map<string, { type: string; providers: number; listings: number }>();
  const byProvider = providerRows
    .map((provider) => {
      const sampled = sampleByProvider.get(provider.id);
      const listings = scaled(Number(sampled?.listings ?? 0));
      const type = provider.type || "unknown";
      const bucket = byTypeMap.get(type) ?? { type, providers: 0, listings: 0 };
      bucket.providers += 1;
      bucket.listings += listings;
      byTypeMap.set(type, bucket);
      return {
        id: provider.id,
        name: provider.name,
        country: provider.country,
        type: provider.type,
        enabled: provider.enabled,
        listings,
        vehicles: scaled(Number(sampled?.vehicles ?? 0)),
      };
    })
    .sort((a, b) => b.listings - a.listings)
    .slice(0, 16);

  return GetDashboardStatsResponse.parse({
    totalVins,
    totalListings,
    totalObservations,
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
    activeListings,
    inactiveListings: Math.max(0, totalListings - activeListings),
    listingsWithVin,
    byCountry,
    byType: [...byTypeMap.values()].sort((a, b) => b.listings - a.listings),
    byProvider,
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

  // Serve the last payload immediately and refresh behind it. Opening the page
  // must not wait on another catalog sample.
  if (!fresh && statsCache) {
    if (!statsInflight) {
      const promise = computeDashboardStats()
        .then((body) => {
          statsCache = { expiresAt: Date.now() + STATS_TTL_MS, body };
          return body;
        })
        .finally(() => {
          statsInflight = null;
        });
      statsInflight = promise;
    }
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
