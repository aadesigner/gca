/**
 * Requeue quiet runners + bump starved new-provider pending jobs to claim next.
 */
import pg from "pg";

const STARVED = [
  "carpages",
  "ontariocars",
  "willhaben",
  "autoplac",
  "autoscout24",
  "bidexport",
  "sauto",
  "aaaauto",
  "cars24ae",
  "dubicars",
  "otomoto",
  "salvagebid",
  "auctionauto",
  "autotraderca",
  "bringatrailer",
  "iaa",
  "lotte_autoglobal",
  "koreaauto_auction",
  "koreausedcars",
  "seobuk",
  "thebidrive",
];

const c = new pg.Client({
  host: process.env.PROD_PG_HOST,
  port: Number(process.env.PROD_PG_PORT || 5432),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
  ssl: false,
});
await c.connect();

await c.query(`UPDATE settings SET max_collection_jobs_parallel = 8, updated_at = NOW() WHERE id = 1`);

const stale = await c.query(`
  UPDATE collection_jobs
  SET status = 'pending',
      started_at = NULL,
      completed_at = NULL,
      error_message = 'ops: requeued quiet runner',
      job_config = (
        jsonb_set(
          COALESCE(NULLIF(job_config, '')::jsonb, '{}'::jsonb),
          '{nextRunAt}',
          to_jsonb(to_char(NOW() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        )
      )::text,
      updated_at = NOW()
  WHERE status = 'running'
    AND updated_at < NOW() - interval '45 minutes'
  RETURNING id, provider_id
`);
console.log(
  "requeued_quiet",
  stale.rowCount,
  stale.rows.map((r) => r.id),
);

// Cancel duplicate pending per provider (keep newest kick job if possible)
const dups = await c.query(`
  WITH ranked AS (
    SELECT j.id, j.provider_id, p.internal_name,
           ROW_NUMBER() OVER (
             PARTITION BY j.provider_id
             ORDER BY
               CASE WHEN j.job_config LIKE '%ops_kick_fleet_now%' THEN 0 ELSE 1 END,
               j.created_at ASC
           ) AS rn
    FROM collection_jobs j
    JOIN providers p ON p.id = j.provider_id
    WHERE j.status = 'pending'
  )
  UPDATE collection_jobs j
  SET status = 'cancelled', completed_at = NOW(),
      error_message = 'ops: cancel duplicate pending', updated_at = NOW()
  FROM ranked r
  WHERE j.id = r.id AND r.rn > 1
  RETURNING j.id, r.internal_name
`);
console.log("cancelled_dups", dups.rowCount);

let i = 0;
for (const name of STARVED) {
  i += 1;
  const createdAt = new Date(Date.now() - (20_000 - i) * 60_000).toISOString();
  const nextRunAt = new Date(Date.now() + i * 3_000).toISOString();
  const u = await c.query(
    `
    UPDATE collection_jobs j
    SET created_at = $1::timestamptz,
        updated_at = NOW(),
        job_config = (
          jsonb_set(
            COALESCE(NULLIF(j.job_config, '')::jsonb, '{}'::jsonb),
            '{nextRunAt}',
            to_jsonb($2::text)
          )
        )::text,
        error_message = NULL
    WHERE j.status = 'pending'
      AND j.provider_id = (SELECT id FROM providers WHERE internal_name = $3)
    RETURNING j.id
    `,
    [createdAt, nextRunAt, name],
  );
  if (u.rowCount) console.log("bump", name, u.rows.map((r) => r.id).join(","));
}

const summary = await c.query(`
  SELECT status, count(*)::int n FROM collection_jobs
  WHERE status IN ('pending','running') GROUP BY 1 ORDER BY 1
`);
const running = await c.query(`
  SELECT p.internal_name, j.id, j.job_type,
         round(extract(epoch from (now()-j.updated_at))/60)::int quiet_min
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE j.status = 'running'
  ORDER BY quiet_min DESC
`);
console.log({ summary: summary.rows, running: running.rows });
await c.end();
