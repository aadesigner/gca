/**
 * Production CDN photo coverage audit.
 * Usage: PROD_PG_PASSWORD=... node --import ./scripts/load-env.mjs ./scripts/src/_ops-prod-photo-audit.mjs
 */
import pg from "pg";

const password = process.env.PROD_PG_PASSWORD;
if (!password) throw new Error("Set PROD_PG_PASSWORD");

const client = new pg.Client({
  host: process.env.PROD_PG_HOST ?? "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT ?? "15622"),
  user: "postgres",
  password,
  database: "railway",
  ssl: false,
  connectionTimeoutMillis: 30_000,
  statement_timeout: 120_000,
});
await client.connect();

function cdnExpr(col = "stored_path") {
  return `${col} ~* 'imgsv\\.getcarapi\\.com|\\.r2\\.dev/'`;
}

console.log("=== Production CDN photo audit ===\n");

const totals = await client.query(`
  SELECT
    count(*)::bigint AS total_photos,
    count(*) FILTER (WHERE ${cdnExpr("stored_path")})::bigint AS cdn_photos,
    count(*) FILTER (WHERE stored_path IS NULL AND source_url IS NOT NULL)::bigint AS pending_mirror,
    count(*) FILTER (WHERE stored_path IS NOT NULL AND NOT (${cdnExpr("stored_path")}))::bigint AS non_cdn_stored
  FROM photos
`);
console.log("All photos:", totals.rows[0]);

const vehicleCoverage = await client.query(`
  WITH per_vehicle AS (
    SELECT
      p.vehicle_id,
      count(*)::int AS photo_count,
      count(*) FILTER (WHERE ${cdnExpr("p.stored_path")})::int AS cdn_count,
      count(*) FILTER (WHERE p.stored_path IS NULL AND p.source_url IS NOT NULL)::int AS pending_count,
      count(*) FILTER (WHERE p.is_primary)::int AS primary_count,
      count(*) FILTER (WHERE p.is_primary AND ${cdnExpr("p.stored_path")})::int AS primary_cdn
    FROM photos p
    GROUP BY p.vehicle_id
  ),
  with_vin AS (
    SELECT v.vin, v.make, v.model, v.year, pv.*
    FROM per_vehicle pv
    JOIN vehicles v ON v.id = pv.vehicle_id
  )
  SELECT
    count(*)::int AS vehicles_with_photos,
    count(*) FILTER (WHERE cdn_count = 0)::int AS zero_cdn,
    count(*) FILTER (WHERE cdn_count = 1 AND photo_count > 1)::int AS only_one_cdn_of_many,
    count(*) FILTER (WHERE cdn_count > 0 AND cdn_count < photo_count)::int AS partial_cdn,
    count(*) FILTER (WHERE cdn_count = photo_count AND photo_count > 0)::int AS full_cdn,
    count(*) FILTER (WHERE pending_count > 0)::int AS has_pending_mirror,
    count(*) FILTER (WHERE primary_cdn = 0 AND photo_count > 0)::int AS primary_not_on_cdn,
    round(avg(cdn_count::numeric / nullif(photo_count, 0)), 3) AS avg_cdn_ratio
  FROM with_vin
`);
console.log("\nPer-vehicle coverage:", vehicleCoverage.rows[0]);

const activeListings = await client.query(`
  WITH per_vehicle AS (
    SELECT
      p.vehicle_id,
      count(*)::int AS photo_count,
      count(*) FILTER (WHERE ${cdnExpr("p.stored_path")})::int AS cdn_count
    FROM photos p
    GROUP BY p.vehicle_id
  ),
  active AS (
    SELECT DISTINCT l.vehicle_id
    FROM listings l
    WHERE l.is_active = true
  )
  SELECT
    count(*)::int AS active_vehicles_with_photos,
    count(*) FILTER (WHERE pv.cdn_count = 0)::int AS zero_cdn,
    count(*) FILTER (WHERE pv.cdn_count = 1 AND pv.photo_count > 1)::int AS only_one_cdn_of_many,
    count(*) FILTER (WHERE pv.cdn_count > 0 AND pv.cdn_count < pv.photo_count)::int AS partial_cdn,
    count(*) FILTER (WHERE pv.cdn_count = pv.photo_count)::int AS full_cdn
  FROM active a
  JOIN per_vehicle pv ON pv.vehicle_id = a.vehicle_id
`);
console.log("\nActive listing vehicles:", activeListings.rows[0]);

const recentSync = await client.query(`
  WITH per_vehicle AS (
    SELECT
      p.vehicle_id,
      count(*)::int AS photo_count,
      count(*) FILTER (WHERE ${cdnExpr("p.stored_path")})::int AS cdn_count
    FROM photos p
    GROUP BY p.vehicle_id
  )
  SELECT
    count(*)::int AS vehicles,
    count(*) FILTER (WHERE pv.cdn_count = 0)::int AS zero_cdn,
    count(*) FILTER (WHERE pv.cdn_count = 1 AND pv.photo_count > 1)::int AS only_one_cdn,
    count(*) FILTER (WHERE pv.cdn_count = pv.photo_count)::int AS full_cdn
  FROM vehicles v
  JOIN per_vehicle pv ON pv.vehicle_id = v.id
  WHERE v.created_at > now() - interval '7 days'
`);
console.log("\nVehicles created last 7d:", recentSync.rows[0]);

const samples = await client.query(`
  WITH per_vehicle AS (
    SELECT
      p.vehicle_id,
      count(*)::int AS photo_count,
      count(*) FILTER (WHERE ${cdnExpr("p.stored_path")})::int AS cdn_count
    FROM photos p
    GROUP BY p.vehicle_id
    HAVING count(*) > 3
      AND count(*) FILTER (WHERE ${cdnExpr("p.stored_path")}) = 1
  )
  SELECT v.vin, v.make, v.model, pv.photo_count, pv.cdn_count
  FROM per_vehicle pv
  JOIN vehicles v ON v.id = pv.vehicle_id
  ORDER BY pv.photo_count DESC
  LIMIT 8
`);
console.log("\nSample 'only 1 CDN of many' vehicles:");
for (const r of samples.rows) {
  console.log(`  ${r.vin} ${r.year ?? ""} ${r.make} ${r.model} — ${r.cdn_count}/${r.photo_count} on CDN`);
}

const zeroSamples = await client.query(`
  WITH per_vehicle AS (
    SELECT p.vehicle_id, count(*)::int AS photo_count
    FROM photos p
    GROUP BY p.vehicle_id
    HAVING count(*) FILTER (WHERE ${cdnExpr("p.stored_path")}) = 0
  )
  SELECT v.vin, v.make, v.model, pv.photo_count,
    (SELECT left(coalesce(p2.stored_path, p2.source_url), 70)
     FROM photos p2 WHERE p2.vehicle_id = v.id ORDER BY p2.is_primary DESC, p2.id LIMIT 1) AS sample_url
  FROM per_vehicle pv
  JOIN vehicles v ON v.id = pv.vehicle_id
  JOIN listings l ON l.vehicle_id = v.id AND l.is_active = true
  ORDER BY pv.photo_count DESC
  LIMIT 6
`);
console.log("\nSample active vehicles with ZERO CDN photos:");
for (const r of zeroSamples.rows) {
  console.log(`  ${r.vin} (${r.photo_count} photos) ${r.sample_url}`);
}

await client.end();
