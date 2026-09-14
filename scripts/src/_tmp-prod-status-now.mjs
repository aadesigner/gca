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

const force = process.argv.includes("--force-runners");

if (force) {
  const r = await c.query(`
    UPDATE collection_jobs j
    SET status = 'pending',
        started_at = NULL,
        completed_at = NULL,
        error_message = 'ops: force unstick all runners',
        job_config = (
          jsonb_set(
            COALESCE(NULLIF(j.job_config, '')::jsonb, '{}'::jsonb),
            '{nextRunAt}',
            to_jsonb(to_char(NOW() AT TIME ZONE 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
          )
          #- '{resetCrawlState}'
        )::text,
        updated_at = NOW()
    WHERE j.status = 'running'
    RETURNING j.id,
      (SELECT internal_name FROM providers p WHERE p.id = j.provider_id) AS name,
      round(extract(epoch from (NOW() - j.updated_at))/60.0,1) AS was_quiet_m
  `);
  console.log(JSON.stringify({ forced: r.rows }, null, 2));
}

const runners = await c.query(`
  SELECT j.id, p.internal_name AS name, j.status, j.job_type,
    round(extract(epoch from (NOW() - j.updated_at))/60.0,1) AS quiet_m,
    round(extract(epoch from (NOW() - coalesce(j.started_at, j.updated_at)))/60.0,1) AS age_m,
    left(coalesce(j.error_message,''),100) AS err
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE j.status IN ('running','pending')
  ORDER BY j.status DESC, quiet_m DESC NULLS LAST
`);

const intake = await c.query(`
  SELECT
    (SELECT count(*)::int FROM listings WHERE created_at > NOW() - interval '15 minutes') AS listings_15m,
    (SELECT count(*)::int FROM listings WHERE created_at > NOW() - interval '5 minutes') AS listings_5m,
    (SELECT count(*)::int FROM photos WHERE created_at > NOW() - interval '15 minutes') AS photos_15m,
    (SELECT count(*)::int FROM collection_jobs WHERE status='running' AND updated_at > NOW() - interval '2 minutes') AS runners_hot_2m,
    (SELECT count(*)::int FROM collection_jobs WHERE status='running' AND updated_at < NOW() - interval '5 minutes') AS runners_quiet_5m
`);

console.log(JSON.stringify({ intake: intake.rows[0], jobs: runners.rows }, null, 2));
await c.end();
