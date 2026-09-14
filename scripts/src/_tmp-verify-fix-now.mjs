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
const gti = await c.query(`
  SELECT p.photo_group, count(*)::int n,
    count(*) FILTER (WHERE source_url ILIKE '%vis.iaai%') iaa,
    count(*) FILTER (WHERE source_url ILIKE '%import-motor.com%') im,
    min(left(source_url,100)) sample
  FROM photos p JOIN vehicles v ON v.id=p.vehicle_id
  WHERE v.vin='WVWED71K98W309297'
  GROUP BY 1 ORDER BY 1
`);
console.log("gti", gti.rows);
const stocks = await c.query(`
  SELECT DISTINCT COALESCE(
    (regexp_match(source_url,'imageKeys=(\\d+)','i'))[1],
    (regexp_match(source_url,'/(?:iaai|copart)/[^/]+/[^/]+/\\d{4}/(\\d+)/','i'))[1]
  ) stock
  FROM photos p JOIN vehicles v ON v.id=p.vehicle_id
  WHERE v.vin='WVWED71K98W309297'
`);
console.log("stocks", stocks.rows);
const fleet = await c.query(`
  SELECT count(*) FILTER (WHERE status='running')::int running,
         count(*) FILTER (WHERE status='pending')::int pending,
         count(*) FILTER (WHERE status='running' AND updated_at < NOW()-interval '10 minutes')::int quiet10
  FROM collection_jobs WHERE status IN ('running','pending')
`);
console.log("fleet", fleet.rows[0]);
await c.end();
