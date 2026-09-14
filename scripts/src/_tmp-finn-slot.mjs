import fs from "node:fs";
import pg from "pg";
const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => { const v = vars[n]; return v && typeof v === "object" && "value" in v ? v.value : v; };
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

// Cap parallel if needed, free quiet/zombie KAA duplicates + quiet seobuk 487
const running = await c.query(`
  SELECT j.id, p.internal_name, j.items_processed, j.items_failed,
         round(extract(epoch from (NOW()-j.updated_at))/60)::int quiet_m, j.updated_at
  FROM collection_jobs j JOIN providers p ON p.id=j.provider_id
  WHERE j.status='running' ORDER BY j.updated_at ASC
`);
console.log("runningBefore", running.rows);

// Pause quiet runners (>3m quiet) except keep one seobuk if active
const paused = await c.query(`
  UPDATE collection_jobs j
  SET status='pending', started_at=NULL, completed_at=NULL, updated_at=NOW(),
      error_message='ops: yield for Finn 491',
      job_config = jsonb_set(
        COALESCE(NULLIF(j.job_config,'')::jsonb,'{}'::jsonb),
        '{nextRunAt}',
        to_jsonb(to_char((NOW()+interval '15 minutes') AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      )::text
  WHERE j.id IN (
    SELECT j2.id FROM collection_jobs j2
    JOIN providers p2 ON p2.id=j2.provider_id
    WHERE j2.status='running'
      AND j2.updated_at < NOW() - interval '3 minutes'
      AND p2.internal_name <> 'finn'
    ORDER BY j2.updated_at ASC
    LIMIT 3
  )
  RETURNING j.id
`);
console.log("pausedQuiet", paused.rows);

// Ensure Finn 491 is claimable first
await c.query(`
  UPDATE collection_jobs
  SET created_at=TIMESTAMP '2018-01-01', updated_at=NOW(),
      job_config = jsonb_set(
        COALESCE(NULLIF(job_config,'')::jsonb,'{}'::jsonb),
        '{nextRunAt}',
        to_jsonb(to_char(NOW() AT TIME ZONE 'utc','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
      )::text
  WHERE id=491
`);

await c.end();
