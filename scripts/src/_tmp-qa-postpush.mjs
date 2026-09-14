/**
 * Post-push QA: fleet + IM gallery fullness + lot/fotorama health.
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

const fleet = await c.query(`
  SELECT count(*) FILTER (WHERE status='running')::int running,
         count(*) FILTER (WHERE status='pending')::int pending,
         count(*) FILTER (WHERE status='running' AND updated_at < NOW()-interval '20 minutes')::int quiet20
  FROM collection_jobs WHERE status IN ('running','pending')
`);
console.log("fleet", fleet.rows[0]);

const running = await c.query(`
  SELECT p.internal_name, j.id, j.job_type,
    COALESCE(j.items_processed,0)::int proc,
    COALESCE(j.items_failed,0)::int fail,
    round(extract(epoch from (NOW()-j.updated_at))/60)::int quiet_m
  FROM collection_jobs j JOIN providers p ON p.id=j.provider_id
  WHERE j.status='running'
  ORDER BY j.updated_at ASC
`);
console.log("running", running.rows);

const imJobs = await c.query(`
  SELECT j.id, j.status, j.job_type,
    COALESCE(j.items_processed,0)::int proc,
    COALESCE(j.items_failed,0)::int fail,
    round(extract(epoch from (NOW()-j.updated_at))/60)::int quiet_m
  FROM collection_jobs j JOIN providers p ON p.id=j.provider_id
  WHERE p.internal_name='import_motor'
  ORDER BY j.updated_at DESC LIMIT 4
`);
console.log("imJobs", imJobs.rows);

// Recent IM photos: fullness + foreign-stock outside cars2 VIN path
const recent = await c.query(`
WITH recent_listings AS (
  SELECT l.id, l.source_id, v.vin, max(p.created_at) last_photo,
    count(*) FILTER (WHERE p.photo_group='gallery')::int gal,
    count(*) FILTER (WHERE p.photo_group='gallery' AND p.source_url ILIKE '%vis.iaai.com%')::int gal_iaa,
    count(*) FILTER (WHERE p.photo_group='gallery' AND p.source_url ILIKE '%import-motor.com%')::int gal_im,
    count(*) FILTER (WHERE p.photo_group IN ('exterior_3d','interior_3d'))::int spin
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE pr.internal_name = 'import_motor'
    AND p.created_at > NOW() - interval '45 minutes'
  GROUP BY l.id, l.source_id, v.vin
)
SELECT
  count(*)::int listings,
  round(avg(gal)::numeric,1) avg_gal,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY gal) med_gal,
  count(*) FILTER (WHERE gal >= 8)::int gal_ge8,
  count(*) FILTER (WHERE gal < 5)::int gal_lt5,
  count(*) FILTER (WHERE gal_iaa >= 8)::int iaa_ge8,
  count(*) FILTER (WHERE gal_im > 0 AND gal_iaa = 0)::int cars2_only,
  count(*) FILTER (WHERE spin > 0)::int with_spin
FROM recent_listings
`);
console.log("imRecent45m", recent.rows[0]);

const thin = await c.query(`
WITH recent_listings AS (
  SELECT l.id, l.source_id, v.vin,
    count(*) FILTER (WHERE p.photo_group='gallery')::int gal,
    count(*) FILTER (WHERE p.photo_group='gallery' AND p.source_url ILIKE '%vis.iaai.com%')::int gal_iaa,
    count(*) FILTER (WHERE p.photo_group='gallery' AND p.source_url ILIKE '%import-motor.com%')::int gal_im
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE pr.internal_name = 'import_motor'
    AND p.created_at > NOW() - interval '45 minutes'
  GROUP BY l.id, l.source_id, v.vin
  HAVING count(*) FILTER (WHERE p.photo_group='gallery') < 6
  ORDER BY count(*) FILTER (WHERE p.photo_group='gallery') ASC
  LIMIT 8
)
SELECT * FROM recent_listings
`);
console.log("thinSamples", thin.rows);

const samples = await c.query(`
WITH recent_listings AS (
  SELECT l.id, l.source_id, v.vin, max(p.created_at) last_photo,
    count(*) FILTER (WHERE p.photo_group='gallery')::int gal,
    count(*) FILTER (WHERE p.photo_group='gallery' AND p.source_url ILIKE '%vis.iaai.com%')::int gal_iaa
  FROM photos p
  JOIN listings l ON l.id = p.listing_id
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  WHERE pr.internal_name = 'import_motor'
    AND p.created_at > NOW() - interval '45 minutes'
  GROUP BY l.id, l.source_id, v.vin
  ORDER BY max(p.created_at) DESC
  LIMIT 10
)
SELECT vin, source_id, gal, gal_iaa, last_photo FROM recent_listings
`);
console.log("latestSamples", samples.rows);

const gti = await c.query(`
  SELECT l.source_id, count(p.id)::int photos,
    count(*) FILTER (WHERE p.photo_group='gallery')::int gal
  FROM listings l
  JOIN providers pr ON pr.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  LEFT JOIN photos p ON p.listing_id = l.id
  WHERE v.vin = 'WVWED71K98W309297' AND pr.internal_name = 'import_motor'
  GROUP BY 1
`);
console.log("gti", gti.rows);

const focus = await c.query(`
  SELECT p.internal_name, j.id, j.status, j.job_type,
    COALESCE(j.items_processed,0)::int proc,
    COALESCE(j.items_failed,0)::int fail,
    round(extract(epoch from (NOW()-j.updated_at))/60)::int quiet_m
  FROM providers p
  LEFT JOIN LATERAL (
    SELECT * FROM collection_jobs cj
    WHERE cj.provider_id=p.id AND cj.status IN ('running','pending')
    ORDER BY CASE cj.status WHEN 'running' THEN 0 ELSE 1 END, cj.updated_at DESC
    LIMIT 1
  ) j ON true
  WHERE p.internal_name = ANY($1::text[])
  ORDER BY 1
`, [["finn","seobuk","koreaauto_auction","import_motor","copart","autowini","encar"]]);
console.log("focus", focus.rows);

await c.end();
