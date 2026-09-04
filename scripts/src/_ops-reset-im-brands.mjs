/**
 * Reset IM 360 brand shards to page 1 and pause competing jobs.
 */
import pg from "pg";

const JOB_ID = Number(process.env.IM_JOB_ID || 360);
const KEEP = new Set([JOB_ID, 361, 362]);

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const paused = await c.query(
  `
  UPDATE collection_jobs
  SET status='paused', updated_at=now()
  WHERE status IN ('running','pending')
    AND NOT (id = ANY($1::int[]))
  RETURNING id
`,
  [[...KEEP]],
);
console.log("paused", paused.rows.map((r) => r.id));

const { rows } = await c.query(`SELECT job_config, crawl_state FROM collection_jobs WHERE id=$1`, [
  JOB_ID,
]);
const cfg = JSON.parse(rows[0].job_config || "{}");
const st = JSON.parse(rows[0].crawl_state || "{}");

cfg.crawlMode = "brands";
cfg.fullCrawl = true;
cfg.countries = [];
delete cfg.fullCrawlCountries;
delete cfg.origins;

for (const s of st.shards || []) {
  if (!String(s.id || "").startsWith("im-brand-")) {
    s.status = "completed";
    s.lastError = "deferred: brand mode only";
    continue;
  }
  s.status = "pending";
  s.nextPage = 1;
  s.pagesProcessed = 0;
  s.itemsDiscovered = 0;
  s.listingsFetched = 0;
  s.discoverFailures = 0;
  s.cooldownUntil = null;
  s.lastError = null;
  delete s.expectedTotalPages;
  delete s.expectedResultTotal;
  s.filters = {
    ...(s.filters || {}),
    crawlMode: "brands",
    brands: s.filters?.brands || [String(s.id).replace(/^im-brand-/, "")],
    countries: [],
    fullCrawl: true,
  };
}
st.currentShardId = (st.shards || []).find((s) => s.status === "pending")?.id || null;

await c.query(
  `
  UPDATE collection_jobs
  SET status='pending',
      job_config=$1,
      crawl_state=$2,
      pages_processed=0,
      items_processed=0,
      items_discovered=0,
      items_failed=0,
      vins_found=0,
      listings_fetched=0,
      error_message=NULL,
      completed_at=NULL,
      updated_at=now()
  WHERE id=$3
`,
  [JSON.stringify(cfg), JSON.stringify(st), JOB_ID],
);

console.log(`reset ${JOB_ID} → pending current=${st.currentShardId} shards=${st.shards?.length}`);
await c.end();
