/**
 * Unstick local Autoplac brand cooldowns + reopen completed IM country shards.
 */
import pg from "pg";

const c = new pg.Client({
  connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip",
});
await c.connect();

// --- Autoplac 387 ---
const ap = (
  await c.query(`SELECT crawl_state::jsonb AS cs FROM collection_jobs WHERE id = 387`)
).rows[0];
let apFixed = 0;
const apShards = (ap.cs.shards || []).map((s) => {
  if (s.status !== "cooldown" && s.status !== "failed" && s.status !== "active") return s;
  apFixed++;
  return {
    ...s,
    status: "pending",
    cooldownUntil: null,
    lastError: null,
    discoverFailures: 0,
  };
});
const apCs = {
  ...ap.cs,
  shards: apShards,
  currentShardId: apShards.find((s) => s.status === "pending")?.id || null,
};
await c.query(
  `UPDATE collection_jobs
   SET crawl_state = $1::jsonb, status = 'pending', error_message = NULL,
       started_at = NULL, completed_at = NULL, updated_at = now()
   WHERE id = 387`,
  [JSON.stringify(apCs)],
);
console.log("autoplac: cleared cooldowns", apFixed, "→ pending; job requeued");

// --- Import Motor 360: reopen completed country shards ---
const im = (
  await c.query(`SELECT crawl_state::jsonb AS cs, job_config::jsonb AS cfg FROM collection_jobs WHERE id = 360`)
).rows[0];
let imReopened = 0;
const imShards = (im.cs.shards || []).map((s) => {
  if (!String(s.id || "").startsWith("im-")) return s;
  if (s.status !== "completed" && s.status !== "cooldown" && s.status !== "active") return s;
  imReopened++;
  return {
    ...s,
    status: "pending",
    nextPage: 1,
    lastError: null,
    cooldownUntil: null,
    discoverFailures: 0,
    filters: {
      ...(s.filters || {}),
      crawlMode: "countries",
      fullCrawl: false,
      origins: ["korean"],
      detailLevel: "full",
      skipRecentHours: 0,
    },
  };
});
const imCs = {
  ...im.cs,
  shards: imShards,
  currentShardId: imShards.find((s) => s.status === "pending")?.id || null,
};
await c.query(
  `UPDATE collection_jobs
   SET crawl_state = $1::jsonb,
       job_config = (COALESCE(job_config::jsonb, '{}'::jsonb) || $2::jsonb)::text,
       status = 'pending', error_message = NULL,
       started_at = NULL, completed_at = NULL, updated_at = now()
   WHERE id = 360`,
  [
    JSON.stringify(imCs),
    JSON.stringify({
      fullCrawl: false,
      origins: ["korean"],
      detailLevel: "full",
      skipRecentHours: 0,
      maxPages: 0,
      maxListings: 0,
      source: "manual_reopen_im_cycle",
    }),
  ],
);
console.log("import_motor: reopened", imReopened, "completed shards; job requeued (korean-only)");

const check = await c.query(`
  SELECT id, status, updated_at,
    (SELECT count(*) FROM jsonb_array_elements(crawl_state::jsonb->'shards') s WHERE s->>'status'='pending') AS pending,
    (SELECT count(*) FROM jsonb_array_elements(crawl_state::jsonb->'shards') s WHERE s->>'status'='completed') AS completed,
    (SELECT count(*) FROM jsonb_array_elements(crawl_state::jsonb->'shards') s WHERE s->>'status'='cooldown') AS cooldown
  FROM collection_jobs WHERE id IN (360, 387, 390)
  ORDER BY id
`);
console.log(check.rows);
await c.end();
