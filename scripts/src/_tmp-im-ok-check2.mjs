import pg from "pg";
const c = new pg.Client({ connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip" });
await c.connect();
const jobs = await c.query(`
  SELECT id, status, updated_at, started_at,
         left(coalesce(error_message,''), 80) AS err,
         (SELECT count(*) FROM jsonb_array_elements(crawl_state::jsonb->'shards') s WHERE s->>'status'='pending') AS pending,
         (SELECT count(*) FROM jsonb_array_elements(crawl_state::jsonb->'shards') s WHERE s->>'status'='completed') AS completed,
         (SELECT count(*) FROM jsonb_array_elements(crawl_state::jsonb->'shards') s WHERE s->>'status'='active') AS active,
         crawl_state::jsonb->>'currentShardId' AS current
  FROM collection_jobs WHERE id IN (360,387,390) ORDER BY id
`);
console.log(jobs.rows);

const done = await c.query(`
  SELECT s->>'id' AS id, s->>'status' AS status,
         s->>'listingsFetched' AS fetched, s->>'pagesProcessed' AS pages,
         s->>'lastError' AS err
  FROM collection_jobs, jsonb_array_elements(crawl_state::jsonb->'shards') s
  WHERE id=360 AND s->>'status'='completed'
`);
console.log("completed_shards", done.rows);

const running = await c.query(`
  SELECT id, status, updated_at FROM collection_jobs
  WHERE status IN ('running','pending') ORDER BY status, id LIMIT 20
`);
console.log("live_jobs", running.rows);
await c.end();
