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
  SELECT photo_group, count(*)::int n, min(sort_order) mn, max(sort_order) mx,
    count(DISTINCT COALESCE(
      (regexp_match(source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(source_url, 'imageKeys=(\\d{6,})(?:%7E|~)SID', 'i'))[1],
      (regexp_match(source_url, '/iaai/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
    ))::int stocks
  FROM photos p JOIN vehicles v ON v.id=p.vehicle_id
  WHERE v.vin='WP0AB2A92TS227786'
  GROUP BY 1 ORDER BY 1
`);
console.log(r.rows);
const multi = await c.query(`
  SELECT count(*)::int n FROM (
    SELECT listing_id FROM photos
    WHERE photo_group IN ('exterior_3d','interior_3d') AND listing_id IS NOT NULL
    GROUP BY listing_id
    HAVING count(DISTINCT COALESCE(
      (regexp_match(source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(source_url, 'imageKeys=(\\d{6,})(?:%7E|~)SID', 'i'))[1]
    )) > 1
  ) t
`);
console.log("multiStockListings", multi.rows[0]);
await c.end();
