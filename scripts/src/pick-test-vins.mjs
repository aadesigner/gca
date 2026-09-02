/**
 * Find rich VINs with CDN photos for test-vins curation.
 * Usage: node --import ./scripts/load-env.mjs ./scripts/src/pick-test-vins.mjs [--prod]
 */
import pg from "pg";

const useProd = process.argv.includes("--prod");

const pool = useProd
  ? new pg.Pool({
      host: process.env.PROD_PG_HOST ?? "tokaido.proxy.rlwy.net",
      port: Number(process.env.PROD_PG_PORT ?? "11425"),
      user: process.env.PROD_PG_USER ?? "postgres",
      password: process.env.PROD_PG_PASSWORD,
      database: process.env.PROD_PG_DATABASE ?? "railway",
      ssl: process.env.PROD_PG_SSL === "1" ? { rejectUnauthorized: false } : false,
    })
  : new pg.Pool({ connectionString: process.env.DATABASE_URL });

if (useProd && !process.env.PROD_PG_PASSWORD) {
  console.error("Set PROD_PG_PASSWORD");
  process.exit(1);
}

const { rows: mirrorStats } = await pool.query(`
  SELECT
    count(*)::int AS total,
    count(*) FILTER (WHERE stored_path ~* 'imgsv\\.getcarapi\\.com|\\.r2\\.dev/')::int AS cdn,
    count(*) FILTER (WHERE stored_path IS NULL)::int AS pending
  FROM photos
`);

const { rows } = await pool.query(`
  WITH vin_stats AS (
    SELECT v.id, v.vin, v.make, v.model, v.year, v.country,
      (SELECT count(*) FROM photos p WHERE p.vehicle_id = v.id) AS photo_count,
      (SELECT count(*) FROM photos p WHERE p.vehicle_id = v.id AND p.stored_path ~* 'imgsv\\.getcarapi\\.com') AS cdn_photos,
      (SELECT count(*) FROM vehicle_observations o WHERE o.vehicle_id = v.id) AS obs_count,
      (SELECT count(*) FROM vehicle_events e WHERE e.vehicle_id = v.id) AS event_count,
      (SELECT string_agg(DISTINCT pr.internal_name, ', ' ORDER BY pr.internal_name)
       FROM listings l JOIN providers pr ON pr.id = l.provider_id WHERE l.vin = v.vin) AS providers
    FROM vehicles v
    WHERE v.vin IS NOT NULL AND length(v.vin) >= 11
  )
  SELECT * FROM vin_stats
  WHERE cdn_photos >= 3 AND obs_count >= 2
  ORDER BY cdn_photos DESC, event_count DESC, obs_count DESC
  LIMIT 80
`);

const current = [
  "1FA6P8CF5K5120103",
  "ZAM57XSA5H1238315",
  "WDDUX8GB8JA397509",
  "ZAM57XSA4E1123233",
  "WBS3C910XFP708160",
];

console.log(JSON.stringify({ db: useProd ? "prod" : "local", mirrorStats: mirrorStats[0], current: {} }, null, 2));

for (const vin of current) {
  const row = rows.find((r) => r.vin === vin) ?? (
    await pool.query(
      `SELECT v.vin, v.make, v.model, v.year,
        (SELECT count(*) FROM photos p WHERE p.vehicle_id = v.id) AS photo_count,
        (SELECT count(*) FROM photos p WHERE p.vehicle_id = v.id AND p.stored_path ~* 'imgsv\\.getcarapi\\.com') AS cdn_photos,
        (SELECT count(*) FROM vehicle_observations o WHERE o.vehicle_id = v.id) AS obs_count,
        (SELECT count(*) FROM vehicle_events e WHERE e.vehicle_id = v.id) AS event_count
       FROM vehicles v WHERE v.vin = $1`,
      [vin],
    )
  ).rows[0];
  console.log("\n--- CURRENT", vin, "---");
  console.log(row ?? "NOT FOUND");
}

