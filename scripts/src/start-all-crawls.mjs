/**
 * Start all previously-working marketplace crawls in parallel (new-car discovery).
 *
 * Re-queues the best job per provider with aggressive settings, keeps Encar 361+362
 * and Import Motor 360 running, heals stuck shards, then prints status.
 *
 * Run: node --import ./scripts/load-env.mjs ./scripts/src/start-all-crawls.mjs
 */
import pg from "pg";
import {
  SKIP_PROVIDERS,
  mergeConfig,
  healCrawlState,
  restartCrawlState,
  boostForProvider,
  preferredJobType,
} from "./crawl-shared.mjs";

const IM_JOB_ID = Number(process.env.IM_JOB_ID || 360);
const ENCAR_JOB_ID = Number(process.env.ENCAR_JOB_ID || 362);
const ENCAR_REFRESH_JOB_ID = Number(process.env.ENCAR_REFRESH_JOB_ID || 361);
const PINNED_JOB_IDS = [IM_JOB_ID, ENCAR_JOB_ID, ENCAR_REFRESH_JOB_ID].filter((id) => id > 0);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function ensureParallel(pool) {
  await pool.query(`
    UPDATE settings SET max_collection_jobs_parallel = GREATEST(max_collection_jobs_parallel, 100)
    WHERE id = 1
  `);
}

async function workedProviders(pool) {
  const { rows } = await pool.query(`
    SELECT DISTINCT p.id AS provider_id, p.internal_name
    FROM providers p
    JOIN collection_jobs cj ON cj.provider_id = p.id
    WHERE cj.items_processed > 0
    ORDER BY p.internal_name
  `);
  return rows.filter((r) => !SKIP_PROVIDERS.has(r.internal_name));
}

async function activeJobs(pool) {
  const { rows } = await pool.query(`
    SELECT cj.id, p.internal_name, cj.job_type, cj.status
    FROM collection_jobs cj
    JOIN providers p ON p.id = cj.provider_id
    WHERE cj.status IN ('running', 'pending')
  `);
  return rows;
}

async function pickJob(pool, providerId, internalName) {
  const prefer = preferredJobType(internalName);
  const { rows } = await pool.query(
    `
    SELECT id, job_type, status, job_config, crawl_state, items_processed
    FROM collection_jobs
    WHERE provider_id = $1
    ORDER BY
      CASE WHEN job_type = $2 THEN 0 ELSE 1 END,
      items_processed DESC NULLS LAST,
      updated_at DESC
    LIMIT 1
    `,
    [providerId, prefer],
  );
  return rows[0] ?? null;
}

async function createJob(pool, providerId, internalName) {
  const jobType = preferredJobType(internalName);
  const cfg = JSON.stringify(boostForProvider(internalName, jobType));
  const { rows } = await pool.query(
    `
    INSERT INTO collection_jobs (provider_id, job_type, status, job_config)
    VALUES ($1, $2, 'pending', $3)
    RETURNING id
    `,
    [providerId, jobType, cfg],
  );
  return rows[0].id;
}

async function requeueJob(pool, jobId, internalName, jobType, jobConfig, crawlState, wasStatus) {
  const boost = boostForProvider(internalName, jobType);
  const healed = restartCrawlState(crawlState, wasStatus);
  await pool.query(
    `
    UPDATE collection_jobs
    SET status = 'pending',
        completed_at = NULL,
        error_message = NULL,
        job_config = $1,
        crawl_state = $2,
        updated_at = NOW()
    WHERE id = $3
    `,
    [mergeConfig(jobConfig, boost), healed.json, jobId],
  );
  return { healed: healed.fixed, boost };
}

async function dedupeProvider(pool, providerId, keepIds) {
  await pool.query(
    `
    UPDATE collection_jobs
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, NOW()),
        error_message = COALESCE(error_message, 'superseded by fleet crawl')
    WHERE provider_id = $1
      AND NOT (id = ANY($2::int[]))
      AND status IN ('running', 'pending')
    `,
    [providerId, keepIds],
  );
}

async function main() {
  await ensureParallel(pool);
  const worked = await workedProviders(pool);
  const active = await activeJobs(pool);
  const pinnedProviders = new Set(["encar", "import_motor"]);
  const actions = [];

  for (const pinnedId of PINNED_JOB_IDS) {
    const { rows } = await pool.query(
      `
      SELECT cj.id, p.internal_name, cj.job_type, cj.status, cj.job_config, cj.crawl_state
      FROM collection_jobs cj
      JOIN providers p ON p.id = cj.provider_id
      WHERE cj.id = $1
      `,
      [pinnedId],
    );
    const job = rows[0];
    if (!job) {
      actions.push({ provider: pinnedId, action: "missing_pinned_job" });
      continue;
    }
    const r = await requeueJob(pool, job.id, job.internal_name, job.job_type, job.job_config, job.crawl_state, job.status);
    actions.push({
      provider: job.internal_name,
      jobId: job.id,
      jobType: job.job_type,
      action: "requeued_pinned",
      was: job.status,
      ...r,
    });
  }

  const encarP = worked.find((w) => w.internal_name === "encar");
  if (encarP) await dedupeProvider(pool, encarP.provider_id, [ENCAR_JOB_ID, ENCAR_REFRESH_JOB_ID]);
  const imP = worked.find((w) => w.internal_name === "import_motor");
  if (imP) await dedupeProvider(pool, imP.provider_id, [IM_JOB_ID]);

  for (const { provider_id, internal_name } of worked) {
    if (SKIP_PROVIDERS.has(internal_name) || pinnedProviders.has(internal_name)) continue;

    const running = active.filter((j) => j.internal_name === internal_name);
    if (running.length > 0) {
      for (const j of running) {
        const { rows } = await pool.query(
          "SELECT job_config, crawl_state FROM collection_jobs WHERE id = $1",
          [j.id],
        );
        const row = rows[0];
        const r = await requeueJob(pool, j.id, internal_name, j.job_type, row.job_config, row.crawl_state, j.status);
        actions.push({
          provider: internal_name,
          jobId: j.id,
          jobType: j.job_type,
          action: "requeued_active",
          was: j.status,
          ...r,
        });
      }
      await dedupeProvider(pool, provider_id, running.map((j) => j.id));
      continue;
    }

    const job = await pickJob(pool, provider_id, internal_name);
    if (!job) {
      const id = await createJob(pool, provider_id, internal_name);
      actions.push({
        provider: internal_name,
        jobId: id,
        action: "created",
        jobType: preferredJobType(internal_name),
      });
      await dedupeProvider(pool, provider_id, [id]);
      continue;
    }

    const r = await requeueJob(pool, job.id, internal_name, job.job_type, job.job_config, job.crawl_state, job.status);
    actions.push({
      provider: internal_name,
      jobId: job.id,
      jobType: job.job_type,
      action: "requeued",
      was: job.status,
      processed: job.items_processed,
      ...r,
    });
    await dedupeProvider(pool, provider_id, [job.id]);
  }

  const status = await pool.query(`
    SELECT p.internal_name, cj.id, cj.job_type, cj.status,
           cj.job_config::json->>'concurrency' AS conc,
           cj.job_config::json->>'delayMs' AS delay
    FROM collection_jobs cj
    JOIN providers p ON p.id = cj.provider_id
    WHERE cj.status IN ('running', 'pending')
    ORDER BY p.internal_name, cj.id
  `);

  console.log(JSON.stringify({ actions, queued: status.rows }, null, 2));
}

try {
  await main();
} finally {
  await pool.end();
}

console.error("\nRestart API if jobs were already running (worker holds in-memory state).");
