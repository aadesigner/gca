import pg from "pg";

const url = process.env.PROD_DATABASE_URL || process.env.DATABASE_PUBLIC_URL;
if (!url) {
  console.error("Set PROD_DATABASE_URL or DATABASE_PUBLIC_URL");
  process.exit(2);
}

const c = new pg.Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 20000,
});
await c.connect();

const day = await c.query(`
  SELECT
    count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC'))::int AS vehicles_utc_day,
    count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS vehicles_24h,
    count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'Europe/Belgrade'))::int AS vehicles_belgrade_day
  FROM vehicles
`);

const listings = await c.query(`
  SELECT
    count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'UTC'))::int AS listings_utc_day,
    count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int AS listings_24h
  FROM listings
`);

const byProv = await c.query(`
  SELECT p.internal_name,
         count(*)::int AS listings_today,
         count(DISTINCT l.vehicle_id)::int AS vehicles_today
  FROM listings l
  JOIN providers p ON p.id = l.provider_id
  WHERE l.created_at >= date_trunc('day', now() AT TIME ZONE 'UTC')
  GROUP BY 1
  ORDER BY listings_today DESC
  LIMIT 20
`);

const jobs = await c.query(`
  SELECT cj.id, p.internal_name, cj.job_type, cj.status,
         cj.pages_processed, cj.listings_fetched, cj.vins_new, cj.items_processed,
         cj.updated_at, left(cj.error_message, 80) AS err
  FROM collection_jobs cj
  JOIN providers p ON p.id = cj.provider_id
  WHERE cj.status IN ('running','pending')
     OR cj.updated_at > now() - interval '12 hours'
  ORDER BY cj.updated_at DESC NULLS LAST
  LIMIT 40
`);

const stalled = await c.query(`
  SELECT count(*)::int AS running_stale_gt_2h
  FROM collection_jobs
  WHERE status='running' AND updated_at < now() - interval '2 hours'
`);

console.log(JSON.stringify({
  vehicles: day.rows[0],
  listings: listings.rows[0],
  byProviderToday: byProv.rows,
  stalled: stalled.rows[0],
  recentJobs: jobs.rows,
}, null, 2));

await c.end();
