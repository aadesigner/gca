/**
 * Until deploy ships priority claim: make only Encar full due now;
 * defer other pending jobs so they don't starve #376.
 */
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
  user: get("PGUSER") || get("POSTGRES_USER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const ENCAR_FULL = 376;
const deferUntil = new Date(Date.now() + 90 * 60_000).toISOString();
const dueNow = new Date(Date.now() - 60_000).toISOString();

const deferred = await c.query(
  `
  UPDATE collection_jobs j
  SET job_config = CASE
        WHEN j.job_config IS NULL OR btrim(j.job_config) = '' THEN
          jsonb_build_object('nextRunAt', $2::text)::text
        WHEN j.job_config::text ~ '^\\s*\\{' THEN
          (j.job_config::jsonb || jsonb_build_object('nextRunAt', $2::text))::text
        ELSE j.job_config
      END,
      updated_at = NOW()
  FROM providers p
  WHERE j.provider_id = p.id
    AND j.status = 'pending'
    AND j.id <> $1
    AND p.internal_name <> 'encar'
  RETURNING j.id, p.internal_name, j.job_type
  `,
  [ENCAR_FULL, deferUntil],
);
console.log("deferred_pending", deferred.rowCount);

await c.query(
  `
  UPDATE collection_jobs
  SET status = 'pending',
      job_config = (COALESCE(job_config::jsonb, '{}'::jsonb) || jsonb_build_object(
        'nextRunAt', $2::text,
        'detailLevel', 'full',
        'concurrency', 4,
        'delayMs', 280,
        'skipRecentHours', 0
      ))::text,
      error_message = NULL,
      completed_at = NULL,
      updated_at = NOW()
  WHERE id = $1
  `,
  [ENCAR_FULL, dueNow],
);

const due = await c.query(`
  SELECT j.id, p.internal_name, j.job_type, j.status,
         j.job_config::jsonb->>'nextRunAt' AS next_run,
         length(coalesce(j.crawl_state::text,'')) AS crawl_len
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE j.status = 'pending'
    AND (
      j.job_config IS NULL
      OR j.job_config::jsonb->>'nextRunAt' IS NULL
      OR (j.job_config::jsonb->>'nextRunAt')::timestamptz <= NOW()
    )
  ORDER BY j.id
  LIMIT 30
`);
console.log("due_now", due.rows);

const running = await c.query(`
  SELECT j.id, p.internal_name, j.job_type,
         round(extract(epoch from (now()-j.updated_at))/60.0,1) AS quiet_m
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE j.status = 'running'
  ORDER BY quiet_m DESC
`);
console.log("running", running.rows);

await c.end();
