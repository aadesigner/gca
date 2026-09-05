import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(`SELECT crawl_state, job_config FROM collection_jobs WHERE id=360`);
const st = JSON.parse(r.rows[0].crawl_state || "{}");
const cfg = JSON.parse(r.rows[0].job_config || "{}");
const audi = st.shards?.find((s) => s.id === "im-brand-audi");
console.log(JSON.stringify({ cfgBrands: cfg.brands?.slice(0, 3), audi }, null, 2));
// reopen all brand shards that died on already-crawled
let n = 0;
for (const s of st.shards || []) {
  if (!String(s.id).startsWith("im-brand-")) continue;
  if (s.status === "completed") {
    s.status = "pending";
    s.lastError = null;
    s.cooldownUntil = null;
    delete s.expectedTotalPages;
    // ensure brands filter present
    const brand = String(s.id).replace(/^im-brand-/, "");
    s.filters = {
      ...(s.filters || {}),
      crawlMode: "brands",
      brands: [brand],
      countries: [],
      fullCrawl: true,
      concurrency: cfg.concurrency || 14,
      delayMs: cfg.delayMs || 85,
      detailLevel: "full",
      skipRecentHours: 0,
    };
    n++;
  }
}
st.currentShardId = st.shards?.find((s) => s.status === "pending")?.id || "im-brand-audi";
await c.query(
  `UPDATE collection_jobs SET status='pending', crawl_state=$1, updated_at=now()-interval '1 hour', error_message=NULL WHERE id=360`,
  [JSON.stringify(st)],
);
console.log("reopened", n, "current", st.currentShardId);
await c.end();
