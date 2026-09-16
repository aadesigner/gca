/**
 * Fast runner watchdog — auto-heals quiet/zombie collection jobs.
 *
 * Problem it solves: jobs stay `running` with no DB progress, fill all parallel
 * slots, and fleet intake drops to zero until someone manually force-requeues.
 *
 * Runs every few minutes (default 5). Safe defaults:
 *  - only touch `running` jobs quiet longer than QUIET_MS (default 25m)
 *  - require either age-stall OR (fleet intake dead + quiet runners)
 *  - per-job cooldown so we don't thrash
 *  - cap unsticks per cycle to the parallel slot count
 *  - staggered nextRunAt so reclaim is smooth
 *
 * Disable: RUNNER_WATCHDOG=0
 * Force on: RUNNER_WATCHDOG=1
 */
import { pool } from "@workspace/db";
import { logger } from "./logger";
import { ensureProductionFleetSchedule, isFleetAutoStartEnabled } from "./fleet-schedule";

const MINUTE = 60_000;

const INTERVAL_MS = Math.max(
  2 * MINUTE,
  Number(process.env.RUNNER_WATCHDOG_INTERVAL_MS || 5 * MINUTE) || 5 * MINUTE,
);
const QUIET_MS = Math.max(
  10 * MINUTE,
  Number(process.env.RUNNER_QUIET_MS || 25 * MINUTE) || 25 * MINUTE,
);
const FLEET_EVERY_MS = Math.max(
  10 * MINUTE,
  Number(process.env.RUNNER_WATCHDOG_FLEET_MS || 15 * MINUTE) || 15 * MINUTE,
);
const COOLDOWN_MS = Math.max(
  QUIET_MS,
  Number(process.env.RUNNER_UNSTICK_COOLDOWN_MS || 45 * MINUTE) || 45 * MINUTE,
);
const INTAKE_WINDOW_MIN = Math.max(
  5,
  Number(process.env.RUNNER_INTAKE_WINDOW_MIN || 15) || 15,
);
const MAX_UNSTICK = Math.max(
  2,
  Number(process.env.RUNNER_WATCHDOG_MAX_UNSTICK || 8) || 8,
);

/** Providers that must never be auto-touched on Railway (local CDP / disabled). */
const SKIP_PROVIDERS = new Set([
  "import_motor",
  "autoplac",
  "japanesecartrade",
  "getcarapi",
  "kmcheck",
  "kmcheck_manual",
  "carstat",
]);

export type RunnerWatchdogReport = {
  t: string;
  ok: boolean;
  quietMin: number;
  intake: {
    listingsWindowMin: number;
    listings: number;
    photos: number;
    running: number;
    runningQuiet: number;
    hot2m: number;
  };
  unstuck: Array<{ id: number; provider: string; quietMin: number }>;
  actions: string[];
  errors: string[];
};

let lastReport: RunnerWatchdogReport | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let lastFleetAt = 0;
const lastUnstickAt = new Map<number, number>();

export function getLastRunnerWatchdogReport(): RunnerWatchdogReport | null {
  return lastReport;
}

export function isRunnerWatchdogEnabled(): boolean {
  if (process.env.RUNNER_WATCHDOG === "0") return false;
  if (process.env.RUNNER_WATCHDOG === "1") return true;
  // Default: production / Railway fleet only (local has its own checkup loop).
  return isFleetAutoStartEnabled();
}

type QuietRunner = {
  id: number;
  provider: string;
  quiet_ms: number;
  listings: number;
  pages: number;
};

async function loadIntake(): Promise<RunnerWatchdogReport["intake"]> {
  const { rows } = await pool.query(
    `
    SELECT
      (SELECT count(*)::int FROM listings
        WHERE created_at > now() - ($1::int * interval '1 minute')) AS listings,
      (SELECT count(*)::int FROM photos
        WHERE created_at > now() - ($1::int * interval '1 minute')) AS photos,
      (SELECT count(*)::int FROM collection_jobs WHERE status = 'running') AS running,
      (SELECT count(*)::int FROM collection_jobs
        WHERE status = 'running' AND updated_at < now() - ($2::int * interval '1 millisecond')) AS running_quiet,
      (SELECT count(*)::int FROM collection_jobs
        WHERE status = 'running' AND updated_at > now() - interval '2 minutes') AS hot_2m
    `,
    [INTAKE_WINDOW_MIN, QUIET_MS],
  );
  const row = rows[0] ?? {};
  return {
    listingsWindowMin: INTAKE_WINDOW_MIN,
    listings: Number(row.listings ?? 0),
    photos: Number(row.photos ?? 0),
    running: Number(row.running ?? 0),
    runningQuiet: Number(row.running_quiet ?? 0),
    hot2m: Number(row.hot_2m ?? 0),
  };
}

async function loadQuietRunners(): Promise<QuietRunner[]> {
  const { rows } = await pool.query<QuietRunner>(
    `
    SELECT
      j.id,
      p.internal_name AS provider,
      GREATEST(0, floor(extract(epoch from (now() - j.updated_at)) * 1000))::float AS quiet_ms,
      coalesce(j.listings_fetched, j.items_processed, 0)::int AS listings,
      coalesce(j.pages_processed, 0)::int AS pages
    FROM collection_jobs j
    JOIN providers p ON p.id = j.provider_id
    WHERE j.status = 'running'
      AND j.updated_at < now() - ($1::int * interval '1 millisecond')
      AND p.enabled = true
      AND p.internal_name <> ALL($2::text[])
    ORDER BY j.updated_at ASC
    LIMIT 40
    `,
    [QUIET_MS, [...SKIP_PROVIDERS]],
  );
  return rows.map((r) => ({
    id: Number(r.id),
    provider: String(r.provider),
    quiet_ms: Number(r.quiet_ms),
    listings: Number(r.listings),
    pages: Number(r.pages),
  }));
}

