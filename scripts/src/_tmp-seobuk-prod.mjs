import pg from "pg";

const password = process.env.PGPASSWORD || process.env.PROD_PG_PASSWORD;
if (!password) {
  console.log("NO_PROD_PASSWORD");
  process.exit(0);
}
const c = new pg.Client({
  host: process.env.PROD_PG_HOST ?? "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT ?? "15622"),
  user: process.env.PROD_PG_USER ?? "postgres",
  password,
  database: process.env.PROD_PG_DATABASE ?? "railway",
  ssl: false,
  connectionTimeoutMillis: 20_000,
});
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
console.log("PROD seobuk listings", r.rows[0]);
await c.end();
