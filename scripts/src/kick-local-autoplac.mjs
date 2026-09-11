/**
 * Kick local Autoplac full_collection with concurrency=2 (CDP list + Node detail).
 * Parks empty stuck runners so a parallel slot opens for Autoplac.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/kick-local-autoplac.mjs
 */
import pg from "pg";

const KEEP = new Set([
  Number(process.env.IM_JOB_ID || 360),
  // Autoplac job id resolved below
]);

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const [provider] = (
  await c.query(`SELECT id FROM providers WHERE internal_name = 'autoplac' LIMIT 1`)
).rows;
if (!provider) {
  console.error("autoplac provider missing — run seed-providers");
  process.exit(1);
}

let job = (
  await c.query(
    `
    SELECT id, status, job_config, items_processed
    FROM collection_jobs
    WHERE provider_id = $1 AND job_type = 'full_collection'
    ORDER BY updated_at DESC
    LIMIT 1
    `,
    [provider.id],
  )
).rows[0];

if (!job) {
  const created = await c.query(
    `
    INSERT INTO collection_jobs (provider_id, job_type, status, job_config)
    VALUES ($1, 'full_collection', 'pending', $2)
    RETURNING id, status, job_config, items_processed
    `,
    [
      provider.id,
      JSON.stringify({
        source: "kick_local_autoplac",
        concurrency: 2,
        delayMs: 1100,
        retryCount: 3,
        detailLevel: "full",
        maxPages: 0,
        maxListings: 0,
        skipRecentHours: 0,
        repeatHours: 5,
      }),
    ],
  );
  job = created.rows[0];
}

KEEP.add(job.id);

// Park empty stuck runners (0 processed, quiet) except IM + Autoplac.
const parked = await c.query(
  `
  UPDATE collection_jobs cj
  SET status = 'cancelled',
      completed_at = COALESCE(completed_at, NOW()),
      updated_at = NOW(),
      error_message = COALESCE(error_message, 'parked: free slot for local autoplac+IM')
  FROM providers p
  WHERE cj.provider_id = p.id
    AND cj.status IN ('running', 'pending', 'paused')
    AND cj.id <> ALL($1::int[])
    AND COALESCE(cj.items_processed, 0) = 0
    AND cj.updated_at < NOW() - interval '20 minutes'
  RETURNING cj.id, p.internal_name
  `,
  [[...KEEP]],
);
console.log(
  "parked_empty",
  parked.rows.map((r) => `${r.internal_name}:${r.id}`),
);

const cfg = {
  source: "kick_local_autoplac",
  concurrency: 2,
  delayMs: 1100,
  retryCount: 3,
  detailLevel: "full",
  maxPages: 0,
  maxListings: 0,
  skipRecentHours: 0,
  repeatHours: 5,
  staggerMinutes: 0,
};

await c.query(
  `
  UPDATE collection_jobs
  SET status = 'pending',
      started_at = NULL,
      completed_at = NULL,
      error_message = NULL,
      updated_at = NOW() - interval '1 day',
      created_at = LEAST(created_at, NOW() - interval '2 days'),
      job_config = $1,
      crawl_state = NULL
  WHERE id = $2
  `,
  [JSON.stringify(cfg), job.id],
);

// Ensure IM stays claimable / running.
await c.query(
  `
  UPDATE collection_jobs
  SET status = CASE WHEN status IN ('cancelled','completed','failed') THEN 'pending' ELSE status END,
      updated_at = CASE WHEN status IN ('cancelled','completed','failed') THEN NOW() - interval '1 day' ELSE updated_at END,
      completed_at = CASE WHEN status IN ('cancelled','completed','failed') THEN NULL ELSE completed_at END,
      error_message = CASE WHEN status IN ('cancelled','completed','failed') THEN NULL ELSE error_message END
  WHERE id = $1
  `,
  [Number(process.env.IM_JOB_ID || 360)],
);

const live = await c.query(
  `
  SELECT cj.id, p.internal_name, cj.status, cj.items_processed,
         left(cj.job_config::text, 180) AS cfg
  FROM collection_jobs cj
  JOIN providers p ON p.id = cj.provider_id
  WHERE cj.status IN ('pending','running')
    AND p.internal_name IN ('autoplac','import_motor')
  ORDER BY p.internal_name
  `,
);
console.log(JSON.stringify({ kicked: job.id, live: live.rows }, null, 2));
await c.end();
