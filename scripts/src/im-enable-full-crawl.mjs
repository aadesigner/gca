/**
 * Switch Import Motor job 360 to full crawl (no origins:korean skip).
 * Re-queues completed/partial shards that were Korean-only so nothing is missed.
 * Keeps im-al if already full-crawled. Does NOT reset global job counters.
 */
import pg from "pg";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const API = process.env.API_URL || "http://127.0.0.1:5000";
const JOB_ID = Number(process.env.IM_JOB_ID || 360);
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

const ALL_COUNTRIES = [
  "me", "mk", "xk", "ba", "al", "si", "hr", "bg", "rs", "ro", "gr", "ge", "am", "az", "md",
  "ee", "lv", "lt", "sk", "hu", "cz", "fi", "ie", "pt", "at", "be", "nl", "se", "no", "dk",
  "ch", "pl", "es", "it", "fr", "de", "gb", "ua", "cy", "jo", "lb", "bh", "qa", "kw", "om",
  "ae", "il", "iq", "sa", "tr", "ru", "*rest",
];

async function login() {
  const res = await fetch(`${API}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function apiJson(cookie, method, urlPath, body) {
  const res = await fetch(`${API}${urlPath}`, {
    method,
    headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${urlPath} → ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

async function waitJobPausedAndIdle(pool, jobId, maxMs = 180_000) {
  let lastListings = null;
  let stable = 0;
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    const r = await pool.query(
      "SELECT status, listings_fetched FROM collection_jobs WHERE id = $1",
      [jobId],
    );
    const row = r.rows[0];
    if (row.status !== "paused") {
      await new Promise((res) => setTimeout(res, 2000));
      continue;
    }
    const lf = Number(row.listings_fetched ?? 0);
    if (lf === lastListings) stable++;
    else {
      lastListings = lf;
      stable = 0;
    }
    if (stable >= 4) return;
    await new Promise((res) => setTimeout(res, 2500));
  }
  throw new Error(`Job ${jobId} did not settle after pause (${maxMs}ms)`);
}

function verifyPatched(state) {
  const me = state.shards?.find((s) => s.id === "im-me");
  if (!me?.filters?.fullCrawl || me.filters.origins) {
    throw new Error("crawl_state patch did not stick (im-me still korean-only)");
  }
}

function shardCountry(shard) {
  const cc = shard.filters?.countries?.[0];
  if (cc) return String(cc).toLowerCase();
  const m = /^im-(rest|[a-z]{2})$/.exec(shard.id || "");
  return m ? (m[1] === "rest" ? "*rest" : m[1]) : null;
}

function needsFullRescan(shard) {
  if (shard.filters?.fullCrawl) return false;
  if (shard.filters?.origins?.length) return true;
  return shard.status === "completed" && (shard.pagesProcessed ?? 0) > 0 && !shard.filters?.fullCrawl;
}

function resetShardForFull(shard) {
  const cc = shardCountry(shard);
  shard.filters = {
    ...(shard.filters ?? {}),
    countries: cc ? [cc] : shard.filters?.countries,
    fullCrawl: true,
    fullCrawlCountries: ALL_COUNTRIES,
    detailLevel: "full",
    skipRecentHours: 0,
    maxPages: 0,
    maxListings: 0,
    concurrency: 10,
    delayMs: 50,
    retryCount: 5,
  };
  delete shard.filters.origins;
  shard.status = "pending";
  shard.nextPage = 1;
  shard.pagesProcessed = 0;
  shard.itemsDiscovered = 0;
  shard.listingsFetched = 0;
  shard.discoverFailures = 0;
  shard.cooldownUntil = null;
  shard.lastError = null;
  delete shard.expectedResultTotal;
  delete shard.expectedTotalPages;
}

async function main() {
  if (!email || !password) throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD required");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const cookie = await login();
    let job = await apiJson(cookie, "GET", `/api/admin/jobs/${JOB_ID}`);
    console.log(`Job ${JOB_ID} status=${job.status} pages=${job.pagesProcessed} listings=${job.listingsFetched}`);

    if (job.status === "running" || job.status === "pending") {
      try {
        await apiJson(cookie, "POST", `/api/admin/jobs/${JOB_ID}/pause`, {});
        console.log("Paused job — waiting for worker to stop…");
        await waitJobPausedAndIdle(pool, JOB_ID);
      } catch (e) {
        console.warn(`Pause failed (${e.message}) — patching only if job is not running`);
        const row = await pool.query("SELECT status FROM collection_jobs WHERE id = $1", [JOB_ID]);
        if (row.rows[0]?.status === "running") {
          throw new Error("Cannot patch crawl_state while job is running — restart API first");
        }
      }
    }

    const row = await pool.query("SELECT job_config, crawl_state FROM collection_jobs WHERE id = $1", [JOB_ID]);
    const jobConfig = JSON.parse(row.rows[0].job_config);
    delete jobConfig.origins;
    jobConfig.fullCrawlCountries = ALL_COUNTRIES;
    jobConfig.detailLevel = "full";
    jobConfig.skipRecentHours = 0;
    jobConfig.maxPages = 0;
    jobConfig.maxListings = 0;
    jobConfig.concurrency = 10;
    jobConfig.delayMs = 50;
    jobConfig.retryCount = 5;
    jobConfig.countries = ALL_COUNTRIES;

    const state = JSON.parse(row.rows[0].crawl_state || "null");
    if (!state?.shards?.length) throw new Error("No crawl_state shards on job");

    let reset = 0;
    let kept = 0;
    for (const shard of state.shards) {
      if (shard.id === "im-al" && shard.filters?.fullCrawl && shard.status === "completed") {
        kept++;
        continue;
      }
      if (needsFullRescan(shard)) {
        resetShardForFull(shard);
        reset++;
      } else {
        shard.filters = { ...(shard.filters ?? {}), fullCrawl: true, fullCrawlCountries: ALL_COUNTRIES };
        delete shard.filters.origins;
        kept++;
      }
    }

    // Pick first pending shard (preserve priority order)
    state.currentShardId =
      state.shards.find((s) => s.status === "pending" || s.status === "active")?.id ??
      state.shards.find((s) => s.status !== "completed")?.id ??
      state.currentShardId;

    await pool.query(
      `UPDATE collection_jobs SET job_config = $1, crawl_state = $2, error_message = NULL WHERE id = $3 AND status IN ('paused', 'failed', 'cancelled', 'completed')`,
      [JSON.stringify(jobConfig), JSON.stringify(state), JOB_ID],
    );

    const statusRow = await pool.query("SELECT status, crawl_state FROM collection_jobs WHERE id = $1", [JOB_ID]);
    if (!statusRow.rows[0]?.crawl_state) throw new Error("crawl_state update did not apply — stop the API worker and retry");
    const patched = JSON.parse(statusRow.rows[0].crawl_state);
    verifyPatched(patched);

    console.log(`Updated config (no origins). Reset ${reset} shards for full re-scan, kept ${kept}. Next: ${state.currentShardId}`);

    job = await apiJson(cookie, "POST", `/api/admin/jobs/${JOB_ID}/resume`, { resetProgress: false });
    console.log(`Resumed job ${JOB_ID} → ${job.status}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
