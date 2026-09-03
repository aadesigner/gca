import pg from "pg";

const c = new pg.Client({
  host: process.env.PROD_PG_HOST ?? "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT ?? "15622"),
  user: process.env.PROD_PG_USER ?? "postgres",
  password: process.env.PGPASSWORD || process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE ?? "railway",
  ssl: false,
  connectionTimeoutMillis: 20_000,
});
await c.connect();
const r = await c.query(`
  WITH seobuk AS (
    SELECT l.id AS listing_id, l.vehicle_id, v.vin,
      count(ph.id)::int AS listing_photos
    FROM listings l
    JOIN providers p ON p.id = l.provider_id
    JOIN vehicles v ON v.id = l.vehicle_id
    LEFT JOIN photos ph ON ph.listing_id = l.id
    WHERE p.internal_name = 'seobuk'
    GROUP BY l.id, l.vehicle_id, v.vin
  )
  SELECT
    count(*)::int AS listings,
    count(*) FILTER (WHERE listing_photos < 5 AND COALESCE(vp.n,0) < 5)::int AS vin_and_listing_thin,
    count(*) FILTER (WHERE listing_photos < 5 AND COALESCE(vp.n,0) >= 5)::int AS listing_thin_vin_ok,
    count(*) FILTER (WHERE listing_photos >= 5)::int AS listing_ok,
    round(avg(listing_photos)::numeric,1) AS avg_listing_photos,
    round(avg(COALESCE(vp.n,0))::numeric,1) AS avg_vehicle_photos
  FROM seobuk s
  LEFT JOIN (
    SELECT vehicle_id, count(*)::int AS n FROM photos GROUP BY vehicle_id
  ) vp ON vp.vehicle_id = s.vehicle_id
`);
console.log("PROD seobuk listing vs vehicle photos", r.rows[0]);
const sample = await c.query(`
  SELECT s.vin, s.listing_photos, COALESCE(vp.n,0)::int AS vehicle_photos
  FROM (
    SELECT l.id, l.vehicle_id, v.vin, count(ph.id)::int AS listing_photos
    FROM listings l
    JOIN providers p ON p.id = l.provider_id
    JOIN vehicles v ON v.id = l.vehicle_id
    LEFT JOIN photos ph ON ph.listing_id = l.id
    WHERE p.internal_name = 'seobuk'
    GROUP BY l.id, l.vehicle_id, v.vin
  ) s
  LEFT JOIN (SELECT vehicle_id, count(*)::int AS n FROM photos GROUP BY vehicle_id) vp
    ON vp.vehicle_id = s.vehicle_id
  WHERE s.listing_photos <= 1
  ORDER BY COALESCE(vp.n,0) ASC, s.vin
  LIMIT 15
`);
console.log("PROD thin seobuk samples (listing<=1)", sample.rows);
await c.end();
