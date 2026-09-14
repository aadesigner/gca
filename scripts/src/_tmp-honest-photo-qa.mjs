/**
 * Honest QA: right images + 360 coverage + offline fullness signals.
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
await c.query("SET statement_timeout = 90000");

const imListings = await c.query(`
  SELECT count(*)::int total,
    count(*) FILTER (WHERE NOT EXISTS (
      SELECT 1 FROM photos p WHERE p.listing_id = l.id AND p.photo_group = 'gallery'
    ))::int no_gallery,
    count(*) FILTER (WHERE (
      SELECT count(*) FROM photos p WHERE p.listing_id = l.id AND p.photo_group = 'gallery'
    ) BETWEEN 1 AND 4)::int thin_1_4,
    count(*) FILTER (WHERE (
      SELECT count(*) FROM photos p WHERE p.listing_id = l.id AND p.photo_group = 'gallery'
    ) BETWEEN 5 AND 7)::int mid_5_7,
    count(*) FILTER (WHERE (
      SELECT count(*) FROM photos p WHERE p.listing_id = l.id AND p.photo_group = 'gallery'
    ) >= 8)::int gal_ge8,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM photos p WHERE p.listing_id = l.id AND p.photo_group = 'exterior_3d'
    ))::int has_ext360,
    count(*) FILTER (WHERE EXISTS (
      SELECT 1 FROM photos p WHERE p.listing_id = l.id AND p.photo_group = 'interior_3d'
    ))::int has_int360
  FROM listings l
  JOIN providers pr ON pr.id = l.provider_id
  WHERE pr.internal_name = 'import_motor'
`);
console.log("imAll", imListings.rows[0]);

const recent = await c.query(`
WITH r AS (
  SELECT l.id,
    count(*) FILTER (WHERE p.photo_group='gallery')::int gal,
    count(*) FILTER (WHERE p.photo_group='gallery' AND p.source_url ILIKE '%vis.iaai.com%')::int iaa,
    count(*) FILTER (WHERE p.photo_group='gallery' AND p.source_url ILIKE '%cs.copart.com%')::int copart,
    count(*) FILTER (WHERE p.photo_group='gallery' AND p.source_url ILIKE '%import-motor.com%')::int imcdn,
    count(*) FILTER (WHERE p.photo_group='exterior_3d')::int ext,
    count(*) FILTER (WHERE p.photo_group='interior_3d')::int int
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  WHERE pr.internal_name = 'import_motor'
    AND p.created_at > NOW() - interval '2 hours'
  GROUP BY l.id
)
SELECT count(*)::int listings,
  round(avg(gal)::numeric,1) avg_gal,
  count(*) FILTER (WHERE gal < 5)::int thin,
  count(*) FILTER (WHERE gal >= 8)::int rich,
  count(*) FILTER (WHERE iaa >= 8)::int iaa_rich,
  count(*) FILTER (WHERE copart >= 8)::int copart_rich,
  count(*) FILTER (WHERE imcdn > 0 AND iaa = 0 AND copart = 0)::int cars_only,
  count(*) FILTER (WHERE ext > 0)::int with_ext360,
  count(*) FILTER (WHERE int > 0)::int with_int360
FROM r
`);
console.log("imRecent2h", recent.rows[0]);

const gti = await c.query(`
  SELECT count(p.id)::int photos,
    count(*) FILTER (WHERE p.photo_group='gallery')::int gal,
    count(*) FILTER (WHERE p.photo_group='exterior_3d')::int ext,
    count(*) FILTER (WHERE p.photo_group='interior_3d')::int int
  FROM vehicles v
  LEFT JOIN photos p ON p.vehicle_id = v.id
  WHERE v.vin = 'WVWED71K98W309297'
`);
console.log("gti", gti.rows[0]);

// Wrong-VIN cars2 path on IM (hard wrong-car signal)
const wrongVin = await c.query(`
  SELECT count(*)::int n
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE pr.internal_name = 'import_motor'
    AND p.source_url ~* '/[A-HJ-NPR-Z0-9]{17}-'
    AND upper(substring(p.source_url from '/([A-HJ-NPR-Z0-9]{17})-[0-9]+')) <> upper(v.vin)
  LIMIT 1
`);
// The above may be slow; use a bounded recent check instead if needed
console.log("wrongVinPathCheckStarted");

const wrongVinRecent = await c.query(`
  SELECT count(*)::int n
  FROM (
    SELECT v.vin, p.source_url,
      (regexp_match(p.source_url, '/([A-HJ-NPR-Z0-9]{17})-\\d+', 'i'))[1] AS path_vin
    FROM photos p
    JOIN listings l ON l.id = p.listing_id
    JOIN providers pr ON pr.id = l.provider_id
    JOIN vehicles v ON v.id = l.vehicle_id
    WHERE pr.internal_name = 'import_motor'
      AND p.created_at > NOW() - interval '2 hours'
      AND p.source_url ILIKE '%import-motor.com%'
  ) s
  WHERE path_vin IS NOT NULL AND upper(path_vin) <> upper(vin)
`);
console.log("wrongVinInPath_2h", wrongVinRecent.rows[0]);

await c.end();
