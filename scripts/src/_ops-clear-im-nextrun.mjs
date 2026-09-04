import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(`SELECT id, status, job_config FROM collection_jobs WHERE id=360`);
const cfg = JSON.parse(r.rows[0].job_config || "{}");
console.log({
  status: r.rows[0].status,
  nextRunAt: cfg.nextRunAt,
  crawlMode: cfg.crawlMode,
  brands: cfg.brands?.length,
});
delete cfg.nextRunAt;
await c.query(
  `UPDATE collection_jobs SET status='pending', job_config=$1, updated_at=now()-interval '1 day' WHERE id=360`,
  [JSON.stringify(cfg)],
);
console.log("cleared nextRunAt");
await c.end();
