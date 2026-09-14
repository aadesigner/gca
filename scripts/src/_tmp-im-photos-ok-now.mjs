/**
 * Are we getting the RIGHT car's photos from IM now?
 */
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
await c.query("SET statement_timeout = 60000");

const recent = await c.query(`
WITH r AS (
  SELECT l.id, l.source_id, v.vin,
    count(*) FILTER (WHERE p.photo_group='gallery')::int gal,
    count(*) FILTER (WHERE p.photo_group='gallery' AND p.source_url ILIKE '%vis.iaai.com%')::int iaa,
    count(*) FILTER (WHERE p.photo_group='gallery' AND p.source_url ILIKE '%cs.copart.com%')::int copart,
    count(*) FILTER (WHERE p.photo_group='gallery' AND p.source_url ILIKE '%import-motor.com%')::int imcdn,
    count(*) FILTER (
      WHERE (regexp_match(p.source_url, '/([A-HJ-NPR-Z0-9]{17})-\\d+', 'i'))[1] IS NOT NULL
        AND upper((regexp_match(p.source_url, '/([A-HJ-NPR-Z0-9]{17})-\\d+', 'i'))[1]) <> upper(v.vin)
    )::int wrong_vin_path,
    count(*) FILTER (WHERE p.photo_group='exterior_3d')::int ext,
    max(p.created_at) last_photo
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE pr.internal_name = 'import_motor'
    AND p.created_at > NOW() - interval '30 minutes'
  GROUP BY 1,2,3
)
SELECT count(*)::int listings,
  round(avg(gal)::numeric,1) avg_gal,
  count(*) FILTER (WHERE gal >= 10)::int rich10,
  count(*) FILTER (WHERE gal >= 15)::int rich15,
  count(*) FILTER (WHERE iaa >= 8)::int iaa_rich,
  count(*) FILTER (WHERE copart >= 8)::int copart_rich,
  count(*) FILTER (WHERE imcdn > 0 AND iaa=0 AND copart=0)::int cars_only,
  count(*) FILTER (WHERE wrong_vin_path > 0)::int wrong_vin_listings,
  sum(wrong_vin_path)::int wrong_vin_photos,
  count(*) FILTER (WHERE ext > 0)::int with_360
FROM r
`);
console.log("last30m", recent.rows[0]);

const sentra = await c.query(`
  SELECT v.vin, v.make, v.model, v.year, v.color, l.source_id,
    count(*) FILTER (WHERE p.photo_group='gallery') gal,
    count(*) FILTER (WHERE p.photo_group='exterior_3d') ext,
    count(*) FILTER (WHERE p.photo_group='interior_3d') int,
    count(*) FILTER (
      WHERE (regexp_match(p.source_url, '/([A-HJ-NPR-Z0-9]{17})-\\d+', 'i'))[1] IS NOT NULL
        AND upper((regexp_match(p.source_url, '/([A-HJ-NPR-Z0-9]{17})-\\d+', 'i'))[1]) <> upper(v.vin)
    ) wrong_path,
    min(left(p.source_url, 120)) FILTER (WHERE p.photo_group='gallery') sample
  FROM vehicles v
  JOIN listings l ON l.vehicle_id = v.id
  JOIN providers pr ON pr.id = l.provider_id
  LEFT JOIN photos p ON p.listing_id = l.id
  WHERE v.vin = '3N1AB7AP6KY202307' AND pr.internal_name = 'import_motor'
  GROUP BY 1,2,3,4,5,6
`);
console.log("checkVin", sentra.rows[0]);

const stockMatch = await c.query(`
  SELECT
    (regexp_match(l.source_id, '^im-(\\d+)$', 'i'))[1] AS im_lot,
    COALESCE(
      (regexp_match(p.source_url, 'partitionKey=(\\d+)', 'i'))[1],
      (regexp_match(p.source_url, 'imageKeys=(\\d+)', 'i'))[1]
    ) AS stock,
    p.photo_group,
    count(*)::int n
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE v.vin = '3N1AB7AP6KY202307'
  GROUP BY 1,2,3
  ORDER BY 3,4 DESC
`);
console.log("sentraStocks", stockMatch.rows);

await c.end();
