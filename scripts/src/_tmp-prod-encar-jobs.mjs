import fs from "node:fs";
import pg from "pg";

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const get = (n) => j[n];
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const jobs = await c.query(`
  SELECT j.id, j.job_type, j.status, j.pages_processed, j.listings_fetched, j.items_processed, j.vins_new,
         round(extract(epoch from (now()-j.updated_at))/60.0,1) AS quiet_m,
         left(coalesce(j.error_message,''),100) AS err,
         left(coalesce(j.job_config,''),320) AS cfg,
         left(coalesce(j.crawl_state::text,''),200) AS crawl_head
  FROM collection_jobs j
  JOIN providers p ON p.id=j.provider_id
  WHERE p.internal_name='encar'
  ORDER BY j.id DESC
  LIMIT 12
`);
console.log("encar_jobs", jobs.rows);

const settings = await c.query(`SELECT max_collection_jobs_parallel FROM settings WHERE id=1`);
console.log("parallel", settings.rows[0]);

const dups = await c.query(`
  SELECT p.internal_name, count(*) FILTER (WHERE j.status IN ('running','pending'))::int AS active
  FROM collection_jobs j
  JOIN providers p ON p.id=j.provider_id
  WHERE j.status IN ('running','pending')
  GROUP BY p.internal_name
  HAVING count(*) FILTER (WHERE j.status IN ('running','pending')) > 2
  ORDER BY active DESC
  LIMIT 15
`);
console.log("provider_active_gt2", dups.rows);

await c.end();
