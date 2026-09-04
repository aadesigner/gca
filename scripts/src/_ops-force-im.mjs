import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query(`UPDATE collection_jobs SET status='paused' WHERE id IN (361,362) AND status IN ('running','pending')`);
await c.query(`
  UPDATE collection_jobs
  SET status='pending', updated_at=now()-interval '2 hours', error_message=NULL, completed_at=NULL
  WHERE id=360
`);
const r = await c.query(`SELECT id,status FROM collection_jobs WHERE status IN ('running','pending')`);
console.log(r.rows);
await c.end();