console.log("\n=== USA (copart/iaa) ===");
for (const r of rows.filter((x) => /copart|iaa/.test(x.providers ?? "")).slice(0, 8)) {
  console.log(`${r.vin} | ${r.year} ${r.make} ${r.model} | cdn=${r.cdn_photos}/${r.photo_count} obs=${r.obs_count} ev=${r.event_count} | ${r.providers}`);
}

console.log("\n=== KOREA (encar) ===");
for (const r of rows.filter((x) => /encar/.test(x.providers ?? "")).slice(0, 8)) {
  console.log(`${r.vin} | ${r.year} ${r.make} ${r.model} | cdn=${r.cdn_photos}/${r.photo_count} obs=${r.obs_count} ev=${r.event_count} | ${r.providers}`);
}

console.log("\n=== DUBAI/UAE (dubicars) ===");
const { rows: dubicarsRows } = await pool.query(`
  SELECT v.vin, v.make, v.model, v.year, v.country,
    count(p.id)::int AS photo_count,
    count(p.id) FILTER (WHERE p.stored_path ~* 'imgsv\\.getcarapi\\.com')::int AS cdn_photos,
    (SELECT count(*)::int FROM vehicle_observations o WHERE o.vehicle_id = v.id) AS obs_count,
    (SELECT count(*)::int FROM vehicle_events e WHERE e.vehicle_id = v.id) AS event_count
  FROM vehicles v
  JOIN listings l ON l.vin = v.vin
  JOIN providers pr ON pr.id = l.provider_id
  LEFT JOIN photos p ON p.vehicle_id = v.id
  WHERE pr.internal_name = 'dubicars'
  GROUP BY v.id
  ORDER BY cdn_photos DESC, photo_count DESC, event_count DESC
  LIMIT 15
`);
for (const r of dubicarsRows) {
  console.log(`${r.vin} | ${r.year} ${r.make} ${r.model} | cdn=${r.cdn_photos}/${r.photo_count} obs=${r.obs_count} ev=${r.event_count}`);
}

console.log("\n=== CANADA (country or autotraderca) ===");
const { rows: canadaRows } = await pool.query(`
  SELECT v.vin, v.make, v.model, v.year,
    count(p.id)::int AS photo_count,
    count(p.id) FILTER (WHERE p.stored_path ~* 'imgsv\\.getcarapi\\.com')::int AS cdn_photos,
    (SELECT count(*)::int FROM vehicle_observations o WHERE o.vehicle_id = v.id) AS obs_count,
    (SELECT count(*)::int FROM vehicle_events e WHERE e.vehicle_id = v.id) AS event_count
  FROM vehicles v
  JOIN listings l ON l.vin = v.vin
  JOIN providers pr ON pr.id = l.provider_id
  LEFT JOIN photos p ON p.vehicle_id = v.id
  WHERE pr.internal_name = 'autotraderca' OR v.country ILIKE '%canada%'
  GROUP BY v.id
  HAVING count(p.id) FILTER (WHERE p.stored_path ~* 'imgsv\\.getcarapi\\.com') >= 1
  ORDER BY cdn_photos DESC, event_count DESC, obs_count DESC
  LIMIT 10
`);
for (const r of canadaRows) {
  console.log(`${r.vin} | ${r.year} ${r.make} ${r.model} | cdn=${r.cdn_photos}/${r.photo_count} obs=${r.obs_count} ev=${r.event_count}`);
}

console.log("\n=== AUTOWINI / export ===");
for (const r of rows.filter((x) => /autowini/.test(x.providers ?? "")).slice(0, 5)) {
  console.log(`${r.vin} | ${r.year} ${r.make} ${r.model} | cdn=${r.cdn_photos}/${r.photo_count} obs=${r.obs_count} ev=${r.event_count} | ${r.providers}`);
}

await pool.end();
