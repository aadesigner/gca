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
WITH spin AS (
  SELECT p.vehicle_id, p.listing_id,
    COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})(?:%7E|~)SID', 'i'))[1]
    ) AS stock
  FROM photos p WHERE p.photo_group IN ('exterior_3d','interior_3d')
),
gal AS (
  SELECT p.vehicle_id, p.listing_id,
    (regexp_match(p.source_url, '/iaai/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1] AS stock
  FROM photos p WHERE p.photo_group='gallery' AND p.source_url ILIKE '%/iaai/%'
),
ok AS (
  SELECT g.vehicle_id, g.stock
  FROM gal g JOIN spin s ON s.vehicle_id=g.vehicle_id AND s.stock=g.stock
  GROUP BY g.vehicle_id, g.stock
)
SELECT v.vin, v.make, v.model, v.year, o.stock,
  count(*) FILTER (WHERE p.photo_group='gallery')::int gal,
  count(*) FILTER (WHERE p.photo_group='exterior_3d')::int ext,
  count(*) FILTER (WHERE p.photo_group='interior_3d')::int int,
  count(DISTINCT COALESCE(
    (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
    (regexp_match(p.source_url, 'imageKeys=(\\d{6,})(?:%7E|~)SID', 'i'))[1],
    (regexp_match(p.source_url, '/iaai/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
  )) FILTER (WHERE p.photo_group IN ('exterior_3d','interior_3d','gallery'))::int stocks
FROM ok o
JOIN vehicles v ON v.id=o.vehicle_id
JOIN photos p ON p.vehicle_id=v.id
GROUP BY v.id, v.vin, v.make, v.model, v.year, o.stock
HAVING count(*) FILTER (WHERE p.photo_group='exterior_3d') >= 10
   AND count(*) FILTER (WHERE p.photo_group='interior_3d') >= 8
   AND count(DISTINCT COALESCE(
     (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
     (regexp_match(p.source_url, 'imageKeys=(\\d{6,})(?:%7E|~)SID', 'i'))[1],
     (regexp_match(p.source_url, '/iaai/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1]
   )) FILTER (WHERE p.photo_group IN ('exterior_3d','interior_3d','gallery')) = 1
ORDER BY ext DESC, int DESC
LIMIT 5
`);
console.log(r.rows);
await c.end();
