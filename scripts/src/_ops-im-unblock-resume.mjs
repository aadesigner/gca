/**
 * Nudge IM brand shards stuck on high empty pages: if a brand never fetched
 * this crawl and nextPage > 3, jump to a sibling brand that still has work,
 * keep overall cursor (do not wipe crawl_state).
 */
import pg from "pg";
import { healCrawlState } from "./crawl-shared.mjs";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows } = await c.query(`SELECT crawl_state, job_config, status FROM collection_jobs WHERE id=360`);
const healed = healCrawlState(rows[0].crawl_state);
const st = JSON.parse(healed.json || rows[0].crawl_state);
let fixed = healed.fixed;

for (const s of st.shards || []) {
  if (s.status === "completed") continue;
  const fetched = s.listingsFetched || 0;
  const next = s.nextPage || 1;
  // Brands that only saw blank high pages: fall back to page 1 once so CF/list UI can recover,
  // then already-crawled VIN filter skips known cars.
  if (fetched === 0 && next >= 6) {
    s.nextPage = 1;
    s.pagesProcessed = 0;
    s.expectedTotalPages = null;
    s.expectedResultTotal = null;
    s.status = "pending";
    s.cooldownUntil = null;
    s.lastError = null;
    s.discoverFailures = 0;
    fixed++;
  } else {
    s.status = "pending";
    s.cooldownUntil = null;
    if (/empty list|soft-block|Cloudflare|not readable|no list UI|brand empty/i.test(String(s.lastError || ""))) {
      s.lastError = null;
      s.discoverFailures = 0;
      fixed++;
    }
  }
}
st.currentShardId = null;
st.lastBlock = null;

await c.query(
  `UPDATE collection_jobs
   SET status='pending', completed_at=NULL, error_message=NULL,
       crawl_state=$1, updated_at=NOW()
   WHERE id=360`,
  [JSON.stringify(st)],
);
console.log({ fixed, shards: (st.shards || []).length });
await c.end();
