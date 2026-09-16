/**
 * Advance Autoplac brands stuck on the same timed-out search page.
 */
import pg from "pg";

const c = new pg.Client({
  connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable",
});
await c.connect();

const row = (await c.query(`SELECT crawl_state::jsonb AS cs FROM collection_jobs WHERE id=387`)).rows[0];
const cs = row.cs || {};
let advanced = 0;
const shards = (cs.shards || []).map((s) => {
  const timeout = /timed out waiting for vehicleType/i.test(String(s.lastError || ""));
  if (!timeout) return s;
  const page = Math.max(1, Number(s.nextPage) || 1);
  advanced++;
  return {
    ...s,
    status: "pending",
    nextPage: page + 1,
    cooldownUntil: null,
    lastError: null,
    discoverFailures: 0,
  };
});
const next = {
  ...cs,
  shards,
  currentShardId: shards.find((s) => s.status === "pending")?.id || null,
};
await c.query(
  `UPDATE collection_jobs
   SET crawl_state=$1::jsonb, status='pending', error_message=NULL,
       started_at=NULL, completed_at=NULL, updated_at=now()
   WHERE id=387`,
  [JSON.stringify(next)],
);
console.log({ advanced, current: next.currentShardId });
await c.end();
