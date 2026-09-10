import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const { rows } = await c.query(`SELECT crawl_state, status FROM collection_jobs WHERE id=360`);
const st = JSON.parse(rows[0].crawl_state || "{}");
for (const s of st.shards || []) {
  if (s.status === "completed") continue;
  s.status = "completed";
  s.cooldownUntil = null;
  s.lastError = `pagination: catalog wall page ${s.nextPage || 1} (ops: unreadable brand)`;
  console.log("completed", s.id);
}
st.currentShardId = null;
st.lastBlock = null;
await c.query(
  `UPDATE collection_jobs
   SET status='pending', completed_at=NULL, error_message=NULL, crawl_state=$1, updated_at=NOW()
   WHERE id=360`,
  [JSON.stringify(st)],
);
console.log("job set pending; remaining non-completed:", (st.shards || []).filter((s) => s.status !== "completed").length);
await c.end();
