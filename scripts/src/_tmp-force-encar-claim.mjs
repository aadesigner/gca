import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) =>
  vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n];

const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const due = await c.query(`
  SELECT j.id, p.internal_name, j.job_type,
         j.job_config::jsonb->>'nextRunAt' AS next_run,
         CASE
           WHEN j.job_config IS NULL OR j.job_config::jsonb->>'nextRunAt' IS NULL THEN true
           WHEN (j.job_config::jsonb->>'nextRunAt')::timestamptz <= NOW() THEN true
           ELSE false
         END AS is_due
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE j.status = 'pending'
  ORDER BY is_due DESC, j.id
  LIMIT 40
`);
console.log("pending", due.rows);

// Pause quiet low-progress runners to free slots (preserve crawl_state via pause→pending later)
const pause = await c.query(`
  UPDATE collection_jobs
  SET status = 'paused',
      error_message = COALESCE(error_message, 'paused to free slot for encar full'),
      updated_at = NOW()
  WHERE id IN (226, 322)
    AND status = 'running'
  RETURNING id, status
`);
console.log("paused", pause.rows);

await new Promise((r) => setTimeout(r, 15_000));

const s = await c.query(`
  SELECT j.id, p.internal_name, j.job_type, j.status,
         j.listings_fetched, j.items_processed,
         round(extract(epoch from (now()-j.updated_at))/60.0,1) AS quiet_m,
         left(coalesce(j.error_message,''),80) AS err
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE j.id IN (376, 226, 322) OR j.status = 'running'
  ORDER BY j.status, j.id
`);
console.log("after", s.rows);

const parallel = await c.query(`SELECT max_collection_jobs_parallel FROM settings WHERE id=1`);
console.log("parallel", parallel.rows[0]);

await c.end();
