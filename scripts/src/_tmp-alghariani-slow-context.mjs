import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pg = require("../../lib/db/node_modules/pg");

const c = new pg.Client({
  host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT || 15622),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
});
await c.connect();

// Global API latency around his slow window
const window = await c.query(`
  SELECT
    date_trunc('minute', requested_at) AS minute,
    count(*)::int AS n,
    avg(duration_ms)::int AS avg_ms,
    max(duration_ms)::int AS max_ms,
    count(DISTINCT client_id)::int AS clients
  FROM api_request_logs
  WHERE requested_at >= '2026-09-06 13:50:00+00'
    AND requested_at <  '2026-09-06 15:00:00+00'
  GROUP BY 1 ORDER BY 1
`);
console.log("=== ALL API LATENCY 13:50-15:00 UTC Sep 6 ===");
for (const r of window.rows) {
  console.log(r.minute?.toISOString?.()?.slice(0, 16), `n=${r.n}`, `avg=${r.avg_ms}`, `max=${r.max_ms}`, `clients=${r.clients}`);
}

const jobs = await c.query(`
  SELECT id, provider_id, job_type, status, started_at, finished_at, error,
         pages_done, items_seen, items_new
  FROM collection_jobs
  WHERE (started_at >= '2026-09-06 12:00:00+00' AND started_at < '2026-09-06 16:00:00+00')
     OR (status IN ('running','pending') AND updated_at > '2026-09-06 12:00:00+00')
  ORDER BY started_at DESC NULLS LAST
  LIMIT 30
`).catch(async (e) => {
  console.log("jobs query fail", e.message);
  const cols = await c.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name='collection_jobs' ORDER BY 1
  `);
  console.log("cols", cols.rows.map((r) => r.column_name));
  return { rows: [] };
});
console.log("\n=== COLLECTION JOBS around window ===");
for (const j of jobs.rows) console.log(j);

// How heavy is the free test VIN?
const vin = "1FA6P8CF5K5120103";
const v = (await c.query(`SELECT id, make, model, year FROM vehicles WHERE vin=$1`, [vin])).rows[0];
if (v) {
  const counts = await c.query(
    `
    SELECT
      (SELECT count(*)::int FROM listings WHERE vin=$1) AS listings,
      (SELECT count(*)::int FROM photos WHERE vehicle_id=$2) AS photos,
      (SELECT count(*)::int FROM vehicle_observations WHERE vehicle_id=$2) AS obs,
      (SELECT count(*)::int FROM vehicle_events WHERE vehicle_id=$2) AS events
    `,
    [vin, v.id],
  );
  console.log("\n=== TEST VIN payload size ===", v, counts.rows[0]);
}

// Real VIN he hit with 402
const real = await c.query(`SELECT id, vin, make, model, year FROM vehicles WHERE vin='WDB2153731A021717'`);
console.log("\n402 VIN exists?", real.rows[0] || null);

await c.end();
