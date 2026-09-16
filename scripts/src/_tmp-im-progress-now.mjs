import pg from "pg";

const url =
  process.env.DATABASE_URL ||
  "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable";
const c = new pg.Client({
  connectionString: url.includes("sslmode=") ? url : `${url}?sslmode=disable`,
});
await c.connect();

const job = await c.query(`
  SELECT status, listings_fetched, items_processed, vins_new, vins_found, duplicates_skipped,
         pages_processed,
         round(extract(epoch from (now()-updated_at))/60.0,1) AS quiet_m,
         crawl_state::jsonb->>'currentShardId' AS shard,
         crawl_state::jsonb->>'strategy' AS strategy,
         job_config::jsonb->>'source' AS source,
         left(coalesce(error_message,''),120) AS err
  FROM collection_jobs WHERE id=360
`);
console.log("job", job.rows[0]);

const cs = await c.query(`SELECT crawl_state FROM collection_jobs WHERE id=360`);
let state = cs.rows[0]?.crawl_state;
if (typeof state === "string") state = JSON.parse(state);
const shards = Array.isArray(state?.shards) ? state.shards : [];
const counts = {};
for (const s of shards) counts[s.status] = (counts[s.status] || 0) + 1;
console.log("shard_status", counts);
console.log(
  "active_or_progress",
  shards
    .filter((s) => s.status === "active" || (s.listingsFetched > 0 && s.status !== "completed") || (s.nextPage > 1 && s.status !== "completed"))
    .slice(0, 15)
    .map((s) => ({
      id: s.id,
      status: s.status,
      nextPage: s.nextPage,
      fetched: s.listingsFetched,
      pages: s.pagesProcessed,
      err: s.lastError,
      maxPages: s.filters?.maxPages,
    })),
);

const im = await c.query(`
  SELECT
    (SELECT count(*)::int FROM listings l JOIN providers p ON p.id=l.provider_id
      WHERE p.internal_name='import_motor' AND l.created_at > now() - interval '30 minutes') AS listings_30m,
    (SELECT count(*)::int FROM listings l JOIN providers p ON p.id=l.provider_id
      WHERE p.internal_name='import_motor' AND l.created_at > now() - interval '2 hours') AS listings_2h,
    (SELECT count(*)::int FROM vehicles v
      WHERE v.created_at > now() - interval '2 hours'
        AND EXISTS (
          SELECT 1 FROM listings l JOIN providers p ON p.id=l.provider_id
          WHERE l.vehicle_id=v.id AND p.internal_name='import_motor'
        )) AS vehicles_2h_with_im
`);
console.log("intake", im.rows[0]);

await c.end();
