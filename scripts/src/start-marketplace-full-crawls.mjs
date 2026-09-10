/**
 * Stop listing_refresh jobs and start every workable marketplace on a fresh
 * full_collection (crawl_state cleared, progress reset).
 *
 * Skips providers that do not yield public VIN cars (che168, mango, IAA, …).
 *
 * Run (local DB via DATABASE_URL):
 *   node --import ./scripts/load-env.mjs ./scripts/src/start-marketplace-full-crawls.mjs
 *
 * Restart the API worker after so in-memory running jobs pick up the cancel.
 */
import pg from "pg";
import {
  SKIP_PROVIDERS,
  mergeConfig,
  boostForProvider,
} from "./crawl-shared.mjs";

const IM_JOB_ID = Number(process.env.IM_JOB_ID || 360);
const ENCAR_FULL_JOB_ID = Number(process.env.ENCAR_JOB_ID || 362);
const ENCAR_REFRESH_JOB_ID = Number(process.env.ENCAR_REFRESH_JOB_ID || 361);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function ensureParallel() {
  const cap = Math.max(2, Number(process.env.COLLECTION_JOBS_PARALLEL || 8) || 8);
  await pool.query(
    `
    UPDATE settings
    SET max_collection_jobs_parallel = LEAST(GREATEST(max_collection_jobs_parallel, $1), $1)
    WHERE id = 1
    `,
    [cap],
  );
  return cap;
}

async function cancelRefreshJobs() {
  const { rows } = await pool.query(
    `
    UPDATE collection_jobs cj
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, NOW()),
        error_message = COALESCE(error_message, 'superseded by full_collection campaign')
    FROM providers p
    WHERE p.id = cj.provider_id
      AND cj.job_type = 'listing_refresh'
      AND cj.status IN ('pending', 'running', 'paused')
      AND p.internal_name <> ALL($1::text[])
    RETURNING cj.id, p.internal_name
    `,
    [[...SKIP_PROVIDERS]],
  );
  return rows;
}

async function cancelSkipProviderJobs() {
  const { rows } = await pool.query(
    `
    UPDATE collection_jobs cj
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, NOW()),
        error_message = COALESCE(error_message, 'provider skipped — no public VIN crawl')
    FROM providers p
    WHERE p.id = cj.provider_id
      AND p.internal_name = ANY($1::text[])
      AND cj.status IN ('pending', 'running', 'paused')
    RETURNING cj.id, p.internal_name
    `,
    [[...SKIP_PROVIDERS]],
  );
  return rows;
}

async function marketplaceProviders() {
  const { rows } = await pool.query(`
    SELECT p.id AS provider_id, p.internal_name,
           COALESCE((
             SELECT count(*)::int FROM collection_jobs cj
             WHERE cj.provider_id = p.id AND cj.items_processed > 0
           ), 0) AS worked
    FROM providers p
    WHERE p.enabled = true
    ORDER BY p.internal_name
  `);
  return rows.filter((r) => !SKIP_PROVIDERS.has(r.internal_name));
}

async function pickOrCreateFullJob(providerId, internalName, pinnedId) {
  if (pinnedId > 0) {
    const { rows } = await pool.query(
      `SELECT id, job_type, status, job_config FROM collection_jobs WHERE id = $1`,
      [pinnedId],
    );
    if (rows[0]) return rows[0];
  }

  const { rows } = await pool.query(
    `
    SELECT id, job_type, status, job_config
    FROM collection_jobs
    WHERE provider_id = $1
    ORDER BY
      CASE WHEN job_type = 'full_collection' THEN 0 ELSE 1 END,
      items_processed DESC NULLS LAST,
      updated_at DESC
    LIMIT 1
    `,
    [providerId],
  );
  if (rows[0]) return rows[0];

  const cfg = JSON.stringify(boostForProvider(internalName, "full_collection"));
  const { rows: created } = await pool.query(
    `
    INSERT INTO collection_jobs (provider_id, job_type, status, job_config)
    VALUES ($1, 'full_collection', 'pending', $2)
    RETURNING id, job_type, status, job_config
    `,
    [providerId, cfg],
  );
  return created[0];
}

