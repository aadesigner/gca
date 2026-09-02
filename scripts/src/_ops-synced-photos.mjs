import pg from "pg";

const pgPass = process.env.PROD_PG_PASSWORD;
if (!pgPass) throw new Error("PROD_PG_PASSWORD required");

const prod = new pg.Client({
  host: process.env.PROD_PG_HOST ?? "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT ?? "15622"),
  user: "postgres",
  password: pgPass,
  database: "railway",
  ssl: false,
  connectionTimeoutMillis: 20_000,
});
await prod.connect();

const synced = await prod.query(`
  SELECT count(*)::int AS photos,
    count(*) FILTER (WHERE stored_path ~* 'imgsv\\.getcarapi\\.com')::int AS cdn,
    count(*) FILTER (WHERE stored_path IS NULL)::int AS pending_mirror,
    count(*) FILTER (WHERE stored_path IS NOT NULL AND stored_path !~* 'imgsv\\.getcarapi\\.com')::int AS other_host
  FROM photos
  WHERE created_at > now() - interval '90 minutes'
`);
console.log("Photos inserted ~last 90m (includes sync):", synced.rows[0]);

const sample = await prod.query(`
  SELECT v.vin, p.is_primary, left(coalesce(p.stored_path,p.source_url),80) AS url
  FROM photos p
  JOIN vehicles v ON v.id = p.vehicle_id
  WHERE p.created_at > now() - interval '90 minutes'
  ORDER BY random() LIMIT 8
`);
console.log("\nRandom sample URLs:");
for (const r of sample.rows) console.log(`  ${r.vin} primary=${r.is_primary} ${r.url}`);

await prod.end();
