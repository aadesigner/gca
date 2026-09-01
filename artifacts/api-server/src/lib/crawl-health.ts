/**
 * Periodic crawl watchdog (every 4 hours by default).
 *
 * Checks that all active marketplace crawls are moving, that we only persist
 * provider JSON (never HTML pages), and that new photos are landing on
 * Cloudflare R2 (imgsv.getcarapi.com).
 */
import { db, pool, collectionJobsTable, providersTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { isPhotoMirrorEnabled, mirrorPhotos } from "./photo-mirror";
import { mergeCrawlDefaults } from "./crawl-profiles";
import { ensureProductionFleetSchedule } from "./fleet-schedule";

export const CRAWL_HEALTH_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.CRAWL_HEALTH_INTERVAL_MS || 4 * 60 * 60 * 1000) || 4 * 60 * 60 * 1000,
);

const IM_JOB_ID = Number(process.env.IM_JOB_ID || 360);
const ENCAR_JOB_ID = Number(process.env.ENCAR_JOB_ID || 362);
const ENCAR_REFRESH_JOB_ID = Number(process.env.ENCAR_REFRESH_JOB_ID || 361);
const RESUMABLE = ["failed", "cancelled", "paused"] as const;

const SKIP_WATCH_PROVIDERS = new Set([
  "getcarapi",
  "kmcheck",
  "kmcheck_manual",
  "carstat",
  "bidcars",
  "carsandbids",
]);

/** Production Import Motor: incremental Korean refresh every 4h — not full multi-country crawl. */
const IM_INCREMENTAL_FILTER: Record<string, unknown> = {
  origins: ["korean"],
  skipRecentHours: 4,
  maxPages: 8,
  maxListings: 400,
  concurrency: 8,
  delayMs: 80,
  repeatHours: 4,
};

export type CrawlHealthReport = {
  t: string;
  ok: boolean;
  intervalHours: number;
  jobs: Array<{
    id: number;
    provider: string;
    jobType: string;
    status: string;
    pages: number | null;
    listings: number | null;
    vins: number | null;
    action?: string;
    error?: string | null;
  }>;
  json: {
    recent: number;
    jsonOk: number;
    htmlDocuments: number;
    htmlColumnPresent: boolean;
  };
  photos: {
    created: number;
    mirroredCdn: number;
    pending: number;
    r2Enabled: boolean;
    kicked: boolean;
  };
  actions: string[];
  errors: string[];
  fleet?: { cappedParallel: number; touched: number };
};

let lastReport: CrawlHealthReport | null = null;
let lastJobProgress = new Map<number, { listings: number; pages: number }>();
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;

export function getLastCrawlHealthReport(): CrawlHealthReport | null {
  return lastReport;
}

function fail(report: CrawlHealthReport, msg: string): void {
  report.ok = false;
  report.errors.push(msg);
}

async function inspectJsonIngest(hours: number): Promise<CrawlHealthReport["json"]> {
  const htmlCol = await pool.query(`
    SELECT 1 AS ok
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'raw_source_records'
      AND column_name = 'raw_html'
    LIMIT 1
  `);

  const { rows } = await pool.query(
    `
    SELECT
      count(*)::int AS recent,
      count(*) FILTER (
        WHERE raw_json IS NOT NULL
          AND btrim(raw_json) <> ''
          AND raw_json <> 'null'
          AND left(ltrim(raw_json), 1) IN ('{', '[')
      )::int AS json_ok,
      count(*) FILTER (
        WHERE raw_json IS NOT NULL
          AND btrim(raw_json) <> ''
          AND left(ltrim(raw_json), 1) NOT IN ('{', '[')
      )::int AS html_documents
    FROM raw_source_records
    WHERE created_at > now() - ($1::int * interval '1 hour')
    `,
    [hours],
  );
  const row = rows[0] ?? {};
  return {
    recent: Number(row.recent ?? 0),
    jsonOk: Number(row.json_ok ?? 0),
    htmlDocuments: Number(row.html_documents ?? 0),
    htmlColumnPresent: htmlCol.rows.length > 0,
  };
}

async function inspectPhotos(
  hours: number,
): Promise<Omit<CrawlHealthReport["photos"], "kicked" | "r2Enabled">> {
  const { rows } = await pool.query(
    `
    SELECT
      count(*)::int AS created,
      count(*) FILTER (
        WHERE stored_path IS NOT NULL
          AND stored_path ~* 'imgsv\\.getcarapi\\.com|\\.r2\\.dev/'
      )::int AS mirrored_cdn,
      count(*) FILTER (WHERE stored_path IS NULL)::int AS pending
    FROM photos
    WHERE created_at > now() - ($1::int * interval '1 hour')
    `,
    [hours],
  );
  const row = rows[0] ?? {};
  return {
    created: Number(row.created ?? 0),
    mirroredCdn: Number(row.mirrored_cdn ?? 0),
    pending: Number(row.pending ?? 0),
  };
}

