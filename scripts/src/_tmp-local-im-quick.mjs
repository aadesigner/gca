import pg from "pg";

const c = new pg.Client({
  connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable",
  connectionTimeoutMillis: 5000,
});
await c.connect();
await c.query("SET statement_timeout = 20000");
const im = await c.query(`
  SELECT j.id, j.status, j.job_type,
    COALESCE(j.items_processed,0)::int proc,
    round(extract(epoch from (NOW()-j.updated_at))/60)::int quiet_m
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE p.internal_name = 'import_motor'
  ORDER BY j.updated_at DESC
  LIMIT 3
`);
console.log("im", im.rows);
const recent = await c.query(`
  SELECT count(*)::int photos_2h
  FROM photos
  WHERE created_at > NOW() - interval '2 hours'
`);
console.log("photos2h", recent.rows[0]);
await c.end();
