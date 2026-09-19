/**
 * Snapshot crawl memory for local offline (CDP) providers, then freeze them.
 *
 * Offline providers: import_motor, autoplac, carstat, japanesecartrade, beforward
 *
 * Usage (from scripts/):
 *   node --import ./load-env.mjs ./src/_ops-offline-crawl-memory-stop.mjs
 *   node --import ./load-env.mjs ./src/_ops-offline-crawl-memory-stop.mjs --dry-run
 *
 * Memory file: scripts/offline-crawl-memory.json (+ %TEMP% copy)
 * Clear hold later: CLEAR=1 node --import ./load-env.mjs ./src/_ops-offline-crawl-memory-stop.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const MEMORY_PATH = path.join(ROOT, "offline-crawl-memory.json");
const MEMORY_TEMP = path.join(os.tmpdir(), "gca-offline-crawl-memory.json");

const OFFLINE_PROVIDERS = [
  "import_motor",
  "autoplac",
  "carstat",
  "japanesecartrade",
  "beforward",
];

const dryRun = process.argv.includes("--dry-run");
const clear = process.env.CLEAR === "1" || process.argv.includes("--clear");

const localUrl = (
  process.env.LOCAL_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip"
).replace(/[?&]sslmode=[^&]+/i, "");
const connectionString = `${localUrl}${localUrl.includes("?") ? "&" : "?"}sslmode=disable`;

function parseJson(raw, fallback = {}) {
  if (raw == null) return fallback;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function summarizeShards(crawlState) {
  const shards = crawlState?.shards;
  if (!Array.isArray(shards)) return null;
  const byStatus = {};
  for (const s of shards) {
    const st = s?.status || "unknown";
    byStatus[st] = (byStatus[st] || 0) + 1;
  }
  return {
    currentShardId: crawlState.currentShardId ?? null,
    shardCount: shards.length,
    byStatus,
    pagesProcessed: shards.reduce((a, s) => a + (Number(s.pagesProcessed) || 0), 0),
    listingsFetched: shards.reduce((a, s) => a + (Number(s.listingsFetched) || 0), 0),
    active: shards
      .filter((s) => ["active", "cooldown", "pending"].includes(s.status))
      .slice(0, 12)
      .map((s) => ({
        id: s.id,
        status: s.status,
        nextPage: s.nextPage ?? null,
        pagesProcessed: s.pagesProcessed ?? null,
        expectedTotalPages: s.expectedTotalPages ?? null,
        listingsFetched: s.listingsFetched ?? null,
      })),
  };
}

const c = new pg.Client({ connectionString });
await c.connect();

if (clear) {
  const next = new Date(Date.now() - 60_000).toISOString();
  if (dryRun) {
    console.log("[dry-run] would clear offlineHold and set nextRunAt", next);
    await c.end();
    process.exit(0);
  }
  const r = await c.query(
    `
    UPDATE collection_jobs cj
    SET job_config = (
          (COALESCE(cj.job_config::jsonb, '{}'::jsonb) - 'offlineHold' - 'offlineHoldAt' - 'offlineMemoryPath')
          || jsonb_build_object('nextRunAt', $1::text)
        )::text,
        error_message = NULL,
        status = CASE WHEN cj.status = 'cancelled' THEN 'pending' ELSE cj.status END,
        completed_at = CASE WHEN cj.status = 'cancelled' THEN NULL ELSE cj.completed_at END,
        updated_at = now()
    FROM providers p
    WHERE p.id = cj.provider_id
      AND p.internal_name = ANY($2::text[])
      AND (
        cj.job_config::jsonb ? 'offlineHold'
        OR cj.error_message ILIKE '%offline hold%'
      )
    RETURNING cj.id, p.internal_name, cj.status, cj.job_config::jsonb->>'nextRunAt' AS next
    `,
    [next, OFFLINE_PROVIDERS],
  );
  console.log("cleared offline hold", r.rows);
  await c.end();
  process.exit(0);
}

const { rows: jobs } = await c.query(
  `
  SELECT cj.id, p.internal_name, cj.job_type, cj.status,
    cj.pages_processed, cj.listings_fetched, cj.items_processed,
    cj.vins_found, cj.vins_new, cj.items_discovered, cj.items_failed,
    cj.started_at, cj.updated_at, cj.completed_at, cj.error_message,
    cj.job_config, cj.crawl_state
  FROM collection_jobs cj
  JOIN providers p ON p.id = cj.provider_id
  WHERE p.internal_name = ANY($1::text[])
  ORDER BY p.internal_name, cj.updated_at DESC
  `,
  [OFFLINE_PROVIDERS],
);

const byProvider = {};
for (const name of OFFLINE_PROVIDERS) byProvider[name] = [];

for (const j of jobs) {
  const cfg = parseJson(j.job_config, {});
  const st = parseJson(j.crawl_state, null);
  byProvider[j.internal_name].push({
    id: j.id,
    jobType: j.job_type,
    status: j.status,
    pagesProcessed: j.pages_processed,
    listingsFetched: j.listings_fetched,
    itemsProcessed: j.items_processed,
    itemsDiscovered: j.items_discovered,
    itemsFailed: j.items_failed,
    vinsFound: j.vins_found,
    vinsNew: j.vins_new,
    startedAt: j.started_at,
    updatedAt: j.updated_at,
    completedAt: j.completed_at,
    errorMessage: j.error_message,
    nextRunAt: cfg.nextRunAt ?? null,
    lastCompletedAt: cfg.lastCompletedAt ?? null,
    repeatHours: cfg.repeatHours ?? null,
    concurrency: cfg.concurrency ?? null,
    delayMs: cfg.delayMs ?? null,
    jobConfig: cfg,
    crawlStateSummary: summarizeShards(st),
    crawlState: st,
  });
}

const inventory = {};
for (const name of OFFLINE_PROVIDERS) {
  const { rows } = await c.query(
    `
    SELECT count(*)::int AS listings,
      count(DISTINCT l.vehicle_id)::int AS vehicles
    FROM listings l
    JOIN providers p ON p.id = l.provider_id
    WHERE p.internal_name = $1
    `,
    [name],
  );
  inventory[name] = rows[0];
}

const memory = {
  savedAt: new Date().toISOString(),
  reason: "offline hold — stop local CDP crawls; resume from crawl_state later",
  providers: OFFLINE_PROVIDERS,
  inventory,
  jobs: byProvider,
};

fs.writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2));
fs.writeFileSync(MEMORY_TEMP, JSON.stringify(memory, null, 2));
console.log("wrote crawl memory", MEMORY_PATH);
console.log("wrote crawl memory copy", MEMORY_TEMP);
console.log(
  "inventory",
  Object.fromEntries(Object.entries(inventory).map(([k, v]) => [k, `${v.vehicles}veh/${v.listings}list`])),
);

const live = jobs.filter((j) => ["running", "pending", "paused"].includes(j.status));
console.log(
  "live jobs to freeze",
  live.map((j) => `${j.internal_name}#${j.id}:${j.status}`),
);

if (dryRun) {
  console.log("[dry-run] memory saved; no job status changes");
  await c.end();
  process.exit(0);
}

const far = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
const frozen = [];
for (const j of live) {
  const cfg = parseJson(j.job_config, {});
  cfg.nextRunAt = far;
  cfg.offlineHold = true;
  cfg.offlineHoldAt = new Date().toISOString();
  cfg.offlineMemoryPath = MEMORY_PATH;
  delete cfg.awaitingDeploy;

  const r = await c.query(
    `
    UPDATE collection_jobs
    SET status = 'cancelled',
        completed_at = COALESCE(completed_at, now()),
        started_at = NULL,
        error_message = 'offline hold — crawl memory saved; do not auto-start',
        job_config = $1::text,
        updated_at = now()
    WHERE id = $2
    RETURNING id, status
    `,
    [JSON.stringify(cfg), j.id],
  );
  frozen.push({ id: r.rows[0].id, provider: j.internal_name, was: j.status });
}

// Also park any other recent cancelled/failed offline jobs so healers don't revive them.
await c.query(
  `
  UPDATE collection_jobs cj
  SET job_config = (
        COALESCE(cj.job_config::jsonb, '{}'::jsonb)
        || jsonb_build_object(
          'nextRunAt', $1::text,
          'offlineHold', true,
          'offlineHoldAt', $2::text,
          'offlineMemoryPath', $3::text
        )
      )::text,
      updated_at = now()
  FROM providers p
  WHERE p.id = cj.provider_id
    AND p.internal_name = ANY($4::text[])
    AND cj.status IN ('cancelled', 'failed', 'completed')
    AND cj.updated_at > now() - interval '30 days'
    AND NOT (COALESCE(cj.job_config::jsonb, '{}'::jsonb) ? 'offlineHold')
  `,
  [far, new Date().toISOString(), MEMORY_PATH, OFFLINE_PROVIDERS],
);

console.log("frozen", frozen);
await c.end();
console.log("done — offline providers stopped; crawl_state preserved in DB + memory file");
