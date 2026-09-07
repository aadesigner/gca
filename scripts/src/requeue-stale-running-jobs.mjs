/**
 * Requeue collection jobs stuck in `running` with no heartbeat.
 * Frees parallel slots so pending fleet jobs (new providers) can start.
 */
import pg from "pg";

const STALE_MINUTES = Number(process.env.STALE_JOB_MINUTES || 90);

const c = new pg.Client({
  host: process.env.PROD_PG_HOST,
  port: Number(process.env.PROD_PG_PORT),
  user: process.env.PROD_PG_USER,
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE,
  ssl: false,
});
await c.connect();

const stale = await c.query(
  `
  SELECT cj.id, p.internal_name, cj.job_type, cj.items_processed, cj.items_discovered,
    cj.updated_at, cj.started_at,
    ROUND(EXTRACT(EPOCH FROM (now() - cj.updated_at))/60) AS quiet_min
  FROM collection_jobs cj
  JOIN providers p ON p.id = cj.provider_id
  WHERE cj.status = 'running'
    AND cj.updated_at < now() - ($1 || ' minutes')::interval
  ORDER BY cj.updated_at
`,
  [String(STALE_MINUTES)],
);

console.log(`stale running (quiet > ${STALE_MINUTES}m):`, stale.rows.length);
for (const r of stale.rows) {
  console.log({
    id: r.id,
    p: r.internal_name,
    type: r.job_type,
    ok: r.items_processed,
    disc: r.items_discovered,
    quiet_min: r.quiet_min,
  });
}

if (!stale.rows.length) {
  await c.end();
  process.exit(0);
}

const ids = stale.rows.map((r) => r.id);
const res = await c.query(
  `
  UPDATE collection_jobs
  SET status = 'pending',
      error_message = 'requeued: stale running with no heartbeat',
      started_at = NULL,
      completed_at = NULL,
      updated_at = now(),
      job_config = CASE
        WHEN job_config IS NULL OR job_config = '' THEN jsonb_build_object('nextRunAt', now())::text
        ELSE (
          COALESCE(job_config::jsonb, '{}'::jsonb) || jsonb_build_object('nextRunAt', to_jsonb(now()))
        )::text
      END
  WHERE id = ANY($1::int[])
  RETURNING id
`,
  [ids],
);
console.log("requeued", res.rowCount, res.rows.map((r) => r.id));

const after = await c.query(`
  SELECT status, count(*)::int AS n FROM collection_jobs
  WHERE status IN ('running','pending') GROUP BY 1
`);
console.log("after", after.rows);

await c.end();
