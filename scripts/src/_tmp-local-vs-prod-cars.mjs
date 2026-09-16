/**
 * Local vs prod: crawl pulse + vehicle/listing inventory deltas.
 */
import fs from "node:fs";
import pg from "pg";

function prodClient() {
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const v = j.variables || j;
  const g = (n) => (v[n] && typeof v[n] === "object" && "value" in v[n] ? v[n].value : v[n]);
  return new pg.Client({
    host: g("RAILWAY_TCP_PROXY_DOMAIN"),
    port: Number(g("RAILWAY_TCP_PROXY_PORT")),
    user: g("PGUSER") || g("POSTGRES_USER") || "postgres",
    password: g("PGPASSWORD") || g("POSTGRES_PASSWORD"),
    database: g("PGDATABASE") || "railway",
    ssl: { rejectUnauthorized: false },
  });
}

function localClient() {
  const url =
    process.env.DATABASE_URL ||
    "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable";
  return new pg.Client({
    connectionString: url.includes("sslmode=")
      ? url
      : `${url}${url.includes("?") ? "&" : "?"}sslmode=disable`,
  });
}

async function inventory(c) {
  const totals = await c.query(`
    SELECT
      (SELECT count(*)::bigint FROM vehicles) AS vehicles,
      (SELECT count(*)::bigint FROM vehicles WHERE created_at > now() - interval '24 hours') AS vehicles_24h,
      (SELECT count(*)::bigint FROM vehicles WHERE created_at > now() - interval '7 days') AS vehicles_7d,
      (SELECT count(*)::bigint FROM listings) AS listings,
      (SELECT count(*)::bigint FROM listings WHERE is_active) AS listings_active,
      (SELECT count(*)::bigint FROM listings WHERE created_at > now() - interval '24 hours') AS listings_24h,
      (SELECT count(*)::bigint FROM listings WHERE created_at > now() - interval '15 minutes') AS listings_15m,
      (SELECT count(*)::bigint FROM listings WHERE created_at > now() - interval '2 minutes') AS listings_2m,
      (SELECT count(*)::bigint FROM photos) AS photos,
      (SELECT count(*)::bigint FROM photos WHERE created_at > now() - interval '15 minutes') AS photos_15m
  `);

  const byProvider = await c.query(`
    SELECT p.internal_name,
           count(*)::bigint AS listings,
           count(*) FILTER (WHERE l.is_active)::bigint AS active,
           count(*) FILTER (WHERE l.created_at > now() - interval '24 hours')::bigint AS new_24h,
           count(DISTINCT l.vehicle_id)::bigint AS vehicles_linked
    FROM listings l
    JOIN providers p ON p.id = l.provider_id
    WHERE p.internal_name IN (
      'import_motor','autoplac','japanesecartrade','encar','thebidrive',
      'autowini','copart','sauto','ontariocars','carpages'
    )
    GROUP BY 1
    ORDER BY new_24h DESC, listings DESC
  `);

  const running = await c.query(`
    SELECT j.id, p.internal_name, j.job_type,
           j.listings_fetched, j.items_processed, j.vins_new,
           round(extract(epoch from (now()-j.updated_at))/60.0,1) AS quiet_m
    FROM collection_jobs j
    JOIN providers p ON p.id = j.provider_id
    WHERE j.status = 'running'
    ORDER BY quiet_m DESC NULLS LAST
  `);

  const offline = await c.query(`
    SELECT j.id, p.internal_name, j.job_type, j.status,
           j.listings_fetched, j.items_processed, j.vins_new,
           round(extract(epoch from (now()-j.updated_at))/60.0,1) AS quiet_m
    FROM collection_jobs j
    JOIN providers p ON p.id = j.provider_id
    WHERE p.internal_name IN ('import_motor','autoplac','japanesecartrade')
      AND j.status IN ('running','pending','paused')
    ORDER BY p.internal_name, j.id DESC
  `);

  return {
    totals: totals.rows[0],
    byProvider: byProvider.rows,
    running: running.rows,
    offline: offline.rows,
  };
}

function n(x) {
  return Number(x ?? 0);
}

const local = localClient();
const prod = prodClient();
await local.connect();
await prod.connect();

const L = await inventory(local);
const P = await inventory(prod);

await local.end();
await prod.end();

console.log("\n=== LOCAL crawl ===");
console.log("intake", {
  listings_15m: n(L.totals.listings_15m),
  listings_2m: n(L.totals.listings_2m),
  photos_15m: n(L.totals.photos_15m),
});
console.log("offline IM/AP/JCT", L.offline);
console.log(
  "running_quiet",
  L.running.map((r) => `${r.internal_name}#${r.id}:${r.quiet_m}m`),
);

console.log("\n=== COUNTS local vs prod ===");
const rows = [
  ["vehicles", n(L.totals.vehicles), n(P.totals.vehicles)],
  ["vehicles_24h", n(L.totals.vehicles_24h), n(P.totals.vehicles_24h)],
  ["vehicles_7d", n(L.totals.vehicles_7d), n(P.totals.vehicles_7d)],
  ["listings", n(L.totals.listings), n(P.totals.listings)],
  ["listings_active", n(L.totals.listings_active), n(P.totals.listings_active)],
  ["listings_24h", n(L.totals.listings_24h), n(P.totals.listings_24h)],
  ["photos", n(L.totals.photos), n(P.totals.photos)],
];
for (const [k, loc, pr] of rows) {
  const delta = loc - pr;
  const pct = pr ? ((delta / pr) * 100).toFixed(1) : "n/a";
  console.log(`${k}: local=${loc} prod=${pr} delta=${delta >= 0 ? "+" : ""}${delta} (${pct}%)`);
}

console.log("\n=== Provider listings_24h local vs prod ===");
const names = new Set([
  ...L.byProvider.map((r) => r.internal_name),
  ...P.byProvider.map((r) => r.internal_name),
]);
const lMap = Object.fromEntries(L.byProvider.map((r) => [r.internal_name, r]));
const pMap = Object.fromEntries(P.byProvider.map((r) => [r.internal_name, r]));
for (const name of [...names].sort()) {
  const loc = lMap[name] || {};
  const pr = pMap[name] || {};
  console.log({
    provider: name,
    local_listings: n(loc.listings),
    prod_listings: n(pr.listings),
    local_new_24h: n(loc.new_24h),
    prod_new_24h: n(pr.new_24h),
    local_vehicles: n(loc.vehicles_linked),
    prod_vehicles: n(pr.vehicles_linked),
  });
}
