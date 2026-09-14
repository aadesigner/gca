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
  user: get("PGUSER") || get("POSTGRES_USER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || get("POSTGRES_DB") || "railway",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 25000,
});
await c.connect();

const dups = await c.query(`
  WITH ranked AS (
    SELECT j.id,
           ROW_NUMBER() OVER (
             PARTITION BY j.provider_id
             ORDER BY
               CASE WHEN j.error_message LIKE 'ops: force%' THEN 1 ELSE 0 END,
               j.updated_at DESC NULLS LAST,
               j.id DESC
           ) AS rn
    FROM collection_jobs j
    WHERE j.status = 'pending'
  )
  UPDATE collection_jobs j
  SET status = 'cancelled',
      completed_at = NOW(),
      updated_at = NOW(),
      error_message = 'ops: cancel duplicate pending (post-force)'
  FROM ranked r
  WHERE j.id = r.id AND r.rn > 1
  RETURNING j.id, (SELECT internal_name FROM providers p WHERE p.id = j.provider_id) AS name
`);

await c.query(`UPDATE settings SET max_collection_jobs_parallel = 8, updated_at = NOW() WHERE id = 1`);

await c.query(`
  UPDATE collection_jobs j
  SET job_config = (
        jsonb_set(
          COALESCE(NULLIF(j.job_config, '')::jsonb, '{}'::jsonb),
          '{nextRunAt}',
          to_jsonb(to_char(NOW() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        )
        #- '{resetCrawlState}'
      )::text,
      updated_at = NOW(),
      created_at = LEAST(created_at, NOW() - interval '2 hours')
  WHERE j.status = 'pending'
`);

console.log(JSON.stringify({ cancelledDups: dups.rows }, null, 2));
await c.end();