function underCooldown(jobId: number, now: number): boolean {
  const prev = lastUnstickAt.get(jobId);
  return prev != null && now - prev < COOLDOWN_MS;
}

async function unstickRunner(job: QuietRunner, index: number): Promise<boolean> {
  const staggerSec = Math.min(90, index * 15);
  const { rowCount } = await pool.query(
    `
    UPDATE collection_jobs j
    SET status = 'pending',
        started_at = NULL,
        completed_at = NULL,
        error_message = 'watchdog: quiet runner auto-unstick',
        job_config = (
          jsonb_set(
            COALESCE(NULLIF(j.job_config, '')::jsonb, '{}'::jsonb),
            '{nextRunAt}',
            to_jsonb(
              to_char(
                (NOW() AT TIME ZONE 'utc') + ($2::int * interval '1 second'),
                'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
              )
            )
          )
          #- '{resetCrawlState}'
        )::text,
        updated_at = NOW()
    WHERE j.id = $1
      AND j.status = 'running'
    `,
    [job.id, staggerSec],
  );
  return Number(rowCount) > 0;
}

/**
 * One watchdog pass. Safe to call from admin / tests.
 * Returns whether any runners were unstuck.
 */
export async function runRunnerWatchdog(): Promise<RunnerWatchdogReport> {
  const report: RunnerWatchdogReport = {
    t: new Date().toISOString(),
    ok: true,
    quietMin: Math.round(QUIET_MS / MINUTE),
    intake: {
      listingsWindowMin: INTAKE_WINDOW_MIN,
      listings: 0,
      photos: 0,
      running: 0,
      runningQuiet: 0,
      hot2m: 0,
    },
    unstuck: [],
    actions: [],
    errors: [],
  };

  try {
    report.intake = await loadIntake();
    const now = Date.now();

    // Keep Encar full solo + parallel caps without waiting for the 4h crawl-health tick.
    if (isFleetAutoStartEnabled() && now - lastFleetAt >= FLEET_EVERY_MS) {
      lastFleetAt = now;
      try {
        const fleet = await ensureProductionFleetSchedule();
        if (fleet.touched.length > 0) {
          report.actions.push(
            `fleet:${fleet.touched
              .map((t) => t.action)
              .slice(0, 8)
              .join(",")}`,
          );
        } else {
          report.actions.push(`fleet:ok:parallel_${fleet.cappedParallel}`);
        }
      } catch (err) {
        report.ok = false;
        report.errors.push(`fleet: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    const quiet = await loadQuietRunners();
    const intakeDead = report.intake.listings === 0 && report.intake.hot2m === 0;
    const shouldAct =
      quiet.length > 0 && (intakeDead || quiet.some((q) => q.quiet_ms >= QUIET_MS));

    if (!shouldAct) {
      lastReport = report;
      return report;
    }

    // Prefer oldest quiet first; if intake is alive, only unstick the worst offenders.
    const candidates = quiet
      .filter((q) => !underCooldown(q.id, now))
      .filter((q) => intakeDead || q.quiet_ms >= QUIET_MS)
      .slice(0, MAX_UNSTICK);

    if (candidates.length === 0) {
      report.actions.push("quiet_runners_on_cooldown");
      lastReport = report;
      return report;
    }

    let idx = 0;
    for (const job of candidates) {
      try {
        const ok = await unstickRunner(job, idx);
        if (!ok) continue;
        lastUnstickAt.set(job.id, now);
        const quietMin = Math.round(job.quiet_ms / MINUTE);
        report.unstuck.push({ id: job.id, provider: job.provider, quietMin });
        report.actions.push(`unstick:${job.provider}:${job.id}:quiet_${quietMin}m`);
        idx += 1;
      } catch (err) {
        report.ok = false;
        report.errors.push(
          `job ${job.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    if (report.unstuck.length > 0) {
      logger.warn(
        {
          unstuck: report.unstuck,
          intake: report.intake,
          intakeDead,
        },
        "Runner watchdog unstuck quiet collection jobs",
      );
    }
  } catch (err) {
    report.ok = false;
    report.errors.push(err instanceof Error ? err.message : String(err));
    logger.warn({ err }, "Runner watchdog failed");
  }

  lastReport = report;
  return report;
}

function schedule(delayMs: number): void {
  if (!running) return;
  timer = setTimeout(() => {
    void runRunnerWatchdog()
      .catch((err) => logger.warn({ err }, "Runner watchdog crashed"))
      .finally(() => schedule(INTERVAL_MS));
  }, delayMs);
}

/** Idempotent. Starts the fast watchdog loop (prod/Railway by default). */
export function startRunnerWatchdog(): void {
  if (running) return;
  if (!isRunnerWatchdogEnabled()) {
    logger.info("Runner watchdog disabled");
    return;
  }
  running = true;
  logger.info(
    {
      intervalMin: Math.round(INTERVAL_MS / MINUTE),
      quietMin: Math.round(QUIET_MS / MINUTE),
      cooldownMin: Math.round(COOLDOWN_MS / MINUTE),
      intakeWindowMin: INTAKE_WINDOW_MIN,
      maxUnstick: MAX_UNSTICK,
    },
    "Runner watchdog started",
  );
  // First pass shortly after boot (let workers claim), then on interval.
  schedule(Math.min(INTERVAL_MS, 90_000));
}

export function stopRunnerWatchdog(): void {
  running = false;
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}
