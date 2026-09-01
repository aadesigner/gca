/**
 * Keeps every worked marketplace provider on a staggered ~12h crawl (11/12/13h).
 * Idempotent — safe to run from crawl-health every cycle.
 */
import { db, pool, collectionJobsTable, providersTable, settingsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { HISTORICAL_ADAPTER_NAMES } from "./crawl-profiles";
import {
  FLEET_SKIP_PROVIDERS,
  FLEET_PRIORITY_PROVIDERS,
  fleetJobConfig,
  fleetJobType,
  fleetRepeatHours,
  fleetStaggerMinutes,
  initialStaggeredRunAt,
  isFutureRun,
  parseJobConfig,
} from "./crawl-schedule";
import { logger } from "./logger";

const IM_JOB_ID = Number(process.env.IM_JOB_ID || 360);
const ENCAR_JOB_ID = Number(process.env.ENCAR_JOB_ID || 362);
const ENCAR_REFRESH_JOB_ID = Number(process.env.ENCAR_REFRESH_JOB_ID || 361);

const RAILWAY_SAFE_PARALLEL = Math.max(
  2,
  Number(process.env.COLLECTION_JOBS_PARALLEL || process.env.RAILWAY_SAFE_PARALLEL || 6) || 6,
);

const ACTIVE = ["pending", "running"] as const;
const NEEDS_SCHEDULE = ["completed", "failed", "paused", "cancelled"] as const;

export type FleetScheduleReport = {
  cappedParallel: number;
  touched: Array<{ jobId: number; provider: string; action: string }>;
};

/** Production/Railway only — local dev keeps seeded jobs paused. */
export function isFleetAutoStartEnabled(): boolean {
  if (process.env.FLEET_AUTO_START === "0") return false;
  if (process.env.FLEET_AUTO_START === "1") return true;
  return process.env.NODE_ENV === "production" || Boolean(process.env.RAILWAY_ENVIRONMENT);
}

async function capParallelJobs(): Promise<number> {
  const [row] = await db
    .select({ max: settingsTable.maxCollectionJobsParallel })
    .from(settingsTable)
    .where(eq(settingsTable.id, 1));
  const current = Number(row?.max ?? RAILWAY_SAFE_PARALLEL);
  if (current > RAILWAY_SAFE_PARALLEL) {
    await db
      .update(settingsTable)
      .set({ maxCollectionJobsParallel: RAILWAY_SAFE_PARALLEL })
      .where(eq(settingsTable.id, 1));
    return RAILWAY_SAFE_PARALLEL;
  }
  return current;
}

/** Cap crawl parallelism so admin/auth keep DB headroom (Railway-safe). */
export async function capCollectionJobParallel(): Promise<number> {
  return capParallelJobs();
}

function encarRefreshConfig(): Record<string, unknown> {
  return fleetJobConfig("encar", "listing_refresh", {
    repeatHours: 11,
    skipRecentHours: 0,
    concurrency: 8,
    delayMs: 200,
  });
}

function encarFullConfig(): Record<string, unknown> {
  return fleetJobConfig("encar", "full_collection", {
    repeatHours: 12,
    skipRecentHours: 0,
    detailLevel: "full",
    concurrency: 8,
    delayMs: 250,
  });
}

async function touchJob(
  jobId: number,
  provider: string,
  jobType: string,
  internalName: string,
  patch: Record<string, unknown>,
  action: string,
  report: FleetScheduleReport,
): Promise<void> {
  const cfg = fleetJobConfig(internalName, jobType, patch);
  const nextRunAt = initialStaggeredRunAt(internalName, jobType);
  await db
    .update(collectionJobsTable)
    .set({
      status: "pending",
      jobType,
      jobConfig: JSON.stringify({ ...cfg, nextRunAt }),
      completedAt: null,
      errorMessage: null,
    })
    .where(eq(collectionJobsTable.id, jobId));
  report.touched.push({ jobId, provider, action });
}

async function ensurePinnedJob(
  jobId: number,
  internalName: string,
  jobType: string,
  config: Record<string, unknown>,
  report: FleetScheduleReport,
): Promise<void> {
  const [job] = await db
    .select({
      id: collectionJobsTable.id,
      status: collectionJobsTable.status,
      jobType: collectionJobsTable.jobType,
      jobConfig: collectionJobsTable.jobConfig,
    })
    .from(collectionJobsTable)
    .where(eq(collectionJobsTable.id, jobId))
    .limit(1);
  if (!job) {
    report.touched.push({ jobId, provider: internalName, action: "missing_pinned" });
    return;
  }
  if (job.status === "running") return;

  const cfg = parseJobConfig(job.jobConfig);
  const wantRepeat = Number(config.repeatHours ?? fleetRepeatHours(internalName));
  const haveRepeat = Number(cfg.repeatHours ?? 0);
  const needsType = job.jobType !== jobType;
  const needsRepeat = haveRepeat !== wantRepeat;
  const needsSchedule =
    NEEDS_SCHEDULE.includes(job.status as (typeof NEEDS_SCHEDULE)[number]) && !isFutureRun(cfg);

  if (job.status === "pending" && isFutureRun(cfg) && !needsType && !needsRepeat) return;

  if (needsType || needsRepeat || needsSchedule) {
    const merged = { ...fleetJobConfig(internalName, jobType, config), ...cfg, ...config };
    merged.repeatHours = wantRepeat;
    merged.staggerMinutes = fleetStaggerMinutes(internalName, jobType);
    if (needsSchedule || job.status !== "pending" || !isFutureRun(merged)) {
      merged.nextRunAt = initialStaggeredRunAt(internalName, jobType);
    }
    await db
      .update(collectionJobsTable)
      .set({
        status: "pending",
        jobType,
        jobConfig: JSON.stringify(merged),
        completedAt: null,
        errorMessage: null,
      })
      .where(eq(collectionJobsTable.id, jobId));
    report.touched.push({
      jobId,
      provider: internalName,
      action: needsSchedule ? "scheduled_pinned" : "patched_pinned",
    });
  }
}

async function cancelExtraActive(providerId: number, keepIds: number[]): Promise<void> {
  if (keepIds.length === 0) return;
  await pool.query(
    `
    UPDATE collection_jobs
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, NOW()),
        error_message = COALESCE(error_message, 'superseded by fleet schedule')
    WHERE provider_id = $1
      AND status IN ('pending', 'running')
      AND NOT (id = ANY($2::int[]))
    `,
    [providerId, keepIds],
  );
}

async function ensureProviderJob(
  providerId: number,
  internalName: string,
  report: FleetScheduleReport,
): Promise<void> {
  if (internalName === "encar" || internalName === "import_motor") return;

  const jobType = fleetJobType(internalName);
  const { rows } = await pool.query<{
    id: number;
    status: string;
    job_type: string;
    job_config: string | null;
    items_processed: number;
  }>(
    `
    SELECT id, status, job_type, job_config, items_processed
    FROM collection_jobs
    WHERE provider_id = $1
    ORDER BY items_processed DESC NULLS LAST, updated_at DESC
    LIMIT 5
    `,
    [providerId],
  );

  const active = rows.filter((r) => ACTIVE.includes(r.status as (typeof ACTIVE)[number]));
  if (active.length > 0) {
    const keepId = active[0]!.id;
    await cancelExtraActive(providerId, [keepId]);
    const cfg = parseJobConfig(active[0]!.job_config);
    const wantRepeat = fleetRepeatHours(internalName);
    const jobType = active[0]!.job_type;
    let merged = { ...fleetJobConfig(internalName, jobType, cfg), ...cfg };
    let patch = false;
    if (Number(merged.repeatHours ?? 0) !== wantRepeat) {
      merged.repeatHours = wantRepeat;
      patch = true;
    }
    if (active[0]!.status === "pending" && !isFutureRun(merged)) {
      merged.nextRunAt = initialStaggeredRunAt(internalName, jobType);
      patch = true;
    }
    if (patch) {
      await db
        .update(collectionJobsTable)
        .set({ jobConfig: JSON.stringify(merged) })
        .where(eq(collectionJobsTable.id, keepId));
      report.touched.push({ jobId: keepId, provider: internalName, action: "staggered" });
    }
    return;
  }

  const candidate = rows.find((r) => r.items_processed > 0) ?? rows[0];
  if (!candidate) {
    const cfg = fleetJobConfig(internalName, jobType);
    const [created] = await db
      .insert(collectionJobsTable)
      .values({
        providerId,
        jobType,
        status: "pending",
        jobConfig: JSON.stringify({ ...cfg, nextRunAt: initialStaggeredRunAt(internalName, jobType) }),
      })
      .returning({ id: collectionJobsTable.id });
    if (created) report.touched.push({ jobId: created.id, provider: internalName, action: "created" });
    return;
  }

  const cfg = parseJobConfig(candidate.job_config);
  if (candidate.status === "pending" && isFutureRun(cfg)) return;

  if (NEEDS_SCHEDULE.includes(candidate.status as (typeof NEEDS_SCHEDULE)[number]) || candidate.status === "pending") {
    await touchJob(
      candidate.id,
      internalName,
      jobType,
      internalName,
      cfg,
      candidate.items_processed > 0 ? "requeued" : "scheduled",
      report,
    );
  }
}

export async function ensureProductionFleetSchedule(): Promise<FleetScheduleReport> {
  const report: FleetScheduleReport = { cappedParallel: await capParallelJobs(), touched: [] };

  if (!isFleetAutoStartEnabled()) {
    return report;
  }

  if (ENCAR_REFRESH_JOB_ID > 0) {
    await ensurePinnedJob(ENCAR_REFRESH_JOB_ID, "encar", "listing_refresh", encarRefreshConfig(), report);
  }
  if (ENCAR_JOB_ID > 0) {
    await ensurePinnedJob(ENCAR_JOB_ID, "encar", "full_collection", encarFullConfig(), report);
  }
  // Import Motor needs local Chrome CDP — never auto-schedule on Railway unless explicitly enabled.
  if (IM_JOB_ID > 0 && process.env.IMPORT_MOTOR_ON_PRODUCTION === "1") {
    await ensurePinnedJob(
      IM_JOB_ID,
      "import_motor",
      "incremental",
      fleetJobConfig("import_motor", "incremental"),
      report,
    );
  }

  const encarProvider = await db
    .select({ id: providersTable.id })
    .from(providersTable)
    .where(eq(providersTable.internalName, "encar"))
    .limit(1);
  const imProvider = await db
    .select({ id: providersTable.id })
    .from(providersTable)
    .where(eq(providersTable.internalName, "import_motor"))
    .limit(1);
  const encarKeep = [ENCAR_JOB_ID, ENCAR_REFRESH_JOB_ID].filter((id) => id > 0);
  const imKeep =
    IM_JOB_ID > 0 && process.env.IMPORT_MOTOR_ON_PRODUCTION === "1" ? [IM_JOB_ID] : [];
  if (encarProvider[0]) await cancelExtraActive(encarProvider[0].id, encarKeep);
  if (imProvider[0]) await cancelExtraActive(imProvider[0].id, imKeep);

  const providers = await db
    .select({ id: providersTable.id, internalName: providersTable.internalName })
    .from(providersTable)
    .where(eq(providersTable.enabled, true));

  for (const p of providers) {
    if (!HISTORICAL_ADAPTER_NAMES.has(p.internalName)) continue;
    if (FLEET_SKIP_PROVIDERS.has(p.internalName)) continue;
    const isPriority = FLEET_PRIORITY_PROVIDERS.has(p.internalName);
    if (!isPriority) {
      const { rows } = await pool.query<{ worked: number }>(
        `SELECT count(*)::int AS worked FROM collection_jobs WHERE provider_id = $1 AND items_processed > 0`,
        [p.id],
      );
      if (Number(rows[0]?.worked ?? 0) === 0) continue;
    }
    try {
      await ensureProviderJob(p.id, p.internalName, report);
    } catch (err) {
      logger.warn({ err, provider: p.internalName }, "Fleet schedule: provider skipped");
    }
  }

  if (report.touched.length > 0) {
    logger.info({ touched: report.touched.length, cappedParallel: report.cappedParallel }, "Fleet crawl schedule applied");
  }
  return report;
}
