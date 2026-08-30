/**
 * Periodic crawl watchdog (every 3 hours by default).
 *
 * Checks that Import Motor / Encar jobs are moving, that we only persist
 * provider JSON (never HTML pages), and that new photos are landing on
 * Cloudflare R2 (imgsv.getcarapi.com).
 */
import { db, pool, collectionJobsTable, providersTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { isPhotoMirrorEnabled, mirrorPhotos } from "./photo-mirror";

export const CRAWL_HEALTH_INTERVAL_MS = Math.max(
  60_000,
  Number(process.env.CRAWL_HEALTH_INTERVAL_MS || 4 * 60 * 60 * 1000) || 4 * 60 * 60 * 1000,
);

const IM_JOB_ID = Number(process.env.IM_JOB_ID || 360);
const ENCAR_JOB_ID = Number(process.env.ENCAR_JOB_ID || 362);
const RESUMABLE = ["failed", "cancelled", "paused"] as const;

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

export async function runCrawlHealthCheck(): Promise<CrawlHealthReport> {
  const intervalHours = Math.round(CRAWL_HEALTH_INTERVAL_MS / 36e5) || 3;
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

  const watchIds = [IM_JOB_ID, ENCAR_JOB_ID].filter((id) => Number.isFinite(id) && id > 0);

  const jobs = await db
    .select({
      id: collectionJobsTable.id,
      status: collectionJobsTable.status,
      jobType: collectionJobsTable.jobType,
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
      if (RESUMABLE.includes(job.status as (typeof RESUMABLE)[number])) {
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

/** Idempotent. First run after 2 minutes, then every 3 hours (configurable). */
export function startCrawlHealthMonitor(): void {
  if (running) return;
  running = true;
  const hours = CRAWL_HEALTH_INTERVAL_MS / 36e5;
  logger.info({ hours, imJobId: IM_JOB_ID, encarJobId: ENCAR_JOB_ID }, "Crawl health monitor started");
  schedule(120_000);
}

export function stopCrawlHealthMonitor(): void {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
