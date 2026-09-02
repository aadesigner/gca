/** What the public VIN API actually returns for photo counts. */
import pg from "pg";

const password = process.env.PROD_PG_PASSWORD;
if (!password) throw new Error("PROD_PG_PASSWORD required");

const c = new pg.Client({
  host: process.env.PROD_PG_HOST ?? "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT ?? "15622"),
  user: "postgres",
  password,
  database: "railway",
  ssl: false,
  connectionTimeoutMillis: 30_000,
  statement_timeout: 180_000,
});
await c.connect();

const isCdn = `stored_path ~* 'imgsv\\.getcarapi\\.com|\\.r2\\.dev/'`;
const isIm = `source_url ~* 'import-motor\\.com'`;

const apiVisible = await c.query(`
  WITH per_vehicle AS (
    SELECT
      p.vehicle_id,
      count(*)::int AS db_photos,
      count(*) FILTER (WHERE ${isCdn})::int AS cdn_photos,
      count(*) FILTER (
        WHERE ${isCdn}
          OR (source_url ~* '^https?://' AND NOT (${isIm}))
      )::int AS api_visible_photos,
      count(*) FILTER (
        WHERE NOT (${isCdn})
          AND (source_url IS NULL OR ${isIm})
      )::int AS hidden_until_mirror
    FROM photos p
    GROUP BY p.vehicle_id
  ),
  active AS (
    SELECT DISTINCT vehicle_id FROM listings WHERE is_active = true AND vehicle_id IS NOT NULL
  )
  SELECT
    count(*)::int AS active_with_photos,
    count(*) FILTER (WHERE api_visible_photos = 0)::int AS api_shows_zero_photos,
    count(*) FILTER (WHERE cdn_photos = 0 AND api_visible_photos > 0)::int AS has_provider_urls_no_cdn,
    count(*) FILTER (WHERE cdn_photos = 1 AND db_photos > 1)::int AS only_one_cdn,
    count(*) FILTER (WHERE cdn_photos > 0 AND cdn_photos < db_photos)::int AS partial_cdn,
    count(*) FILTER (WHERE cdn_photos = db_photos AND db_photos > 0)::int AS full_cdn,
    round(avg(cdn_photos::numeric / nullif(db_photos, 0)), 3) AS avg_cdn_per_car
  FROM per_vehicle pv
  JOIN active a ON a.vehicle_id = pv.vehicle_id
`);
console.log("Active listings — what API clients see:", apiVisible.rows[0]);

const imBlocked = await c.query(`
  WITH per_vehicle AS (
    SELECT vehicle_id,
      count(*)::int AS db_photos,
      count(*) FILTER (WHERE ${isCdn})::int AS cdn
    FROM photos
    GROUP BY vehicle_id
    HAVING count(*) FILTER (WHERE ${isCdn}) = 0
      AND count(*) FILTER (WHERE ${isIm}) > 0
  )
  SELECT count(*)::int AS vehicles_im_only_no_cdn
  FROM per_vehicle
`);
console.log("\nAll vehicles: Import Motor photos only, zero CDN (API shows 0 photos):", imBlocked.rows[0]);

await c.end();
