/**
 * Open import-motor.com in CDP Chrome so CF can clear; skip stuck tiny shards to al.
 */
import fs from "node:fs";
import pg from "pg";

const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";

const targets = await (await fetch(`${CDP}/json/list`)).json();
console.log(
  "tabs",
  targets.length,
  targets
    .filter((t) => t.type === "page")
    .slice(0, 10)
    .map((t) => ({ title: String(t.title || "").slice(0, 50), url: String(t.url || "").slice(0, 90) })),
);

// Prefer existing IM tab, else open new
let page = targets.find(
  (t) => t.type === "page" && /import-motor\.com/i.test(String(t.url || "")),
);
if (!page) {
  const created = await (
    await fetch(`${CDP}/json/new?${encodeURIComponent("https://import-motor.com/buyer-locations/al")}`, {
      method: "PUT",
    })
  ).json();
  page = created;
  console.log("opened", page?.url || page);
} else {
  console.log("using existing", page.url);
}

await new Promise((r) => setTimeout(r, 8000));

const url =
  process.env.DATABASE_URL ||
  "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable";
const c = new pg.Client({
  connectionString: url.includes("sslmode=") ? url : `${url}?sslmode=disable`,
});
await c.connect();

const { rows } = await c.query(`SELECT crawl_state FROM collection_jobs WHERE id=360`);
let state = rows[0]?.crawl_state;
if (typeof state === "string") state = JSON.parse(state);

// Mark tiny CF-failing Balkans as completed for this front sweep; start at Albania (known inventory).
for (const s of state.shards || []) {
  if (["im-me", "im-mk", "im-xk", "im-ba", "im-si"].includes(s.id)) {
    s.status = "completed";
    s.lastError = "skipped tiny/CF front-sweep";
    s.cooldownUntil = null;
  } else if (s.status === "cooldown" || s.status === "active") {
    s.status = "pending";
    s.cooldownUntil = null;
    s.lastError = null;
  }
}
const start = (state.shards || []).find((s) => s.id === "im-al") || (state.shards || []).find((s) => s.status === "pending");
if (start) {
  start.status = "pending";
  start.nextPage = 1;
  start.cooldownUntil = null;
  start.lastError = null;
  state.currentShardId = start.id;
}

await c.query(
  `UPDATE collection_jobs SET status='pending', crawl_state=$2::text, error_message=NULL, started_at=NULL, completed_at=NULL, updated_at=NOW()-interval '1 day' WHERE id=$1`,
  [360, JSON.stringify(state)],
);
console.log("im_repointed", { shard: state.currentShardId });
await c.end();
