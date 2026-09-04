import pg from "pg";
const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
await c.query(`UPDATE collection_jobs SET status='paused', updated_at=now() WHERE status IN ('running','pending') AND id NOT IN (360,361,362)`);
const r = await c.query(`SELECT crawl_state FROM collection_jobs WHERE id=360`);
const st = JSON.parse(r.rows[0].crawl_state||"{}");
const audi = st.shards?.find(s => s.id === "im-brand-audi");
if (audi) {
  audi.status = "pending";
  audi.nextPage = Math.max(6, audi.nextPage||1);
  audi.lastError = null;
  delete audi.expectedTotalPages;
}
st.currentShardId = "im-brand-audi";
await c.query(`UPDATE collection_jobs SET status='pending', crawl_state=$1, updated_at=now()-interval '1 hour', error_message=NULL WHERE id=360`, [JSON.stringify(st)]);
console.log("360 pending audi@", audi?.nextPage);
await c.end();
