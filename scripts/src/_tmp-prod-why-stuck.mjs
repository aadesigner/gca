import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const counts = await c.query(`
  SELECT status, count(*)::int AS n
  FROM collection_jobs
  GROUP BY status
  ORDER BY n DESC
`);
console.log("status_counts", counts.rows);

const settings = await c.query(`
  SELECT key, left(value::text, 200) AS value
  FROM settings
  WHERE key ILIKE '%collector%' OR key ILIKE '%crawl%' OR key ILIKE '%fleet%' OR key ILIKE '%worker%'
  ORDER BY key
`);
console.log("settings", settings.rows);

// nextRunAt gating on pending jobs
const gated = await c.query(`
  SELECT
    count(*) FILTER (WHERE status='pending')::int AS pending,
    count(*) FILTER (
      WHERE status='pending'
        AND COALESCE(NULLIF(job_config,'')::jsonb->>'nextRunAt','') <> ''
        AND (NULLIF(job_config,'')::jsonb->>'nextRunAt')::timestamptz > now()
    )::int AS pending_future,
    count(*) FILTER (
      WHERE status='pending'
        AND (
          COALESCE(NULLIF(job_config,'')::jsonb->>'nextRunAt','') = ''
          OR (NULLIF(job_config,'')::jsonb->>'nextRunAt')::timestamptz <= now()
        )
    )::int AS pending_due_now,
    count(*) FILTER (WHERE status='running')::int AS running
  FROM collection_jobs
`);
console.log("claim_gate", gated.rows[0]);

const sampleDue = await c.query(`
  SELECT j.id, p.internal_name, j.job_type,
         NULLIF(j.job_config,'')::jsonb->>'nextRunAt' AS next_run,
         NULLIF(j.job_config,'')::jsonb->>'source' AS source,
         j.updated_at
  FROM collection_jobs j
  JOIN providers p ON p.id=j.provider_id
  WHERE j.status='pending'
  ORDER BY j.updated_at DESC
  LIMIT 12
`);
console.log("pending_sample", sampleDue.rows);

const recentVehicles = await c.query(`
  SELECT
    count(*) FILTER (WHERE created_at > now()-interval '30 minutes')::int AS v_30m,
    count(*) FILTER (WHERE created_at > now()-interval '2 hours')::int AS v_2h,
    count(*) FILTER (WHERE created_at > now()-interval '24 hours')::int AS v_24h
  FROM vehicles
`);
console.log("vehicles", recentVehicles.rows[0]);

const recentListings = await c.query(`
  SELECT date_trunc('hour', created_at) AS hour, count(*)::int AS n
  FROM listings
  WHERE created_at > now() - interval '8 hours'
  GROUP BY 1
  ORDER BY 1 DESC
`);
console.log("listings_by_hour", recentListings.rows);

await c.end();
