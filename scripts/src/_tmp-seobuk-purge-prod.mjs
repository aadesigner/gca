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
const del = await c.query(`
  DELETE FROM photos ph
  USING listings l, providers p
  WHERE ph.listing_id = l.id
    AND l.provider_id = p.id
    AND p.internal_name = 'seobuk'
    AND (
      ph.source_url ILIKE '%.gif%'
      OR ph.source_url ILIKE '%/assets/custom/%'
    )
  RETURNING ph.id
`);
console.log("PROD purged junk photos", del.rowCount);
await c.end();
