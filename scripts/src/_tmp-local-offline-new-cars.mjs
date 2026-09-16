/**
 * Local offline-only new cars: import_motor, autoplac, japanesecartrade.
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

const OFFLINE = ["import_motor", "autoplac", "japanesecartrade"];

const vehicles24h = await c.query(
  `
  WITH first_listing AS (
    SELECT DISTINCT ON (l.vehicle_id)
      l.vehicle_id, l.provider_id
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
    AND p.internal_name = ANY($1::text[])
  GROUP BY 1
  ORDER BY new_vehicles_24h DESC
  `,
  [OFFLINE],
);

const listings24h = await c.query(
  `
  SELECT p.internal_name AS provider,
         count(*)::bigint AS new_listings_24h,
         count(DISTINCT l.vehicle_id)::bigint AS distinct_vehicles_touched_24h
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE l.created_at > now() - interval '24 hours'
    AND p.internal_name = ANY($1::text[])
  GROUP BY 1
  ORDER BY new_listings_24h DESC
  `,
  [OFFLINE],
);

const daily = await c.query(
  `
  WITH first_listing AS (
    SELECT DISTINCT ON (l.vehicle_id)
      l.vehicle_id, l.provider_id
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
    AND p.internal_name = ANY($1::text[])
  GROUP BY 1, 2
  ORDER BY 1 DESC, new_vehicles DESC
  `,
  [OFFLINE],
);

const jobs = await c.query(
  `
  SELECT j.id, p.internal_name, j.status, j.vins_new, j.items_processed, j.listings_fetched,
         round(extract(epoch from (now()-j.updated_at))/60.0,1) AS quiet_m
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE p.internal_name = ANY($1::text[])
    AND j.status IN ('running','pending','paused')
  ORDER BY p.internal_name, j.id DESC
  `,
  [OFFLINE],
);

const totals = vehicles24h.rows.reduce((s, r) => s + Number(r.new_vehicles_24h), 0);
const listTotals = listings24h.rows.reduce((s, r) => s + Number(r.new_listings_24h), 0);

console.log("=== Offline providers only (local) ===");
console.log({ new_vehicles_24h_total: totals, new_listings_24h_total: listTotals });
console.log("\nnew vehicles 24h (first-seen on that provider):");
console.log(vehicles24h.rows);
console.log("\nnew listings 24h:");
console.log(listings24h.rows);
console.log("\njobs:");
console.log(jobs.rows);

const byDay = new Map();
for (const r of daily.rows) {
  const day = String(r.day).slice(0, 10);
  if (!byDay.has(day)) byDay.set(day, { day, total: 0, parts: [] });
  const row = byDay.get(day);
  const n = Number(r.new_vehicles);
  row.total += n;
  row.parts.push(`${r.provider}:${n}`);
}
console.log("\n=== Daily new vehicles (UTC) — offline only ===");
for (const row of byDay.values()) {
  console.log(`${row.day} total=${row.total}  (${row.parts.join(" | ")})`);
}

await c.end();
