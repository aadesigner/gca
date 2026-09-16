import pg from "pg";
const c = new pg.Client({
  connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable",
});
await c.connect();
const run = await c.query(`
  SELECT j.id, p.internal_name, j.status
  FROM collection_jobs j JOIN providers p ON p.id=j.provider_id
  WHERE j.status='running' ORDER BY j.id
`);
console.log("running", run.rows);
await c.query(`
  UPDATE collection_jobs
  SET status='pending',
      started_at=NULL,
      completed_at=NULL,
      error_message=NULL,
      updated_at=NOW()-interval '2 days',
      created_at=LEAST(created_at, NOW()-interval '3 days'),
      job_config=(COALESCE(job_config::jsonb,'{}'::jsonb) - 'nextRunAt')::text
  WHERE id=360
`);
await new Promise((r) => setTimeout(r, 20000));
const j = await c.query(`
  SELECT id, status, listings_fetched, items_processed, vins_new,
         round(extract(epoch from (now()-updated_at))/60.0,1) AS quiet_m,
         crawl_state::jsonb->>'currentShardId' AS shard,
         left(coalesce(error_message,''),100) AS err
  FROM collection_jobs WHERE id=360
`);
console.log("im", j.rows[0]);
const intake = await c.query(`
  SELECT count(*)::int AS n FROM listings l
  JOIN providers p ON p.id=l.provider_id
  WHERE p.internal_name='import_motor' AND l.created_at > now() - interval '15 minutes'
`);
console.log("im_listings_15m", intake.rows[0]);
await c.end();
