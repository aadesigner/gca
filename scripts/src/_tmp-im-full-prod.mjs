/**
 * One-shot: patch prod IM job 360 to full crawl (no origins:korean) and resume.
 */
import pg from "pg";

const API = process.env.API_URL || "https://getcarapi.com";
const JOB_ID = Number(process.env.IM_JOB_ID || 360);
const email = process.env.ADMIN_EMAIL;
const passwordAdmin = process.env.ADMIN_PASSWORD;

const ALL = [
  "me", "mk", "xk", "ba", "al", "si", "hr", "bg", "rs", "ro", "gr", "ge", "am", "az", "md",
  "ee", "lv", "lt", "sk", "hu", "cz", "fi", "ie", "pt", "at", "be", "nl", "se", "no", "dk",
  "ch", "pl", "es", "it", "fr", "de", "gb", "ua", "cy", "jo", "lb", "bh", "qa", "kw", "om",
  "ae", "il", "iq", "sa", "tr", "ru", "*rest",
];

async function login() {
  const res = await fetch(`${API}/api/admin/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: passwordAdmin }),
  });
  if (!res.ok) throw new Error(`login ${res.status}`);
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
}

async function api(cookie, method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { Cookie: cookie, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} ${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const pool = new pg.Pool({
  host: process.env.PROD_PG_HOST || "yamanote.proxy.rlwy.net",
  port: Number(process.env.PROD_PG_PORT || "15622"),
  user: process.env.PROD_PG_USER || "postgres",
  password: process.env.PGPASSWORD || process.env.PROD_PG_PASSWORD,
  database: process.env.PROD_PG_DATABASE || "railway",
  ssl: false,
});

const cookie = await login();
let job = await api(cookie, "GET", `/api/admin/jobs/${JOB_ID}`);
console.log("before", job.status);

if (job.status === "running" || job.status === "pending") {
  await api(cookie, "POST", `/api/admin/jobs/${JOB_ID}/pause`, {});
  for (let i = 0; i < 40; i++) {
    const r = await pool.query("SELECT status FROM collection_jobs WHERE id = $1", [JOB_ID]);
    if (r.rows[0]?.status === "paused") break;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

const row = await pool.query(
  "SELECT status, job_config, crawl_state FROM collection_jobs WHERE id = $1",
  [JOB_ID],
);
console.log("db status", row.rows[0].status);

const jobConfig = JSON.parse(row.rows[0].job_config);
delete jobConfig.origins;
Object.assign(jobConfig, {
  fullCrawl: true,
  fullCrawlCountries: ALL,
  detailLevel: "full",
  skipRecentHours: 0,
  maxPages: 0,
  maxListings: 0,
  concurrency: 10,
  delayMs: 50,
  retryCount: 5,
  countries: ALL,
});

const state = JSON.parse(row.rows[0].crawl_state || "null");
if (!state?.shards?.length) throw new Error("no shards");

let reset = 0;
let kept = 0;
for (const shard of state.shards) {
  if (shard.id === "im-al" && shard.filters?.fullCrawl && shard.status === "completed") {
    kept++;
    continue;
  }
  const needs =
    Boolean(shard.filters?.origins?.length) ||
    !shard.filters?.fullCrawl ||
    (shard.status === "completed" && (shard.pagesProcessed ?? 0) > 0 && !shard.filters?.fullCrawl);
  if (needs) {
    const m = /^im-(rest|[a-z]{2})$/.exec(shard.id || "");
    const cc = shard.filters?.countries?.[0] || (m ? (m[1] === "rest" ? "*rest" : m[1]) : null);
    shard.filters = {
      ...(shard.filters || {}),
      countries: cc ? [cc] : shard.filters?.countries,
      fullCrawl: true,
      fullCrawlCountries: ALL,
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
    reset++;
  } else {
    shard.filters = { ...(shard.filters || {}), fullCrawl: true, fullCrawlCountries: ALL };
    delete shard.filters.origins;
    kept++;
  }
}

state.currentShardId =
  state.shards.find((s) => s.status === "pending" || s.status === "active")?.id ||
  state.currentShardId;

const upd = await pool.query(
  `UPDATE collection_jobs
   SET job_config = $1, crawl_state = $2, error_message = NULL
   WHERE id = $3 AND status IN ('paused', 'failed', 'cancelled', 'completed')
   RETURNING status`,
  [JSON.stringify(jobConfig), JSON.stringify(state), JOB_ID],
);
if (!upd.rowCount) throw new Error(`update skipped status=${row.rows[0].status}`);

const me = state.shards.find((s) => s.id === "im-me");
console.log({
  reset,
  kept,
  meFull: !!me?.filters?.fullCrawl,
  meOrigins: me?.filters?.origins || null,
  next: state.currentShardId,
});

job = await api(cookie, "POST", `/api/admin/jobs/${JOB_ID}/resume`, { resetProgress: false });
const cfg = JSON.parse(job.jobConfig || "{}");
console.log({
  resumed: job.status,
  origins: cfg.origins || null,
  fullCrawl: cfg.fullCrawl || null,
  countries: Array.isArray(cfg.fullCrawlCountries) ? cfg.fullCrawlCountries.length : 0,
});

await pool.end();
