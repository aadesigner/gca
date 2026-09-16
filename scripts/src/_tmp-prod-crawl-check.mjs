import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => {
  const v = vars[n];
  return v && typeof v === "object" && "value" in v ? v.value : v;
};
const url = `postgresql://${encodeURIComponent(get("PGUSER") || get("POSTGRES_USER"))}:${encodeURIComponent(get("PGPASSWORD") || get("POSTGRES_PASSWORD"))}@${get("RAILWAY_TCP_PROXY_DOMAIN")}:${get("RAILWAY_TCP_PROXY_PORT")}/${get("PGDATABASE") || "railway"}`;
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();

const jobs = await c.query(`
  SELECT cj.id, p.internal_name, cj.job_type, cj.status,
    cj.pages_processed, cj.listings_fetched, cj.vins_new, cj.items_processed,
    ROUND(EXTRACT(EPOCH FROM (now()-cj.updated_at))/60.0,1) AS age_min,
    left(coalesce(cj.error_message,''), 60) AS err,
    left(coalesce(cj.job_config,''), 120) AS cfg
  FROM collection_jobs cj
  JOIN providers p ON p.id=cj.provider_id
  WHERE p.internal_name IN (
    'encar','import_motor','japanesecartrade','autoplac','ams','copart','iaa','finn','seobuk'
  )
  AND cj.status IN ('running','pending')
  ORDER BY p.internal_name, cj.updated_at DESC
`);
console.log("key_jobs", jobs.rows);

const pace = await c.query(`
  SELECT
    count(*) FILTER (WHERE created_at > now()-interval '30 minutes')::int AS listings_30m,
    count(*) FILTER (WHERE created_at > now()-interval '2 hours')::int AS listings_2h,
    count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC'))::int AS listings_today
  FROM listings
`);
console.log("pace", pace.rows[0]);

const byProv = await c.query(`
  SELECT p.internal_name,
    count(*) FILTER (WHERE l.created_at > now()-interval '2 hours')::int AS new_2h
  FROM listings l
  JOIN providers p ON p.id=l.provider_id
  WHERE l.created_at > now()-interval '2 hours'
  GROUP BY p.internal_name
  ORDER BY new_2h DESC
  LIMIT 12
`);
console.log("new_2h_by_provider", byProv.rows);

const stale = await c.query(`
  SELECT cj.id, p.internal_name, cj.status,
    ROUND(EXTRACT(EPOCH FROM (now()-cj.updated_at))/60.0,1) AS age_min
  FROM collection_jobs cj
  JOIN providers p ON p.id=cj.provider_id
  WHERE cj.status='running'
    AND cj.updated_at < now() - interval '90 minutes'
  ORDER BY cj.updated_at ASC
  LIMIT 15
`);
console.log("stale_running_90m", stale.rows);

await c.end();
