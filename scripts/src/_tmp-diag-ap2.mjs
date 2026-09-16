import pg from "pg";

const c = new pg.Client({
  connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable",
});
await c.connect();

const cs = (
  await c.query(
    `SELECT crawl_state::jsonb AS cs, error_message, updated_at, status FROM collection_jobs WHERE id=387`,
  )
).rows[0];
const statuses = {};
for (const s of cs.cs.shards || []) statuses[s.status] = (statuses[s.status] || 0) + 1;
console.log("ap_job", { status: cs.status, updated_at: cs.updated_at, err: cs.error_message });
console.log("ap_status_counts", statuses);
console.log(
  "ap_sample",
  (cs.cs.shards || []).slice(0, 8).map((s) => ({
    id: s.id,
    st: s.status,
    err: s.lastError,
    cool: s.cooldownUntil,
    fetched: s.listingsFetched,
  })),
);
console.log("current", cs.cs.currentShardId);

const im = (
  await c.query(`SELECT crawl_state::jsonb AS cs, updated_at, status FROM collection_jobs WHERE id=360`)
).rows[0];
console.log("im", { status: im.status, updated_at: im.updated_at, current: im.cs.currentShardId });
const imFocus = (im.cs.shards || []).filter(
  (s) => s.status === "active" || s.id === im.cs.currentShardId,
);
console.log(
  "im_focus",
  imFocus.map((s) => ({
    id: s.id,
    st: s.status,
    fetched: s.listingsFetched,
    pages: s.pagesProcessed,
    err: s.lastError,
  })),
);

// CDP ping
try {
  const r = await fetch("http://127.0.0.1:9222/json/version");
  console.log("cdp", await r.json());
} catch (e) {
  console.log("cdp_down", e.message);
}

await c.end();
