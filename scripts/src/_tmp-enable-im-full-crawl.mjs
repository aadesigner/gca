/**
 * Hard stop IM worker claim, wait, then fullCrawl-reset all shards.
 */
import pg from "pg";

const JOB_ID = Number(process.env.IM_JOB_ID || 360);
const c = new pg.Client({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip",
});
await c.connect();

await c.query(
  `UPDATE collection_jobs
   SET status = 'cancelled',
       completed_at = now(),
       updated_at = now(),
       error_message = 'cancelled: hard reset fullCrawl'
   WHERE id = $1`,
  [JOB_ID],
);

console.log("cancelled; waiting 6s for worker to drop claim...");
await new Promise((r) => setTimeout(r, 6000));

const row = (
  await c.query(`SELECT job_config, crawl_state FROM collection_jobs WHERE id = $1`, [JOB_ID])
).rows[0];

const cfg = typeof row.job_config === "string" ? JSON.parse(row.job_config) : { ...(row.job_config || {}) };
delete cfg.origins;
cfg.fullCrawl = true;
cfg.preferOrigins = ["korean"];
cfg.crawlMode = "countries";
cfg.detailLevel = "full";
cfg.skipRecentHours = 0;
cfg.maxPages = 0;
cfg.maxListings = 0;
cfg.concurrency = cfg.concurrency ?? 5;
cfg.delayMs = cfg.delayMs ?? 85;
cfg.retryCount = cfg.retryCount ?? 5;
cfg.source = "enable_im_full_crawl_prefer_korean";

const st = typeof row.crawl_state === "string" ? JSON.parse(row.crawl_state || "null") : row.crawl_state;
let reset = 0;
for (const s of st.shards) {
  if (!String(s.id || "").startsWith("im-")) continue;
  const filters = { ...(s.filters || {}) };
  delete filters.origins;
  filters.fullCrawl = true;
  filters.preferOrigins = ["korean"];
  filters.crawlMode = "countries";
  filters.detailLevel = "full";
  filters.skipRecentHours = 0;
  filters.maxPages = 0;
  filters.maxListings = 0;
  s.filters = filters;
  s.status = "pending";
  s.nextPage = 1;
  s.pagesProcessed = 0;
  s.itemsDiscovered = 0;
  s.listingsFetched = 0;
  s.discoverFailures = 0;
  s.cooldownUntil = null;
  s.lastError = null;
  delete s.expectedResultTotal;
  delete s.expectedTotalPages;
  reset++;
}
st.currentShardId = st.shards.find((s) => s.status === "pending")?.id || null;

await c.query(
  `UPDATE collection_jobs
   SET job_config = $1::text,
       crawl_state = $2::jsonb,
       status = 'pending',
       error_message = NULL,
       started_at = NULL,
       completed_at = NULL,
       pages_processed = 0,
       items_discovered = 0,
       items_processed = 0,
       items_failed = 0,
       listings_fetched = 0,
       vins_found = 0,
       vins_new = 0,
       updated_at = now() - interval '2 hours'
   WHERE id = $3`,
  [JSON.stringify(cfg), JSON.stringify(st), JOB_ID],
);

const check = await c.query(`
  SELECT status,
    job_config::jsonb->>'fullCrawl' AS full_crawl,
    (SELECT count(*) FROM jsonb_array_elements(crawl_state::jsonb->'shards') s
      WHERE s->>'id' LIKE 'im-%' AND s->>'status'='pending'
        AND s->'filters'->>'fullCrawl'='true'
        AND (s->'filters'->'origins') IS NULL) AS ok_pending,
    (SELECT count(*) FROM jsonb_array_elements(crawl_state::jsonb->'shards') s
      WHERE s->>'id' LIKE 'im-%') AS total_im,
    crawl_state::jsonb->>'currentShardId' AS current
  FROM collection_jobs WHERE id=$1
`, [JOB_ID]);
console.log({ jobId: JOB_ID, shardsReset: reset, ...check.rows[0] });
await c.end();
