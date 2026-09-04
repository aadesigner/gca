/**
 * Park every collection job except Import Motor 360 so brand crawl gets the worker.
 * Uses status=completed (not cancelled) — crawl-health resumes cancelled jobs.
 */
import pg from "pg";

const KEEP = new Set([Number(process.env.IM_JOB_ID || 360)]);
const far = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const { rows } = await c.query(
  `SELECT id, job_config FROM collection_jobs WHERE status IN ('running','pending','paused','cancelled') AND NOT (id = ANY($1::int[]))`,
  [[...KEEP]],
);

for (const row of rows) {
  let cfg = {};
  try {
    cfg = JSON.parse(row.job_config || "{}");
  } catch {
    cfg = {};
  }
  cfg.nextRunAt = far;
  await c.query(
    `
    UPDATE collection_jobs
    SET status='completed',
        completed_at=now(),
        job_config=$1,
        error_message='parked for import_motor brand crawl',
        updated_at=now()
    WHERE id=$2
  `,
    [JSON.stringify(cfg), row.id],
  );
}
console.log("parked", rows.map((r) => r.id));

await c.query(
  `
  UPDATE collection_jobs
  SET status='pending', updated_at=now()-interval '1 day',
      error_message=NULL, completed_at=NULL,
      job_config = COALESCE(job_config, '{}'::text)::jsonb - 'nextRunAt'
  WHERE id = ANY($1::int[])
`,
  [[...KEEP]],
);

const live = await c.query(
  `SELECT id, status FROM collection_jobs WHERE status IN ('running','pending') ORDER BY id`,
);
console.log("live", live.rows);
await c.end();
