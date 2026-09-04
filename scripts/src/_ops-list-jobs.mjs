import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(`
  SELECT id, status, updated_at
  FROM collection_jobs
  WHERE status IN ('running','pending')
  ORDER BY status, id
`);
console.log(r.rows);
await c.end();
