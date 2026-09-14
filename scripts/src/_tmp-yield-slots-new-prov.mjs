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

const status = await c.query(`
  SELECT p.internal_name, j.id, j.status, j.items_processed, j.created_at, j.updated_at,
         left(COALESCE(j.error_message,''),120) err
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE p.internal_name = ANY($1::text[])
    AND j.status IN ('running','pending')
  ORDER BY p.internal_name, j.id DESC
`, [["finn", "seobuk", "koreaauto_auction"]]);
console.log("NEW_PROV_JOBS", status.rows);

// Yield slots: demote zero-progress runners (delay their nextRunAt)
const yielded = await c.query(`
  UPDATE collection_jobs j
  SET status = 'pending',
      started_at = NULL,
      completed_at = NULL,
      updated_at = NOW(),
      error_message = 'ops: yield slot to new providers',
      job_config = (
        jsonb_set(
          COALESCE(NULLIF(j.job_config, '')::jsonb, '{}'::jsonb),
          '{nextRunAt}',
          to_jsonb(to_char((NOW() + interval '20 minutes') AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        )
      )::text
  FROM providers p
  WHERE j.provider_id = p.id
    AND j.status = 'running'
    AND COALESCE(j.items_processed, 0) = 0
    AND p.internal_name NOT IN ('finn','seobuk','koreaauto_auction','bringatrailer','bidexport','thebidrive','ontariocars','encar')
  RETURNING j.id, p.internal_name
`);
console.log("yielded", yielded.rows);

// Make priority jobs oldest + due now
const bump = await c.query(`
  UPDATE collection_jobs j
  SET created_at = NOW() - interval '14 days',
      updated_at = NOW(),
      status = 'pending',
      started_at = NULL,
      completed_at = NULL,
      error_message = NULL,
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
    AND j.status IN ('pending','running')
  RETURNING j.id, p.internal_name, j.status
`, [["finn", "seobuk", "koreaauto_auction"]]);
console.log("bumped", bump.rows);

const head = await c.query(`
  SELECT p.internal_name, j.id, j.status, j.items_processed, j.created_at
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE j.status IN ('running','pending')
  ORDER BY CASE j.status WHEN 'running' THEN 0 ELSE 1 END, j.created_at ASC
  LIMIT 15
`);
console.log("head", head.rows);
await c.end();