async function ensureImportMotorIncrementalMode(job: {
  id: number;
  status: string;
  jobType: string;
  jobConfig: string | null;
}): Promise<string | undefined> {
  let cfg: Record<string, unknown> = {};
  try {
    cfg = job.jobConfig ? (JSON.parse(job.jobConfig) as Record<string, unknown>) : {};
  } catch {
    cfg = {};
  }
  const isFullCrawl =
    job.jobType === "full_collection" ||
    cfg.fullCrawl === true ||
    (Array.isArray(cfg.fullCrawlCountries) && cfg.fullCrawlCountries.length > 0);
  if (!isFullCrawl) return undefined;

  if (job.status === "running") {
    await db
      .update(collectionJobsTable)
      .set({ status: "paused" })
      .where(and(eq(collectionJobsTable.id, job.id), eq(collectionJobsTable.status, "running")));
  }

  const nextConfig = mergeCrawlDefaults("import_motor", IM_INCREMENTAL_FILTER, "incremental");
  await db
    .update(collectionJobsTable)
    .set({
      jobType: "incremental",
      jobConfig: JSON.stringify(nextConfig),
      crawlState: null,
      status: "pending",
      completedAt: null,
      errorMessage: null,
      pagesProcessed: 0,
      itemsDiscovered: 0,
      itemsProcessed: 0,
      itemsFailed: 0,
      listingsFetched: 0,
      vinsFound: 0,
      vinsNew: 0,
      newObservations: 0,
      duplicatesSkipped: 0,
    })
    .where(eq(collectionJobsTable.id, job.id));

  return `im_incremental:${job.id}`;
}

async function resumeJob(id: number, reason: string): Promise<string> {
  await db
    .update(collectionJobsTable)
    .set({
      status: "pending",
      completedAt: null,
      errorMessage: null,
    })
    .where(and(eq(collectionJobsTable.id, id), inArray(collectionJobsTable.status, [...RESUMABLE])));
  return `resumed:${id}:${reason}`;
}

/** Jobs to watch: all running/pending + latest resumable per worked provider + pinned fleet. */
async function watchedJobIds(): Promise<number[]> {
  const pinned = [IM_JOB_ID, ENCAR_JOB_ID, ENCAR_REFRESH_JOB_ID].filter((id) => Number.isFinite(id) && id > 0);
  const { rows: activeRows } = await pool.query<{ id: number }>(
    `SELECT id FROM collection_jobs WHERE status IN ('running', 'pending')`,
  );
  const { rows: staleRows } = await pool.query<{ id: number }>(
    `
    SELECT id FROM (
      SELECT DISTINCT ON (cj.provider_id) cj.id
      FROM collection_jobs cj
      JOIN providers p ON p.id = cj.provider_id
      WHERE cj.status IN ('failed', 'paused', 'cancelled')
        AND cj.provider_id IN (
          SELECT DISTINCT provider_id FROM collection_jobs WHERE items_processed > 0
        )
        AND p.internal_name <> ALL($1::text[])
      ORDER BY cj.provider_id, cj.updated_at DESC
    ) sub
    `,
    [[...SKIP_WATCH_PROVIDERS]],
  );
  const ids = new Set<number>([
    ...pinned,
    ...activeRows.map((r) => Number(r.id)),
    ...staleRows.map((r) => Number(r.id)),
  ]);
  return [...ids].filter((id) => Number.isFinite(id) && id > 0);
}

