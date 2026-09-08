/**
 * Pause IM job, reopen false-EOF brand shards, keep cursors.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-reopen-im-early-eof.mjs
 */
import pg from "pg";

const JOB_ID = Number(process.env.IM_JOB_ID || 360);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

// Force pause so a running worker cannot overwrite this restore.
await c.query(
  `UPDATE collection_jobs SET status='paused', updated_at=now() WHERE id=$1`,
  [JOB_ID],
);

const { rows } = await c.query(`SELECT job_config, crawl_state FROM collection_jobs WHERE id=$1`, [
  JOB_ID,
]);
const cfg = JSON.parse(rows[0].job_config || "{}");
const st = JSON.parse(rows[0].crawl_state || "{}");

let n = 0;
for (const s of st.shards || []) {
  if (!String(s.id || "").startsWith("im-brand-")) continue;
  const expected = Number(s.expectedTotalPages) || 0;
  const next = Number(s.nextPage) || 1;
  const earlyComplete =
    s.status === "completed" &&
    ((expected > 0 && expected < 50) || next < 50) &&
    !(Number(s.expectedResultTotal) > 500);
  if (!earlyComplete) continue;
  s.status = "pending";
  s.lastError = null;
  s.cooldownUntil = null;
  delete s.expectedTotalPages;
  delete s.expectedResultTotal;
  s.filters = {
    ...(s.filters || {}),
    crawlMode: "brands",
    brands: s.filters?.brands || [String(s.id).replace(/^im-brand-/, "")],
    fullCrawl: true,
    countries: [],
    detailLevel: "full",
    skipRecentHours: 0,
  };
  n++;
}

st.currentShardId =
  st.shards?.find((s) => s.status === "pending" && String(s.id).startsWith("im-brand-"))?.id ||
  "im-brand-audi";
delete cfg.nextRunAt;
cfg.fullCrawl = true;
cfg.crawlMode = "brands";

await c.query(
  `UPDATE collection_jobs
   SET status='pending', error_message=NULL, completed_at=NULL, started_at=NULL,
       crawl_state=$1, job_config=$2, updated_at=now()-interval '1 hour'
   WHERE id=$3`,
  [JSON.stringify(st), JSON.stringify(cfg), JOB_ID],
);

const pending = (st.shards || []).filter(
  (s) => String(s.id).startsWith("im-brand-") && s.status === "pending",
).length;
console.log(JSON.stringify({ reopened: n, pendingBrands: pending, current: st.currentShardId }, null, 2));
await c.end();
