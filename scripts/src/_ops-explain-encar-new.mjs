/**
 * Why Encar "new cars" is much smaller than listings fetched.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-explain-encar-new.mjs
 */
import pg from "pg";

const url = process.env.DATABASE_URL || "";
const host = (() => {
  try {
    return new URL(url.replace(/^postgres(ql)?:/i, "http:")).hostname;
  } catch {
    return "";
  }
})();
if (!/^(localhost|127\.0\.0\.1|::1)$/i.test(host)) throw new Error(`Refusing ${host}`);

const c = new pg.Client({ connectionString: url });
await c.connect();

const job = (
  await c.query(`
    SELECT id, status, pages_processed, listings_fetched, items_discovered, items_processed,
           vins_found, vins_new, new_observations, duplicates_skipped, items_failed,
           crawl_state, updated_at
    FROM collection_jobs WHERE id = 362
  `)
).rows[0];

const st = job.crawl_state ? JSON.parse(job.crawl_state) : null;
const shards = Array.isArray(st?.shards) ? st.shards : [];
const shardSummary = shards.map((s) => ({
  id: s.id,
  label: s.label,
  status: s.status,
  nextPage: s.nextPage,
  pages: s.pagesProcessed,
  discovered: s.itemsDiscovered,
  fetched: s.listingsFetched,
  expected: s.expectedResultTotal,
  err: s.lastError,
})).slice(0, 40);

const byStatus = {};
for (const s of shards) {
  byStatus[s.status] = (byStatus[s.status] || 0) + 1;
}

const crawlStart = "2026-10-27T20:00:00Z";
const extra = (
  await c.query(
    `
    SELECT
      (SELECT count(*)::int FROM vehicles v
         JOIN listings l ON l.vehicle_id = v.id
         JOIN providers p ON p.id = l.provider_id
        WHERE p.internal_name = 'encar'
          AND v.created_at >= $1) AS new_vehicles,
      (SELECT count(*)::int FROM vehicles v
         JOIN listings l ON l.vehicle_id = v.id
         JOIN providers p ON p.id = l.provider_id
        WHERE p.internal_name = 'encar') AS encar_vehicles,
      (SELECT count(*)::int FROM listings l
         JOIN providers p ON p.id = l.provider_id
        WHERE p.internal_name = 'encar'
          AND l.last_seen_at >= $1) AS listings_touched_since_crawl
    `,
    [crawlStart],
  )
).rows[0];

console.log(
  JSON.stringify(
    {
      host,
      job: {
        status: job.status,
        pages: job.pages_processed,
        discovered: job.items_discovered,
        fetched: job.listings_fetched,
        processed: job.items_processed,
        vins_found: job.vins_found,
        vins_new: job.vins_new,
        new_observations: job.new_observations,
        duplicates_skipped: job.duplicates_skipped,
        failed: job.items_failed,
        updated_at: job.updated_at,
      },
      extra,
      crawl: {
        strategy: st?.strategy,
        currentShardId: st?.currentShardId,
        shardCount: shards.length,
        byStatus,
        shards: shardSummary,
      },
    },
    null,
    2,
  ),
);
await c.end();
