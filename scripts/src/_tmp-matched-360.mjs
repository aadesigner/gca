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

// Extract lot from gallery /iaai/.../LOT/ and from spin URLs; require overlap
const q = await c.query(`
WITH spin AS (
  SELECT p.vehicle_id, p.listing_id,
    COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d{6,})', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1]
    ) AS stock
  FROM photos p
  WHERE p.photo_group IN ('exterior_3d','interior_3d')
    AND p.source_url ~* 'iaai|mediaretriever'
),
gal AS (
  SELECT p.vehicle_id, p.listing_id,
    COALESCE(
      (regexp_match(p.source_url, '/iaai/[^/]+/[^/]+/\\d{4}/(\\d{6,})/', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d{6,})', 'i'))[1]
    ) AS stock
  FROM photos p
  WHERE p.photo_group = 'gallery'
    AND (
      p.source_url ILIKE '%/iaai/%'
      OR p.source_url ILIKE '%vis.iaai%'
      OR p.source_url ILIKE '%mediaretriever.iaai%'
    )
    AND p.source_url NOT ILIKE '%/copart/%'
),
matched AS (
  SELECT g.vehicle_id, g.listing_id, g.stock
  FROM gal g
  JOIN spin s ON s.vehicle_id = g.vehicle_id AND s.stock = g.stock
  WHERE g.stock IS NOT NULL
  GROUP BY 1,2,3
)
SELECT v.vin, v.make, v.model, v.year, m.stock,
  count(*) FILTER (WHERE p.photo_group='gallery')::int gal,
  count(*) FILTER (WHERE p.photo_group='exterior_3d')::int ext,
  count(*) FILTER (WHERE p.photo_group='interior_3d')::int int,
  count(*) FILTER (WHERE p.photo_group IN ('exterior_3d','interior_3d') AND COALESCE(p.stored_path,'')<>'')::int spin_cdn
FROM matched m
JOIN vehicles v ON v.id = m.vehicle_id
JOIN photos p ON p.vehicle_id = v.id
GROUP BY v.id, v.vin, v.make, v.model, v.year, m.stock
HAVING count(*) FILTER (WHERE p.photo_group='exterior_3d') >= 16
ORDER BY spin_cdn DESC, ext DESC
LIMIT 12
`);
console.log(JSON.stringify(q.rows, null, 2));
await c.end();
