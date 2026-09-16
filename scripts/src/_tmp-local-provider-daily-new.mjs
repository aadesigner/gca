/**
 * Local: new cars (vehicles) + new listings per provider — 24h and last 7 days by day.
 */
import pg from "pg";

const url =
  process.env.DATABASE_URL ||
  "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable";
const c = new pg.Client({
  connectionString: url.includes("sslmode=")
    ? url
    : `${url}${url.includes("?") ? "&" : "?"}sslmode=disable`,
});
await c.connect();

// New vehicles attributed to the provider of their earliest listing (first-seen source).
const vehicles24h = await c.query(`
  WITH first_listing AS (
    SELECT DISTINCT ON (l.vehicle_id)
      l.vehicle_id,
      l.provider_id,
      l.created_at AS first_listing_at
    FROM listings l
    WHERE l.vehicle_id IS NOT NULL
    ORDER BY l.vehicle_id, l.created_at ASC, l.id ASC
  )
  SELECT p.internal_name AS provider,
         count(*)::bigint AS new_vehicles_24h
  FROM vehicles v
  JOIN first_listing fl ON fl.vehicle_id = v.id
  JOIN providers p ON p.id = fl.provider_id
  WHERE v.created_at > now() - interval '24 hours'
  GROUP BY 1
  ORDER BY new_vehicles_24h DESC
`);

// Simpler: vehicles linked to listings created in 24h (can double-count multi-provider VINs)
const listingsTouched = await c.query(`
  SELECT p.internal_name AS provider,
         count(*)::bigint AS new_listings_24h,
         count(*) FILTER (WHERE l.is_active)::bigint AS active_new_24h,
         count(DISTINCT l.vehicle_id)::bigint AS distinct_vehicles_touched_24h
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE l.created_at > now() - interval '24 hours'
  GROUP BY 1
  ORDER BY new_listings_24h DESC
`);

// Daily new vehicles by first-seen provider (last 7 days, calendar day local-ish UTC)
const daily = await c.query(`
  WITH first_listing AS (
    SELECT DISTINCT ON (l.vehicle_id)
      l.vehicle_id,
      l.provider_id
    FROM listings l
    WHERE l.vehicle_id IS NOT NULL
    ORDER BY l.vehicle_id, l.created_at ASC, l.id ASC
  )
  SELECT (v.created_at AT TIME ZONE 'UTC')::date AS day,
         p.internal_name AS provider,
         count(*)::bigint AS new_vehicles
  FROM vehicles v
  JOIN first_listing fl ON fl.vehicle_id = v.id
  JOIN providers p ON p.id = fl.provider_id
  WHERE v.created_at > now() - interval '7 days'
  GROUP BY 1, 2
  ORDER BY 1 DESC, new_vehicles DESC
`);

const totals = await c.query(`
  SELECT
    (SELECT count(*)::bigint FROM vehicles WHERE created_at > now() - interval '24 hours') AS vehicles_24h,
    (SELECT count(*)::bigint FROM listings WHERE created_at > now() - interval '24 hours') AS listings_24h
`);

console.log("=== LOCAL totals last 24h ===");
console.log(totals.rows[0]);

console.log("\n=== New vehicles 24h (first-seen provider) ===");
console.log(vehicles24h.rows);

console.log("\n=== New listings 24h (by provider) ===");
console.log(listingsTouched.rows);

// Pivot last few days totals
const byDay = new Map();
for (const r of daily.rows) {
  const day = String(r.day).slice(0, 10);
  if (!byDay.has(day)) byDay.set(day, { day, total: 0, providers: [] });
  const row = byDay.get(day);
  const n = Number(r.new_vehicles);
  row.total += n;
  row.providers.push(`${r.provider}:${n}`);
}
console.log("\n=== Daily new vehicles (UTC day, first-seen provider) ===");
for (const row of byDay.values()) {
  console.log(`${row.day} total=${row.total}`);
  console.log("  " + row.providers.slice(0, 15).join(" | "));
}

await c.end();
