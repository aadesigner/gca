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
const r = await c.query(`
  SELECT p.internal_name, j.id, j.status, j.job_type,
         j.items_processed, j.items_failed, j.vins_new,
         round(extract(epoch from (NOW()-j.updated_at))/60)::int quiet_m
  FROM collection_jobs j JOIN providers p ON p.id=j.provider_id
  WHERE j.status='running'
  ORDER BY j.updated_at DESC
`);
console.log(r.rows);
await c.end();
