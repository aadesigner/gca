import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => {
  const v = vars[n];
  return v && typeof v === "object" && "value" in v ? v.value : v;
};
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

// Push our 3 to the absolute front of pending claim order
await c.query(`
  UPDATE collection_jobs j
  SET created_at = TIMESTAMP '2019-01-01',
      updated_at = NOW(),
      job_config = (
        jsonb_set(
          COALESCE(NULLIF(j.job_config, '')::jsonb, '{}'::jsonb),
          '{nextRunAt}',
          to_jsonb(to_char(NOW() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        )
      )::text
  FROM providers p
  WHERE j.provider_id = p.id
    AND p.internal_name = ANY($1::text[])
    AND j.status = 'pending'
`, [["finn", "seobuk", "koreaauto_auction"]]);

// Delay other pending (not running) so they don't fill slots first — except keep a few productive ones claimable later
await c.query(`
  UPDATE collection_jobs j
  SET job_config = (
        jsonb_set(
          COALESCE(NULLIF(j.job_config, '')::jsonb, '{}'::jsonb),
          '{nextRunAt}',
          to_jsonb(to_char((NOW() + interval '25 minutes') AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        )
      )::text,
      updated_at = NOW()
  FROM providers p
  WHERE j.provider_id = p.id
    AND j.status = 'pending'
    AND p.internal_name <> ALL($1::text[])
`, [["finn", "seobuk", "koreaauto_auction"]]);

// Free up to 3 running zero/low progress slots
const freed = await c.query(`
  UPDATE collection_jobs j
  SET status='pending', started_at=NULL, completed_at=NULL, updated_at=NOW(),
      error_message='ops: pause for new-provider kick',
      job_config = (
        jsonb_set(
          COALESCE(NULLIF(j.job_config, '')::jsonb, '{}'::jsonb),
          '{nextRunAt}',
          to_jsonb(to_char((NOW() + interval '25 minutes') AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        )
      )::text
  WHERE j.id IN (
    SELECT j2.id FROM collection_jobs j2
    JOIN providers p2 ON p2.id = j2.provider_id
    WHERE j2.status='running'
      AND COALESCE(j2.items_processed,0) < 50
      AND p2.internal_name <> ALL($1::text[])
    ORDER BY COALESCE(j2.items_processed,0) ASC, j2.updated_at ASC
    LIMIT 3
  )
  RETURNING j.id
`, [["finn", "seobuk", "koreaauto_auction", "bidexport", "thebidrive", "ontariocars"]]);
console.log("freedSlots", freed.rows);

await new Promise((r) => setTimeout(r, 35000));

const jobs = await c.query(`
  SELECT p.internal_name, j.id, j.status, j.items_processed, j.items_failed,
         round(extract(epoch from (NOW()-j.updated_at))/60)::int AS quiet_m,
         left(COALESCE(j.error_message,''),160) AS err
  FROM collection_jobs j
  JOIN providers p ON p.id=j.provider_id
  WHERE p.internal_name = ANY($1::text[])
    AND j.status IN ('running','pending','failed','completed')
    AND j.updated_at > NOW() - interval '3 hours'
  ORDER BY p.internal_name, j.updated_at DESC
`, [["finn", "seobuk", "koreaauto_auction"]]);
console.log("STATUS", jobs.rows);

const running = await c.query(`
  SELECT p.internal_name, j.id, j.items_processed, j.items_failed,
         round(extract(epoch from (NOW()-j.updated_at))/60)::int quiet_m
  FROM collection_jobs j JOIN providers p ON p.id=j.provider_id
  WHERE j.status='running'
  ORDER BY j.updated_at DESC
`);
console.log("RUNNING", running.rows);

await c.end();
