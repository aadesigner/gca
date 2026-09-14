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
const finn = await c.query(`SELECT id,status,items_discovered,items_processed,items_failed,vins_new,pages_processed,started_at,updated_at FROM collection_jobs WHERE id=491`);
console.log("finn491", finn.rows[0]);
const g = await c.query(`
  SELECT count(*) FILTER (WHERE first_seen_at>NOW()-interval '10 minutes')::int new10,
         count(*) FILTER (WHERE last_seen_at>NOW()-interval '10 minutes')::int seen10
  FROM listings WHERE provider_id=(SELECT id FROM providers WHERE internal_name='finn')
`);
console.log("finnListings10m", g.rows[0]);
const snap = await c.query(`
  SELECT p.internal_name, j.id, j.status, j.items_processed, j.items_failed, j.vins_new,
         round(extract(epoch from (NOW()-j.updated_at))/60)::int quiet_m
  FROM collection_jobs j JOIN providers p ON p.id=j.provider_id
  WHERE p.internal_name = ANY(ARRAY['finn','seobuk','koreaauto_auction'])
    AND j.status IN ('running','pending')
  ORDER BY p.internal_name, j.updated_at DESC
`);
console.log("newProv", snap.rows);
await c.end();
