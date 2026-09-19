/**
 * Pause ALL production crawlers (preserve crawl_state / progress),
 * write a resume bookmark, then kick photo mirror backfill only.
 *
 *   node --import ./load-env.mjs ./src/_ops-prod-pause-crawls-mirror-only.mjs
 *   DRY=1 node --import ./load-env.mjs ./src/_ops-prod-pause-crawls-mirror-only.mjs
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import pg from "pg";

const DRY = process.env.DRY === "1";
const BOOKMARK_DIR = path.join(os.tmpdir(), "gca-crawl-bookmarks");
const API = process.env.PROD_API_URL || "https://getcarapi.com";

function loadProd() {
  const p = path.join(os.tmpdir(), "gca-pg-vars-prod.json");
  const raw = fs.readFileSync(p, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) =>
    vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n];
  return {
    host: get("RAILWAY_TCP_PROXY_DOMAIN"),
    port: Number(get("RAILWAY_TCP_PROXY_PORT") || 5432),
    user: get("PGUSER") || get("POSTGRES_USER") || "postgres",
    password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
    database: get("PGDATABASE") || "railway",
    ssl: false,
  };
}

function summarizeCrawlState(raw) {
  if (!raw) return null;
  let st;
  try {
    st = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { parseError: true, head: String(raw).slice(0, 120) };
  }
  const shards = Array.isArray(st.shards) ? st.shards : [];
  const byStatus = {};
  for (const s of shards) {
    const k = s.status || "unknown";
    byStatus[k] = (byStatus[k] || 0) + 1;
  }
  const current =
    shards.find((s) => s.id === st.currentShardId) ||
    shards.find((s) => s.status === "active") ||
    null;
  return {
    currentShardId: st.currentShardId ?? null,
    shardCounts: byStatus,
    current: current
      ? {
          id: current.id,
          status: current.status,
          nextPage: current.nextPage ?? null,
          pagesProcessed: current.pagesProcessed ?? null,
          filters: current.filters ?? null,
          year: current.filters?.year ?? current.year ?? null,
        }
      : null,
  };
}

function summarizeJobConfig(raw) {
  if (!raw) return null;
  let cfg;
  try {
    cfg = typeof raw === "string" ? JSON.parse(raw) : raw;
  } catch {
    return { parseError: true };
  }
  return {
    nextRunAt: cfg.nextRunAt ?? null,
    repeatHours: cfg.repeatHours ?? null,
    yearFrom: cfg.yearFrom ?? cfg.filters?.yearFrom ?? null,
    yearTo: cfg.yearTo ?? cfg.filters?.yearTo ?? null,
    brand: cfg.brand ?? cfg.filters?.brand ?? null,
    mode: cfg.mode ?? null,
    offlineHold: cfg.offlineHold ?? null,
    pausedForMirrorDrain: cfg.pausedForMirrorDrain ?? null,
  };
}

const c = new pg.Client(loadProd());
await c.connect();

const live = await c.query(`
  SELECT j.id, p.internal_name, j.status, j.job_type,
    j.pages_processed, j.items_processed, j.items_discovered,
    j.vins_found, j.vins_new, j.listings_fetched, j.items_failed,
    j.job_config, j.crawl_state, j.started_at, j.updated_at, j.error_message
  FROM collection_jobs j
  JOIN providers p ON p.id = j.provider_id
  WHERE j.status IN ('running', 'pending')
  ORDER BY
    CASE j.status WHEN 'running' THEN 0 ELSE 1 END,
    j.updated_at DESC
`);

const bookmark = {
  savedAt: new Date().toISOString(),
  reason: "pause crawls — mirror drain only",
  jobs: live.rows.map((r) => ({
    id: r.id,
    provider: r.internal_name,
    status: r.status,
    jobType: r.job_type,
    pagesProcessed: r.pages_processed,
    itemsProcessed: r.items_processed,
    itemsDiscovered: r.items_discovered,
    vinsFound: r.vins_found,
    vinsNew: r.vins_new,
    listingsFetched: r.listings_fetched,
    itemsFailed: r.items_failed,
    startedAt: r.started_at,
    updatedAt: r.updated_at,
    errorMessage: r.error_message,
    jobConfig: summarizeJobConfig(r.job_config),
    crawlState: summarizeCrawlState(r.crawl_state),
    // Full blobs for exact resume
    jobConfigRaw: r.job_config,
    crawlStateRaw: r.crawl_state,
  })),
};

fs.mkdirSync(BOOKMARK_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const bookmarkPath = path.join(BOOKMARK_DIR, `prod-crawls-${stamp}.json`);
const latestPath = path.join(BOOKMARK_DIR, "prod-crawls-latest.json");
fs.writeFileSync(bookmarkPath, JSON.stringify(bookmark, null, 2));
fs.writeFileSync(latestPath, JSON.stringify(bookmark, null, 2));

console.log("bookmark", bookmarkPath);
console.log(
  "live jobs",
  live.rows.map((r) => `${r.internal_name}#${r.id}:${r.status}`),
);

if (!DRY && live.rows.length) {
  const ids = live.rows.map((r) => r.id);
  const far = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
  const paused = await c.query(
    `
    UPDATE collection_jobs
    SET status = 'paused',
        error_message = 'paused for mirror drain — resume from bookmark',
        job_config = (
          COALESCE(job_config::jsonb, '{}'::jsonb)
          || jsonb_build_object(
            'pausedForMirrorDrain', true,
            'pausedForMirrorDrainAt', $1::text,
            'nextRunAt', $2::text
          )
        )::text,
        updated_at = now()
    WHERE id = ANY($3::int[])
      AND status IN ('running', 'pending')
    RETURNING id, status
    `,
    [new Date().toISOString(), far, ids],
  );
  console.log("paused", paused.rows.map((r) => r.id));
}

// Cap parallel low so a stray pending job cannot stampede if someone unpauses one.
if (!DRY) {
  await c.query(
    `UPDATE settings SET max_collection_jobs_parallel = 1, updated_at = now() WHERE id = 1`,
  );
}

const after = await c.query(`
  SELECT
    (SELECT count(*)::int FROM collection_jobs WHERE status='running') AS running,
    (SELECT count(*)::int FROM collection_jobs WHERE status='pending') AS pending,
    (SELECT count(*)::int FROM collection_jobs WHERE status='paused') AS paused,
    (SELECT max_collection_jobs_parallel FROM settings ORDER BY id LIMIT 1) AS parallel
`);

const photos = await c.query(`
  SELECT count(*)::bigint AS total,
    count(*) FILTER (
      WHERE stored_path IS NOT NULL
        AND btrim(stored_path) <> ''
        AND stored_path NOT LIKE 'mirror-failed:%'
    )::bigint AS on_cdn,
    count(*) FILTER (
      WHERE stored_path IS NULL OR btrim(stored_path) = ''
    )::bigint AS pending_mirror
  FROM photos
  WHERE source_url NOT ILIKE '%copart.com%'
    AND source_url NOT ILIKE '%iaai.com%'
`);

console.log(DRY ? "[dry-run]" : "[applied]", {
  after: after.rows[0],
  photos: photos.rows[0],
  bookmarkJobs: bookmark.jobs.map((j) => ({
    id: j.id,
    provider: j.provider,
    was: j.status,
    pages: j.pagesProcessed,
    items: j.itemsProcessed,
    vins: j.vinsFound,
    shard: j.crawlState?.current,
  })),
});

await c.end();

// Kick mirror backfill via admin API (optional if creds present).
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!DRY && email && password) {
  try {
    const login = await fetch(`${API}/api/admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!login.ok) throw new Error(`login ${login.status}`);
    const cookie = (login.headers.getSetCookie?.() ?? [])
      .map((x) => x.split(";")[0])
      .join("; ");
    const before = await fetch(`${API}/api/admin/photos/mirror-status`, {
      headers: { Cookie: cookie },
    }).then((r) => r.json());
    console.log("mirror before", before);
    const started = await fetch(`${API}/api/admin/photos/mirror-backfill/start`, {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json" },
    }).then((r) => r.json());
    console.log("mirror start", started);
    await new Promise((r) => setTimeout(r, 5000));
    const afterM = await fetch(`${API}/api/admin/photos/mirror-status`, {
      headers: { Cookie: cookie },
    }).then((r) => r.json());
    console.log("mirror after", afterM);
  } catch (err) {
    console.warn("mirror kick failed (set ADMIN_EMAIL/PASSWORD):", err?.message || err);
  }
} else if (!email || !password) {
  console.log("Skip mirror kick — set ADMIN_EMAIL / ADMIN_PASSWORD to start backfill via API");
}

console.log(`
Resume later:
  1. Open ${latestPath}
  2. Admin → resume each paused job (crawl_state is intact)
  3. Or: UPDATE collection_jobs SET status='pending' WHERE id IN (...)
`);
