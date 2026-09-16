/**
 * Diagnose why local Import Motor isn't adding new VINs.
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

const job = await c.query(`
  SELECT j.id, j.status, j.job_type, j.job_config,
         j.pages_processed, j.listings_fetched, j.items_processed, j.vins_found, j.vins_new,
         j.duplicates_skipped,
         round(extract(epoch from (now()-j.updated_at))/60.0,1) AS quiet_m,
         j.crawl_state
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE p.internal_name = 'import_motor'
  ORDER BY j.id DESC
  LIMIT 3
`);

for (const row of job.rows) {
  let cfg = row.job_config;
  let cs = row.crawl_state;
  try {
    if (typeof cfg === "string") cfg = JSON.parse(cfg);
  } catch {}
  try {
    if (typeof cs === "string") cs = JSON.parse(cs);
  } catch {}

  console.log("\n=== job", row.id, row.status, row.job_type, "===");
  console.log({
    quiet_m: row.quiet_m,
    pages: row.pages_processed,
    fetched: row.listings_fetched,
    items: row.items_processed,
    vins_found: row.vins_found,
    vins_new: row.vins_new,
    dupes: row.duplicates_skipped,
    cfg: {
      skipRecentHours: cfg?.skipRecentHours,
      fullCrawl: cfg?.fullCrawl,
      origins: cfg?.origins,
      concurrency: cfg?.concurrency,
      detailLevel: cfg?.detailLevel,
      maxPages: cfg?.maxPages,
      maxListings: cfg?.maxListings,
    },
    strategy: cs?.strategy,
    currentShardId: cs?.currentShardId,
    shardCount: cs?.shards?.length,
  });

  if (Array.isArray(cs?.shards)) {
    const summary = cs.shards.map((s) => ({
      id: s.id,
      status: s.status,
      page: s.page,
      fetched: s.listingsFetched,
      failures: s.discoverFailures,
      country: s.filters?.country ?? s.filters?.countries ?? s.filters?.origin,
      brand: s.filters?.brand ?? s.filters?.brands,
    }));
    const active = summary.filter((s) => s.status === "active" || s.status === "pending");
    const done = summary.filter((s) => s.status === "completed").length;
    console.log("shards", { total: summary.length, completed: done, active_pending: active.length });
    console.log("active/pending sample", active.slice(0, 12));
    console.log("completed sample", summary.filter((s) => s.status === "completed").slice(0, 8));
  }
}

const imProv = await c.query(`SELECT id FROM providers WHERE internal_name='import_motor'`);
const pid = imProv.rows[0]?.id;

const coverage = await c.query(
  `
  SELECT
    count(*)::bigint AS listings,
    count(*) FILTER (WHERE is_active)::bigint AS active,
    count(*) FILTER (WHERE created_at > now() - interval '24 hours')::bigint AS listings_24h,
    count(*) FILTER (WHERE created_at > now() - interval '7 days')::bigint AS listings_7d,
    count(DISTINCT vehicle_id)::bigint AS vehicles
  FROM listings WHERE provider_id = $1
  `,
  [pid],
);
console.log("\n=== IM inventory ===", coverage.rows[0]);

const recentNew = await c.query(
  `
  SELECT date_trunc('day', v.created_at) AS day, count(*)::int AS new_vins
  FROM vehicles v
  JOIN listings l ON l.vehicle_id = v.id
  WHERE l.provider_id = $1
    AND v.created_at > now() - interval '10 days'
    AND l.id = (
      SELECT min(l2.id) FROM listings l2 WHERE l2.vehicle_id = v.id AND l2.provider_id = $1
    )
  GROUP BY 1
  ORDER BY 1 DESC
  `,
  [pid],
);
console.log("\n=== IM first-seen vehicles by day ===");
console.log(recentNew.rows);

await c.end();
