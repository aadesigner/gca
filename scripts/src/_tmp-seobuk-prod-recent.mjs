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
const recent = await c.query(`
  SELECT l.id, v.vin, l.updated_at, count(ph.id)::int AS photos,
    count(ph.id) FILTER (WHERE ph.source_url ILIKE '%images/user%')::int AS user_pngs
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  JOIN vehicles v ON v.id = l.vehicle_id
  LEFT JOIN photos ph ON ph.listing_id = l.id
  WHERE p.internal_name = 'seobuk'
  GROUP BY l.id, v.vin, l.updated_at
  ORDER BY l.updated_at DESC
  LIMIT 12
`);
console.log("PROD recently updated seobuk", recent.rows);
await c.end();
