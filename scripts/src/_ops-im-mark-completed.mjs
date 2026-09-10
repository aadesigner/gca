import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(
  `UPDATE collection_jobs
   SET status='completed', completed_at=NOW(), updated_at=NOW(), error_message=NULL
   WHERE id=360 AND status IN ('pending','running')
   RETURNING id, status`,
);
console.log("updated", r.rows);
await c.end();
