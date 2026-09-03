import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL missing");
const c = new pg.Client({ connectionString: url, connectionTimeoutMillis: 15_000 });
await c.connect();
const r = await c.query(`
  SELECT
    count(*) FILTER (WHERE l.id IS NOT NULL)::int AS listings,
    count(DISTINCT l.vin)::int AS vins,
    round(avg(COALESCE(pc.n, 0))::numeric, 1) AS avg_photos,
    max(COALESCE(pc.n, 0))::int AS max_photos,
    count(*) FILTER (WHERE COALESCE(pc.n, 0) = 0)::int AS zero_photos,
    count(*) FILTER (WHERE COALESCE(pc.n, 0) = 1)::int AS one_photo,
    count(*) FILTER (WHERE COALESCE(pc.n, 0) BETWEEN 2 AND 4)::int AS two_to_four,
    count(*) FILTER (WHERE COALESCE(pc.n, 0) >= 5)::int AS five_plus
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  LEFT JOIN (
    SELECT listing_id, count(*)::int AS n FROM photos GROUP BY listing_id
  ) pc ON pc.listing_id = l.id
  WHERE p.internal_name = 'seobuk'
`);
const hosts = await c.query(`
  SELECT
    CASE
      WHEN ph.source_url ILIKE '%seobuk.org/assets/admin/images/user%' THEN 'seobuk-user'
      WHEN ph.source_url ILIKE '%carmanager%' THEN 'carmanager'
      WHEN ph.source_url ILIKE '%imgsv.getcarapi%' THEN 'cdn-source'
      WHEN ph.stored_path ILIKE '%imgsv.getcarapi%' THEN 'cdn-stored'
      ELSE 'other'
    END AS kind,
    count(*)::int AS n
  FROM photos ph
  JOIN listings l ON l.id = ph.listing_id
  JOIN providers p ON p.id = l.provider_id
  WHERE p.internal_name = 'seobuk'
  GROUP BY 1
  ORDER BY n DESC
`);
const sample = await c.query(`
  SELECT l.id, v.vin, count(ph.id)::int AS photos
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  LEFT JOIN photos ph ON ph.listing_id = l.id
  WHERE p.internal_name = 'seobuk'
  GROUP BY l.id, v.vin
  ORDER BY photos ASC, l.id
  LIMIT 8
`);
console.log("LOCAL seobuk listings", r.rows[0]);
console.log("LOCAL photo kinds", hosts.rows);
console.log("LOCAL thinnest", sample.rows);
await c.end();
