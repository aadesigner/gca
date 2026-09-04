import pg from "pg";

const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
await c.connect();
const r = await c.query(`SELECT status, crawl_state FROM collection_jobs WHERE id=360`);
const st = JSON.parse(r.rows[0].crawl_state || "{}");
const top = (st.shards || [])
  .filter((s) => String(s.id).startsWith("im-brand-"))
  .slice(0, 8)
  .map((s) => ({
    id: s.id,
    status: s.status,
    next: s.nextPage,
    pages: s.pagesProcessed,
    fetched: s.listingsFetched,
    expected: s.expectedTotalPages,
    err: s.lastError,
  }));
console.log(JSON.stringify({ job: r.rows[0].status, current: st.currentShardId, top }, null, 2));
await c.end();
