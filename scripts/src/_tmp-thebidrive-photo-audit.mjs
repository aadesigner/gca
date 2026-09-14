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
  password: get("PGPASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 25000,
});
await c.connect();
await c.query("SET statement_timeout='90s'");

const stats = await c.query(`
  SELECT
    count(*)::int AS total_listings,
    count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM photos ph WHERE ph.listing_id = l.id))::int AS no_photos,
    count(*) FILTER (WHERE EXISTS (SELECT 1 FROM photos ph WHERE ph.listing_id = l.id))::int AS with_photos,
    count(*) FILTER (WHERE l.created_at > NOW() - interval '24 hours')::int AS created_24h,
    count(*) FILTER (
      WHERE l.created_at > NOW() - interval '24 hours'
        AND NOT EXISTS (SELECT 1 FROM photos ph WHERE ph.listing_id = l.id)
    )::int AS created_24h_no_photos,
    count(*) FILTER (
      WHERE l.created_at > NOW() - interval '7 days'
        AND NOT EXISTS (SELECT 1 FROM photos ph WHERE ph.listing_id = l.id)
    )::int AS created_7d_no_photos
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'thebidrive'
`);

const jobs = await c.query(`
  SELECT j.id, j.status, j.items_processed, j.vins_found, j.vins_new, j.pages_processed,
    round(extract(epoch from (NOW()-j.updated_at))/60,1) AS quiet_m
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE p.internal_name = 'thebidrive' AND j.status IN ('running','pending','completed')
  ORDER BY j.updated_at DESC LIMIT 5
`);

const sample = await c.query(`
  SELECT l.id, l.source_id, l.vin, l.created_at,
    (SELECT count(*)::int FROM photos ph WHERE ph.listing_id = l.id) AS photo_count
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'thebidrive'
    AND NOT EXISTS (SELECT 1 FROM photos ph WHERE ph.listing_id = l.id)
  ORDER BY l.created_at DESC
  LIMIT 10
`);

const thin = await c.query(`
  SELECT l.id, l.source_id, l.vin, l.created_at,
    (SELECT count(*)::int FROM photos ph WHERE ph.listing_id = l.id) AS photo_count
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'thebidrive'
    AND (SELECT count(*) FROM photos ph WHERE ph.listing_id = l.id) BETWEEN 1 AND 2
  ORDER BY l.created_at DESC
  LIMIT 10
`);

console.log(JSON.stringify({ stats: stats.rows[0], jobs: jobs.rows, sampleNoPhotos: sample.rows, thinRecent: thin.rows }, null, 2));
await c.end();
