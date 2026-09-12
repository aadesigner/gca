/**
 * Prod full_collection campaign (existing adapters only).
 * Defers finn/nettiauto/opensooq until API deploy — then re-run with INCLUDE_NEW=1.
 */
import pg from "pg";
import { readFileSync } from "fs";
import { SKIP_PROVIDERS, mergeConfig, boostForProvider } from "./src/crawl-shared.mjs";

const vars = JSON.parse(readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8"));
const m = vars.DATABASE_URL.match(/postgresql:\/\/([^:]+):([^@]+)@/);
const pool = new pg.Pool({
  connectionString: `postgresql://${m[1]}:${m[2]}@${vars.RAILWAY_TCP_PROXY_DOMAIN}:${vars.RAILWAY_TCP_PROXY_PORT}/railway`,
  ssl: false,
});

const DEFER = new Set(process.env.INCLUDE_NEW === "1" ? [] : ["finn", "nettiauto", "opensooq"]);
const LOCAL_ONLY = new Set(["import_motor", "autoplac"]);

async function pickOrCreateFullJob(providerId, internalName) {
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
    `INSERT INTO collection_jobs (provider_id, job_type, status, job_config)
     VALUES ($1, 'full_collection', 'pending', $2)
     RETURNING id, job_type, status, job_config`,
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
        started_at = NULL,
        job_config = $1,
        updated_at = NOW()
    WHERE id = $2
    `,
    [mergeConfig(existingConfig, { ...boost, nextRunAt: nextRun }), jobId],
  );
}

async function main() {
  await pool.query(
    `UPDATE settings SET max_collection_jobs_parallel = GREATEST(max_collection_jobs_parallel, 8) WHERE id = 1`,
  );

  const cancelledRefresh = await pool.query(
    `
    UPDATE collection_jobs j
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, NOW()),
        error_message = COALESCE(error_message, 'cancelled for full_collection campaign')
    FROM providers p
    WHERE j.provider_id = p.id
      AND j.status IN ('pending','running','paused')
      AND j.job_type = 'listing_refresh'
      AND NOT (p.internal_name = ANY($1::text[]))
    RETURNING j.id, p.internal_name
    `,
    [[...SKIP_PROVIDERS]],
  );
  console.log("cancelled_refresh", cancelledRefresh.rowCount);

  const { rows: providers } = await pool.query(
    `SELECT id, internal_name FROM providers WHERE enabled = true ORDER BY internal_name`,
  );

  const actions = [];
  for (const p of providers) {
    const name = p.internal_name;
    if (SKIP_PROVIDERS.has(name)) {
      actions.push({ provider: name, action: "skip_list" });
      continue;
    }
    if (LOCAL_ONLY.has(name)) {
      actions.push({ provider: name, action: "local_cdp_only" });
      continue;
    }
    if (DEFER.has(name)) {
      actions.push({ provider: name, action: "deferred_until_api_deploy" });
      continue;
    }

    const job = await pickOrCreateFullJob(p.id, name);
    await forceFullJob(job.id, name, job.job_config);
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
      [p.id, job.id],
    );
    actions.push({ provider: name, action: "forced_full", jobId: job.id });
  }

  const queued = await pool.query(
    `
    SELECT p.internal_name, cj.id, cj.job_type, cj.status
    FROM collection_jobs cj
    JOIN providers p ON p.id = cj.provider_id
    WHERE cj.status IN ('running', 'pending')
    ORDER BY p.internal_name
    `,
  );

  console.log(
    JSON.stringify(
      {
        forced: actions.filter((a) => a.action === "forced_full").length,
        deferred: actions.filter((a) => a.action === "deferred_until_api_deploy"),
        skipped: actions.filter((a) => a.action !== "forced_full" && a.action !== "deferred_until_api_deploy")
          .length,
        queued: queued.rows,
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
