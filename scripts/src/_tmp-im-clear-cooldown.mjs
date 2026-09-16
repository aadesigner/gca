import pg from "pg";

const url =
  process.env.DATABASE_URL ||
  "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable";
const c = new pg.Client({
  connectionString: url.includes("sslmode=") ? url : `${url}?sslmode=disable`,
});
await c.connect();

const { rows } = await c.query(`SELECT crawl_state, status FROM collection_jobs WHERE id=360`);
let state = rows[0]?.crawl_state;
if (typeof state === "string") state = JSON.parse(state);

const cool = (state.shards || []).filter((s) => s.status === "cooldown");
console.log(
  "cooldown",
  cool.map((s) => ({
    id: s.id,
    until: s.cooldownUntil,
    err: s.lastError,
    nextPage: s.nextPage,
    failures: s.discoverFailures,
  })),
);

// Clear cooldowns + ensure first pending is claimable now
for (const s of state.shards || []) {
  if (s.status === "cooldown" || s.status === "active") {
    s.status = "pending";
    s.cooldownUntil = null;
  }
}
const first = (state.shards || []).find((s) => s.status === "pending");
state.currentShardId = first?.id ?? null;

await c.query(
  `
  UPDATE collection_jobs
  SET status='pending',
      crawl_state=$2::text,
      error_message=NULL,
      started_at=NULL,
      completed_at=NULL,
      updated_at=NOW()-interval '1 day',
      created_at=LEAST(created_at, NOW()-interval '2 days')
  WHERE id=$1
  `,
  [360, JSON.stringify(state)],
);

console.log("requeued", { shard: state.currentShardId, pending: (state.shards || []).filter((s) => s.status === "pending").length });
await c.end();
