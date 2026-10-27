/**
 * Local-only Encar full_collection. Pauses every other job.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-start-encar-offline-full.mjs
 */
import pg from "pg";

const url = process.env.DATABASE_URL || "";
if (!url) {
  throw new Error("DATABASE_URL is not set");
}
const host = (() => {
  try {
    return new URL(url.replace(/^postgres(ql)?:/i, "http:")).hostname;
  } catch {
    return "";
  }
})();
if (!/^(localhost|127\.0\.0\.1|::1)$/i.test(host) || /rlwy\.net|railway\.(app|internal)/i.test(url)) {
  throw new Error(`Refusing to start Encar crawl — DATABASE_URL host is "${host || "(unknown)"}", not local`);
}

const c = new pg.Client({ connectionString: url });
await c.connect();

const encarCfg = {
  sort: "ModifiedDate",
  carType: "all",
  detailLevel: "full",
  skipRecentHours: 0,
  maxPages: 0,
  maxListings: 0,
  delayMs: 80,
  concurrency: 6,
  maxEncarConcurrency: 8,
  minGapMs: 60,
  retryCount: 4,
  requestTimeoutMs: 30_000,
  pageSize: 50,
  resetCrawlState: true,
  repeatHours: 6,
};

const { rows: prov } = await c.query(`SELECT id FROM providers WHERE internal_name = 'encar' LIMIT 1`);
if (!prov[0]) {
  await c.end();
  throw new Error("No encar provider row in local DB");
}
const providerId = prov[0].id;

const existing = await c.query(
  `
  SELECT id, status, job_type
  FROM collection_jobs
  WHERE provider_id = $1 AND job_type = 'full_collection'
  ORDER BY CASE WHEN id = 362 THEN 0 ELSE 1 END, id
  LIMIT 1
  `,
  [providerId],
);

let jobId = existing.rows[0]?.id ?? null;
if (jobId && existing.rows[0].status === "running") {
  await c.query(
    `UPDATE collection_jobs SET status = 'paused', updated_at = now() WHERE id = $1 AND status = 'running'`,
    [jobId],
  );
  await new Promise((r) => setTimeout(r, 1500));
}

const paused = await c.query(
  `
  UPDATE collection_jobs
  SET status = 'paused',
      error_message = COALESCE(error_message, 'paused — Encar offline full'),
      updated_at = now()
  WHERE status IN ('running', 'pending')
    AND ($1::int IS NULL OR id <> $1)
  RETURNING id
  `,
  [jobId],
);

await c.query(`UPDATE settings SET max_collection_jobs_parallel = 1 WHERE id = 1`);

if (jobId) {
  await c.query(
    `
    UPDATE collection_jobs
    SET status = 'pending',
        job_type = 'full_collection',
        job_config = $1,
        crawl_state = NULL,
        pages_processed = 0,
        items_discovered = 0,
        items_processed = 0,
        listings_fetched = 0,
        items_failed = 0,
        vins_found = 0,
        vins_new = 0,
        new_observations = 0,
        duplicates_skipped = 0,
        completed_at = NULL,
        error_message = NULL,
        updated_at = now() - interval '1 hour'
    WHERE id = $2
    `,
    [JSON.stringify(encarCfg), jobId],
  );
} else {
  const created = await c.query(
    `
    INSERT INTO collection_jobs (provider_id, job_type, status, job_config)
    VALUES ($1, 'full_collection', 'pending', $2)
    RETURNING id
    `,
    [providerId, JSON.stringify(encarCfg)],
  );
  jobId = created.rows[0].id;
}

const check = await c.query(
  `
  SELECT j.id, p.internal_name, j.status, j.job_type,
         j.job_config::jsonb->>'detailLevel' AS detail_level,
         j.job_config::jsonb->>'sort' AS sort,
         j.job_config::jsonb->>'carType' AS car_type,
         j.job_config::jsonb->>'concurrency' AS concurrency,
         j.job_config::jsonb->>'delayMs' AS delay_ms
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE j.id = $1
  `,
  [jobId],
);
const slots = await c.query(`SELECT max_collection_jobs_parallel FROM settings WHERE id = 1`);
console.log(
  JSON.stringify(
    {
      host,
      paused: paused.rows.map((r) => r.id),
      job: check.rows[0],
      parallel: slots.rows[0]?.max_collection_jobs_parallel,
    },
    null,
    2,
  ),
);
await c.end();
