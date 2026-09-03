import pg from "pg";

const c = new pg.Client({
  host: process.env.PROD_PG_HOST ?? "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT ?? "15622"),
  user: process.env.PROD_PG_USER ?? "postgres",
  password: process.env.PGPASSWORD || process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE ?? "railway",
  ssl: false,
});
await c.connect();
const r = await c.query(`
  WITH seobuk AS (
    SELECT l.id, l.vehicle_id, v.vin,
      (SELECT count(*)::int FROM photos ph WHERE ph.listing_id = l.id) AS listing_photos,
      (SELECT count(*)::int FROM photos ph WHERE ph.vehicle_id = l.vehicle_id) AS vehicle_photos
    FROM listings l
    JOIN providers p ON p.id = l.provider_id
    JOIN vehicles v ON v.id = l.vehicle_id
    WHERE p.internal_name = 'seobuk'
  )
  SELECT
    count(*) FILTER (WHERE listing_photos = 0 AND vehicle_photos >= 8)::int AS zero_but_fat_vin,
    count(*) FILTER (WHERE listing_photos = 0 AND vehicle_photos < 8)::int AS zero_and_thin_vin,
    count(*) FILTER (WHERE listing_photos BETWEEN 1 AND 4 AND vehicle_photos >= 8)::int AS thin_listing_fat_vin,
    count(*) FILTER (WHERE listing_photos BETWEEN 1 AND 4 AND vehicle_photos < 8)::int AS thin_listing_thin_vin,
    count(*) FILTER (WHERE listing_photos >= 8)::int AS fat_listings
  FROM seobuk
`);
console.log(r.rows[0]);
const sample = await c.query(`
  SELECT v.vin,
         (SELECT count(*) FROM photos ph WHERE ph.listing_id=l.id) AS lp,
         (SELECT count(*) FROM photos ph WHERE ph.vehicle_id=l.vehicle_id) AS vp,
         (SELECT string_agg(DISTINCT p2.internal_name, ',')
            FROM listings l2 JOIN providers p2 ON p2.id=l2.provider_id
           WHERE l2.vehicle_id=l.vehicle_id) AS providers
  FROM listings l
  JOIN providers p ON p.id=l.provider_id
  JOIN vehicles v ON v.id=l.vehicle_id
  WHERE p.internal_name='seobuk'
    AND (SELECT count(*) FROM photos ph WHERE ph.listing_id=l.id) < 5
  ORDER BY (SELECT count(*) FROM photos ph WHERE ph.vehicle_id=l.vehicle_id) DESC
  LIMIT 10
`);
console.log("sample thin seobuk", sample.rows);
await c.end();
