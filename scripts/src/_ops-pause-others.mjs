import pg from "pg";

const KEEP = new Set([360, 361, 362]);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(
  `
  UPDATE collection_jobs
  SET status='paused', updated_at=now()
  WHERE status IN ('running','pending') AND NOT (id = ANY($1::int[]))
  RETURNING id
`,
  [[...KEEP]],
);
console.log("paused", r.rows.map((x) => x.id));
await c.end();
