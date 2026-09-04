import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(`SELECT crawl_state, job_config FROM collection_jobs WHERE id=360`);
const st = JSON.parse(r.rows[0].crawl_state || "{}");
const audi = (st.shards || []).find((s) => s.id === "im-brand-audi");
if (audi) {
  audi.status = "pending";
  audi.nextPage = Math.max(1, Number(audi.nextPage) || 1);
  // If completed early at page 5/6, resume from nextPage
  if (audi.nextPage < 2) audi.nextPage = 1;
  audi.lastError = null;
  audi.cooldownUntil = null;
  delete audi.expectedTotalPages;
}
st.currentShardId = "im-brand-audi";
// Don't lose mercedes progress — park it pending
for (const s of st.shards || []) {
  if (s.id === "im-brand-mercedes-benz" && s.status === "active") s.status = "pending";
}
await c.query(
  `UPDATE collection_jobs SET status='pending', crawl_state=$1, updated_at=now() WHERE id=360`,
  [JSON.stringify(st)],
);
console.log("reopened audi at page", audi?.nextPage);
await c.end();
