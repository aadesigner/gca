import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pg = require("../../lib/db/node_modules/pg");

const c = new pg.Client({
  host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT || 15622),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
});
await c.connect();

const jobs = await c.query(`
  SELECT j.id, p.internal_name, j.job_type, j.status, j.started_at, j.completed_at,
         j.pages_processed, j.items_processed, j.error_message
  FROM collection_jobs j
  LEFT JOIN providers p ON p.id = j.provider_id
  WHERE j.started_at >= '2026-09-06 12:00:00+00'
    AND j.started_at <  '2026-09-06 17:00:00+00'
  ORDER BY j.started_at
  LIMIT 40
`);
console.log("jobs Sep6 12-17 UTC:");
for (const j of jobs.rows) {
  console.log(
    j.started_at?.toISOString?.()?.slice(0, 19),
    j.status,
    j.internal_name,
    j.job_type,
    `pages=${j.pages_processed}`,
    `items=${j.items_processed}`,
    (j.error_message || "").slice(0, 60),
  );
}

const running = await c.query(`
  SELECT j.id, p.internal_name, j.job_type, j.status, j.started_at, j.updated_at,
         j.pages_processed, j.items_processed
  FROM collection_jobs j
  LEFT JOIN providers p ON p.id = j.provider_id
  WHERE j.status IN ('running','pending')
  ORDER BY j.updated_at DESC NULLS LAST
  LIMIT 20
`);
console.log("\ncurrently running/pending:");
for (const j of running.rows) console.log(j.internal_name, j.status, j.job_type, j.updated_at?.toISOString?.());

await c.end();
