/**
 * Resume Carstat full crawl from saved catalog page (never resets crawl_state).
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-resume-carstat.mjs
 */
import pg from "pg";

const CARSTAT_ID = Number(process.env.CARSTAT_JOB_ID || 414);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const before = await c.query(
  `SELECT status, pages_processed, job_config, crawl_state FROM collection_jobs WHERE id=$1`,
  [CARSTAT_ID],
);
if (!before.rows[0]) throw new Error(`job ${CARSTAT_ID} missing`);
const st = JSON.parse(before.rows[0].crawl_state || "{}");
const shard = (st.shards || [])[0];
const cfg = JSON.parse(before.rows[0].job_config || "{}");
delete cfg.nextRunAt;
delete cfg.resetCrawlState;
cfg.fullCrawl = true;
cfg.maxPages = 0;
cfg.maxListings = 0;
cfg.skipRecentHours = 0;
await c.query(
  `UPDATE collection_jobs
   SET status='pending', job_type='full_collection', job_config=$1,
       completed_at=NULL, error_message=NULL, started_at=NULL, updated_at=now()
   WHERE id=$2`,
  [JSON.stringify(cfg), CARSTAT_ID],
);
console.log("carstat", CARSTAT_ID, "pending at page", shard?.nextPage);
await c.end();
