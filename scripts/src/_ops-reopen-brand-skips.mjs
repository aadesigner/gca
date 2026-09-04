/**
 * Reopen early-completed brand shards (already-crawled skip) and resume IM 360.
 */
import pg from "pg";

const JOB_ID = Number(process.env.IM_JOB_ID || 360);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

await c.query(`
  UPDATE collection_jobs
  SET status='paused', updated_at=now()
  WHERE status IN ('running','pending') AND id NOT IN ($1, 361, 362)
`, [JOB_ID]);

const r = await c.query(`SELECT crawl_state, job_config FROM collection_jobs WHERE id=$1`, [JOB_ID]);
const st = JSON.parse(r.rows[0].crawl_state || "{}");
const cfg = JSON.parse(r.rows[0].job_config || "{}");
cfg.crawlMode = "brands";
cfg.countries = [];
cfg.fullCrawl = true;

let reopened = 0;
for (const s of st.shards || []) {
  if (!String(s.id || "").startsWith("im-brand-")) continue;
  if (
    s.status === "completed" &&
    (String(s.lastError || "").includes("already crawled") || Number(s.nextPage || 0) > 1)
  ) {
    s.status = "pending";
    s.lastError = null;
    s.cooldownUntil = null;
    s.discoverFailures = 0;
    delete s.expectedTotalPages;
    // Resume from nextPage (do not restart from 1)
    reopened++;
  }
}
st.currentShardId =
  (st.shards || []).find((s) => s.status === "pending" && String(s.id).startsWith("im-brand-"))?.id ||
  st.currentShardId;

await c.query(
  `
  UPDATE collection_jobs
  SET status='pending',
      job_config=$1,
      crawl_state=$2,
      updated_at=now() - interval '1 hour',
      error_message=NULL,
      completed_at=NULL
  WHERE id=$3
`,
  [JSON.stringify(cfg), JSON.stringify(st), JOB_ID],
);

console.log(`reopened ${reopened} brand shards; current=${st.currentShardId}`);
await c.end();
