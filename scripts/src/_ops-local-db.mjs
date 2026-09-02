import pg from "pg";

const c = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 15_000,
});
await c.connect();
const jobs = await c.query(`
  SELECT id, status, items_processed, pages_processed, items_discovered, error_message
  FROM collection_jobs WHERE id IN (360, 361, 362) ORDER BY id
`);
console.log("Key jobs:", jobs.rows);
const counts = await c.query(`
  SELECT status, count(*)::int FROM collection_jobs GROUP BY status ORDER BY status
`);
console.log("All job counts:", counts.rows);
await c.end();
