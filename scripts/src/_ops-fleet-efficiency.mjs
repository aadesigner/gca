/**
 * Free monopolized slots + raise parallel (DB). Railway also needs
 * COLLECTION_JOBS_PARALLEL=12 for the hard cap to rise after redeploy.
 *
 *   node ./src/_ops-fleet-efficiency.mjs
 */
import pg from "pg";

const c = new pg.Client({
  host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT || 15622),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
  ssl: false,
});
await c.connect();

await c.query(`
  UPDATE settings SET max_collection_jobs_parallel = 12, updated_at = NOW() WHERE id = 1
`);
console.log("DB parallel target = 12 (Railway COLLECTION_JOBS_PARALLEL must match after redeploy)");

// Quiet runners (>40m no update) → pending due now
const quiet = await c.query(`
  UPDATE collection_jobs
  SET status='pending', started_at=NULL, completed_at=NULL,
      error_message='ops: efficiency requeue quiet runner',
      job_config=(
        jsonb_set(COALESCE(NULLIF(job_config,'')::jsonb,'{}'::jsonb), '{nextRunAt}',
          to_jsonb(to_char(NOW() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        )
      )::text,
      updated_at=NOW()
  WHERE status='running' AND updated_at < NOW() - interval '40 minutes'
  RETURNING id
`);
console.log("requeued_quiet", quiet.rows.map((r) => r.id));

// Low-yield long runners: park kolon / carpool-style with 0 new after 90m
const parkLow = await c.query(`
  UPDATE collection_jobs j
  SET status='pending', started_at=NULL, completed_at=NULL,
      error_message='ops: parked low-yield to free slot',
      job_config=(
        jsonb_set(
          jsonb_set(COALESCE(NULLIF(j.job_config,'')::jsonb,'{}'::jsonb), '{nextRunAt}',
            to_jsonb(to_char((NOW()+interval '90 minutes') AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
          ),
          '{repeatHours}', '6'::jsonb
        )
      )::text,
      updated_at=NOW()
  FROM providers p
  WHERE j.provider_id=p.id AND j.status='running'
    AND j.started_at < NOW() - interval '90 minutes'
    AND COALESCE(j.vins_new,0) = 0
    AND p.internal_name IN ('kolon_auto','carpoolkr','lotte_autoglobal')
  RETURNING j.id, p.internal_name
`);
console.log("parked_low_yield", parkLow.rows);

// Copart full_collection > 24h with tiny new → hand off to listing_refresh
const copart = await c.query(`
  SELECT j.id, j.job_type, j.vins_new, j.started_at, j.job_config, j.provider_id
  FROM collection_jobs j
  JOIN providers p ON p.id=j.provider_id
  WHERE j.status='running' AND p.internal_name='copart'
    AND j.job_type='full_collection'
    AND j.started_at < NOW() - interval '24 hours'
`);
for (const row of copart.rows) {
  await c.query(
    `UPDATE collection_jobs SET status='completed', completed_at=NOW(),
     error_message='ops: completed long full to free slot; refresh follow-up',
     updated_at=NOW() WHERE id=$1`,
    [row.id],
  );
  const cfg = {
    repeatHours: 5,
    nextRunAt: new Date(Date.now() - 60_000).toISOString(),
    source: "ops_fleet_efficiency",
  };
  await c.query(
    `INSERT INTO collection_jobs (provider_id, job_type, status, job_config, created_at, updated_at)
     VALUES ($1, 'listing_refresh', 'pending', $2, NOW() - interval '20 days', NOW())`,
    [row.provider_id, JSON.stringify(cfg)],
  );
  console.log("copart_handoff", row.id, "vins_new", row.vins_new);
}

// Bump starved pending (new markets) to claim first
const starved = [
  "willhaben","autoplac","autoscout24","ontariocars","bidexport","sauto",
  "cars24ae","dubicars","otomoto","salvagebid","bringatrailer","iaa","thebidrive",
];
let i = 0;
for (const name of starved) {
  i += 1;
  await c.query(
    `UPDATE collection_jobs j
     SET created_at = NOW() - ($1 || ' days')::interval,
         job_config = (
           jsonb_set(COALESCE(NULLIF(j.job_config,'')::jsonb,'{}'::jsonb), '{nextRunAt}',
             to_jsonb(to_char((NOW() - interval '1 minute') AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
           )
         )::text,
         updated_at = NOW()
     WHERE j.status='pending'
       AND j.provider_id=(SELECT id FROM providers WHERE internal_name=$2)`,
    [String(25 - i), name],
  );
}

const summary = await c.query(`
  SELECT status, count(*)::int n FROM collection_jobs
  WHERE status IN ('pending','running') GROUP BY 1 ORDER BY 1
`);
const running = await c.query(`
  SELECT p.internal_name, j.id, j.job_type, j.vins_new,
         round(extract(epoch from (now()-j.updated_at))/60)::int quiet_min
  FROM collection_jobs j JOIN providers p ON p.id=j.provider_id
  WHERE j.status='running' ORDER BY 1
`);
console.log({ summary: summary.rows, running: running.rows });
await c.end();