async function forceFullJob(jobId, internalName, existingConfig) {
  const boost = boostForProvider(internalName, "full_collection");
  boost.skipRecentHours = 0;
  boost.detailLevel = "full";
  boost.maxPages = 0;
  boost.maxListings = 0;
  boost.resetCrawlState = true;
  const nextRun = new Date().toISOString();
  await pool.query(
    `
    UPDATE collection_jobs
    SET status = 'pending',
        job_type = 'full_collection',
        completed_at = NULL,
        error_message = NULL,
        crawl_state = NULL,
        pages_processed = 0,
        items_discovered = 0,
        items_processed = 0,
        job_config = $1,
        updated_at = NOW()
    WHERE id = $2
    `,
    [
      mergeConfig(existingConfig, { ...boost, nextRunAt: nextRun }),
      jobId,
    ],
  );
}

async function dedupeProvider(providerId, keepId) {
  await pool.query(
    `
    UPDATE collection_jobs
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, NOW()),
        error_message = COALESCE(error_message, 'superseded by full_collection campaign')
    WHERE provider_id = $1
      AND id <> $2
      AND status IN ('running', 'pending', 'paused')
    `,
    [providerId, keepId],
  );
}

async function main() {
  const parallel = await ensureParallel();
  const cancelledRefresh = await cancelRefreshJobs();
  const cancelledSkip = await cancelSkipProviderJobs();

  if (ENCAR_REFRESH_JOB_ID > 0) {
    await pool.query(
      `
      UPDATE collection_jobs
      SET status = 'cancelled',
          completed_at = COALESCE(completed_at, NOW()),
          error_message = COALESCE(error_message, 'superseded by full_collection campaign')
      WHERE id = $1 AND status IN ('pending', 'running', 'paused')
      `,
      [ENCAR_REFRESH_JOB_ID],
    );
  }

  const providers = await marketplaceProviders();
  const actions = [];

  for (const { provider_id, internal_name, worked } of providers) {
    // Priority: always start. Others: only if they previously crawled cars.
    const priority = new Set([
      "encar",
      "import_motor",
      "autowini",
      "kbchachacha",
      "carpoolkr",
      "charancha",
      "autohub",
      "lotteautoauction",
      "autoinside",
      "autobellglobal",
      "rbautotrade",
      "senaauto",
      "aaaauto",
      "autoplac",
      "autoscout24",
      "autotraderca",
      "sauto",
      "mobilede",
      "willhaben",
      "otomoto",
      "dubicars",
      "cars24ae",
      "carpages",
      "ontariocars",
      "bidexport",
      "thebidrive",
      "japanesecartrade",
      "salvagebid",
      "bringatrailer",
      "copart",
      "lotte_autoglobal",
      "kolon_auto",
      "auctionauto",
      "seobuk",
      "koreaauto_auction",
      "koreausedcars",
    ]);
    if (worked === 0 && !priority.has(internal_name)) {
      actions.push({ provider: internal_name, action: "skipped_never_worked" });
      continue;
    }

    let pinned = 0;
    if (internal_name === "encar") pinned = ENCAR_FULL_JOB_ID;
    if (internal_name === "import_motor") pinned = IM_JOB_ID;

    const job = await pickOrCreateFullJob(provider_id, internal_name, pinned);
    await forceFullJob(job.id, internal_name, job.job_config);
    await dedupeProvider(provider_id, job.id);
    actions.push({
      provider: internal_name,
      jobId: job.id,
      action: "forced_full_collection",
      wasType: job.job_type,
      wasStatus: job.status,
    });
  }

  const status = await pool.query(`
    SELECT p.internal_name, cj.id, cj.job_type, cj.status,
           (cj.crawl_state IS NULL) AS fresh_state,
           cj.job_config::json->>'concurrency' AS conc,
           cj.job_config::json->>'skipRecentHours' AS skip_h
    FROM collection_jobs cj
    JOIN providers p ON p.id = cj.provider_id
    WHERE cj.status IN ('running', 'pending')
    ORDER BY p.internal_name, cj.id
  `);

  console.log(
    JSON.stringify(
      {
        parallel,
        cancelledRefresh: cancelledRefresh.length,
        cancelledSkipProviders: cancelledSkip.length,
        actions,
        queued: status.rows,
      },
      null,
      2,
    ),
  );
}

try {
  await main();
} finally {
  await pool.end();
}

console.error("\nRestart API if jobs were already running (worker holds in-memory state).");
