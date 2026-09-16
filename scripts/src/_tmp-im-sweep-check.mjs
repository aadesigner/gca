import pg from "pg";
const u =
  process.env.DATABASE_URL ||
  "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable";
const c = new pg.Client({
  connectionString: u.includes("sslmode=") ? u : `${u}?sslmode=disable`,
});
await c.connect();
const r = await c.query(`
  SELECT id, status, listings_fetched, items_processed, vins_new,
         round(extract(epoch from (now()-updated_at))/60.0,1) AS quiet_m,
         crawl_state::jsonb->>'currentShardId' AS shard,
         job_config::jsonb->>'source' AS source,
         job_config::jsonb->>'newCarsSweep' AS sweep
  FROM collection_jobs WHERE id=360
`);
console.log(r.rows[0]);
await c.end();
