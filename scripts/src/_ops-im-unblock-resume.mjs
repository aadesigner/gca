/**
 * Unblock Import Motor job 360: complete brand shards stuck on deep-page 401 walls,
 * clear sticky currentShardId, set pending so the worker rotates to remaining brands.
 */
import pg from "pg";
import { healCrawlState } from "./crawl-shared.mjs";

const JOB_ID = Number(process.env.IM_JOB_ID || 360);
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();

const { rows } = await c.query(`SELECT crawl_state, status FROM collection_jobs WHERE id=$1`, [JOB_ID]);
if (!rows[0]) throw new Error(`job ${JOB_ID} missing`);

const healed = healCrawlState(rows[0].crawl_state);
const st = JSON.parse(healed.json || rows[0].crawl_state);
let fixed = healed.fixed;
const completed = [];

for (const s of st.shards || []) {
  if (s.status === "completed") continue;
  const next = s.nextPage || 1;
  const err = String(s.lastError || "");
  const stuckDeep =
    next >= 5 &&
    (/not readable|HTTP 401|Unauthorized|Cloudflare|empty storm|soft-block|catalog wall/i.test(err) ||
      s.status === "cooldown");

  if (stuckDeep) {
    s.status = "completed";
    s.cooldownUntil = null;
    s.lastError = `pagination: catalog wall page ${next} (ops unblock)`;
    s.expectedTotalPages = Math.max(1, next - 1);
    completed.push(s.id);
    fixed++;
    continue;
  }

  s.status = "pending";
  s.cooldownUntil = null;
  if (/not readable|401|Unauthorized|Cloudflare|empty|soft-block/i.test(err)) {
    s.lastError = null;
    s.discoverFailures = 0;
    fixed++;
  }
}

st.currentShardId = null;
st.lastBlock = null;

await c.query(
  `UPDATE collection_jobs
   SET status='pending', completed_at=NULL, error_message=NULL,
       crawl_state=$1, updated_at=NOW()
   WHERE id=$2`,
  [JSON.stringify(st), JOB_ID],
);

const by = {};
for (const s of st.shards || []) by[s.status] = (by[s.status] || 0) + 1;
console.log(JSON.stringify({ jobId: JOB_ID, fixed, completed, by }, null, 2));
await c.end();