export async function runCrawlHealthCheck(): Promise<CrawlHealthReport> {
  const intervalHours = Math.round(CRAWL_HEALTH_INTERVAL_MS / 36e5) || 4;
  const report: CrawlHealthReport = {
    t: new Date().toISOString(),
    ok: true,
    intervalHours,
    jobs: [],
    json: { recent: 0, jsonOk: 0, htmlDocuments: 0, htmlColumnPresent: false },
    photos: { created: 0, mirroredCdn: 0, pending: 0, r2Enabled: isPhotoMirrorEnabled(), kicked: false },
    actions: [],
    errors: [],
  };

  const watchIds = await watchedJobIds();

  try {
    const fleet = await ensureProductionFleetSchedule();
    report.fleet = { cappedParallel: fleet.cappedParallel, touched: fleet.touched.length };
    for (const t of fleet.touched) {
      report.actions.push(`fleet:${t.provider}:${t.action}:${t.jobId}`);
    }
  } catch (err) {
    fail(report, `fleet schedule: ${err instanceof Error ? err.message : String(err)}`);
  }

  const jobs = await db
    .select({
      id: collectionJobsTable.id,
      status: collectionJobsTable.status,
      jobType: collectionJobsTable.jobType,
      jobConfig: collectionJobsTable.jobConfig,
      pagesProcessed: collectionJobsTable.pagesProcessed,
      listingsFetched: collectionJobsTable.listingsFetched,
      vinsFound: collectionJobsTable.vinsFound,
      itemsProcessed: collectionJobsTable.itemsProcessed,
      errorMessage: collectionJobsTable.errorMessage,
      internalName: providersTable.internalName,
    })
    .from(collectionJobsTable)
    .innerJoin(providersTable, eq(collectionJobsTable.providerId, providersTable.id))
    .where(inArray(collectionJobsTable.id, watchIds));

  for (const job of jobs) {
    const listings = Number(job.listingsFetched ?? job.itemsProcessed ?? 0);
    const pages = Number(job.pagesProcessed ?? 0);
    const prev = lastJobProgress.get(job.id);
    const stalled =
      job.status === "running" &&
      prev != null &&
      prev.listings === listings &&
      prev.pages === pages;

    let action: string | undefined;
    try {
      if (job.internalName === "import_motor") {
        const converted = await ensureImportMotorIncrementalMode(job);
        if (converted) {
          report.actions.push(converted);
          action = converted;
        }
      }
      if (!action && RESUMABLE.includes(job.status as (typeof RESUMABLE)[number])) {
        action = await resumeJob(job.id, job.status);
        report.actions.push(action);
      } else if (stalled) {
        await db
          .update(collectionJobsTable)
          .set({ status: "paused" })
          .where(and(eq(collectionJobsTable.id, job.id), eq(collectionJobsTable.status, "running")));
        action = await resumeJob(job.id, "stalled");
        report.actions.push(action);
      }
    } catch (err) {
      fail(report, `job ${job.id}: ${err instanceof Error ? err.message : String(err)}`);
    }

    lastJobProgress.set(job.id, { listings, pages });
    report.jobs.push({
      id: job.id,
      provider: job.internalName,
      jobType: job.jobType,
      status: action ? "pending" : job.status,
      pages,
      listings,
      vins: Number(job.vinsFound ?? 0),
      action,
      error: job.errorMessage,
    });
    if (job.internalName === "import_motor" && (action || job.status !== "running")) {
      try {
        if (process.env.IMPORT_MOTOR_CDP_URL) {
          const { healImportMotorCdpPool } = await import("./providers/import-motor-cdp");
          const heal = await healImportMotorCdpPool();
          report.actions.push(`cdp_heal pool=${heal.poolSize}/chrome=${heal.chromePages}`);
        }
      } catch (err) {
        fail(report, `cdp: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  for (const id of watchIds) {
    if (!report.jobs.some((j) => j.id === id)) {
      fail(report, `watched job ${id} not found`);
    }
  }

  try {
    report.json = await inspectJsonIngest(intervalHours);
    if (report.json.htmlColumnPresent) {
      fail(report, "raw_html column still present — HTML must not be stored");
    }
    if (report.json.htmlDocuments > 0) {
      fail(report, `${report.json.htmlDocuments} raw rows in the last ${intervalHours}h are not JSON`);
    }
  } catch (err) {
    fail(report, `json ingest: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const photoStats = await inspectPhotos(intervalHours);
    report.photos = { ...photoStats, r2Enabled: isPhotoMirrorEnabled(), kicked: false };
    if (report.photos.r2Enabled && report.photos.pending > 0) {
      const kicked = await mirrorPhotos({ limit: 80, concurrency: 6, primariesFirst: true });
      report.photos.kicked = kicked.attempted > 0;
      if (kicked.attempted > 0) {
        report.actions.push(
          `mirror_batch attempted=${kicked.attempted} uploaded=${kicked.uploaded} failed=${kicked.failed}`,
        );
      }
    }
    if (
      report.photos.r2Enabled &&
      report.photos.created >= 20 &&
      report.photos.mirroredCdn === 0
    ) {
      fail(report, `Cloudflare photo upload stalled (${report.photos.created} new photos, 0 CDN)`);
    }
  } catch (err) {
    fail(report, `photos: ${err instanceof Error ? err.message : String(err)}`);
  }

  lastReport = report;
  if (report.ok) {
    logger.info(report, "Crawl health check ok");
  } else {
    logger.warn(report, "Crawl health check found problems");
  }
  return report;
}

function schedule(delayMs: number): void {
  if (!running) return;
  timer = setTimeout(() => {
    void runCrawlHealthCheck()
      .catch((err) => {
        logger.warn({ err }, "Crawl health check crashed");
      })
      .finally(() => schedule(CRAWL_HEALTH_INTERVAL_MS));
  }, delayMs);
}

/** Idempotent. First run after 2 minutes, then every 4 hours (configurable). */
export function startCrawlHealthMonitor(): void {
  if (running) return;
  running = true;
  const hours = CRAWL_HEALTH_INTERVAL_MS / 36e5;
  logger.info(
    { hours, imJobId: IM_JOB_ID, encarJobId: ENCAR_JOB_ID, encarRefreshJobId: ENCAR_REFRESH_JOB_ID },
    "Crawl health monitor started",
  );
  void ensureProductionFleetSchedule().catch((err) => {
    logger.warn({ err }, "Initial fleet schedule failed");
  });
  schedule(120_000);
}

export function stopCrawlHealthMonitor(): void {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
