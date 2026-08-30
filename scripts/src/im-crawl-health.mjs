/**
 * Encar + Import Motor crawl health check / auto-fix.
 *
 * Ensures:
 *  - API is up
 *  - Chrome CDP has IMPORT_MOTOR_CDP_TABS (default 10) page tabs (closes extras)
 *  - CDP pool is rebound via /api/admin/import-motor/cdp-heal
 *  - Job 360 (IM) and job 361 (Encar listing_refresh) are running; resume if failed/paused/stuck
 *  - Recent raw_source_records are JSON objects (never HTML pages)
 *  - New photos are landing on Cloudflare R2 (imgsv.getcarapi.com)
 *
 * Usage:
 *   node --import ./scripts/load-env.mjs ./scripts/src/im-crawl-health.mjs
 *   node --import ./scripts/load-env.mjs ./scripts/src/im-crawl-health.mjs --watch
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STATE_PATH = path.join(ROOT, "scripts", ".im-crawl-health.json");
const API = process.env.API_URL || "http://127.0.0.1:5000";
const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
const WANT_TABS = Math.min(16, Math.max(1, Number(process.env.IMPORT_MOTOR_CDP_TABS || 10) || 10));
const JOB_ID = Number(process.env.IM_JOB_ID || 360);
const ENCAR_JOB_ID = Number(process.env.ENCAR_JOB_ID || 362);
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in the environment");
}
const STALL_MS = Number(process.env.IM_HEALTH_STALL_MS || 45 * 60 * 1000);
const WATCH = process.argv.includes("--watch");
const WATCH_MS = Math.max(
  60_000,
  Number(process.env.CRAWL_HEALTH_INTERVAL_MS || 4 * 60 * 60 * 1000) || 4 * 60 * 60 * 1000,
);
const WINDOW_HOURS = Math.max(1, Math.round(WATCH_MS / 36e5) || 3);

const actions = [];
const report = {
  t: new Date().toISOString(),
  ok: true,
  actions,
  api: null,
  cdp: null,
  job: null,
  encar: null,
  json: null,
  mirror: null,
  errors: [],
};

function note(action) {
  actions.push(action);
}

function fail(msg) {
  report.ok = false;
  report.errors.push(msg);
}

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
    headers: {
      Cookie: cookie,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = { raw: text };
  }
  if (!res.ok) throw new Error(`${method} ${urlPath} → ${res.status} ${text.slice(0, 200)}`);
  return json;
}

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return {};
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

async function listPageTabs() {
  const tabs = await (await fetch(`${CDP}/json/list`)).json();
  return (tabs || []).filter(
    (t) => t.type === "page" && t.webSocketDebuggerUrl && !/^chrome/i.test(t.url || ""),
  );
}

async function openTab() {
  const url = encodeURIComponent("https://import-motor.com/buyer-locations");
  for (const method of ["PUT", "GET"]) {
    try {
      const res = await fetch(`${CDP}/json/new?${url}`, { method });
      if (!res.ok) continue;
      const tab = await res.json();
      if (tab?.webSocketDebuggerUrl) return tab;
    } catch {
      /* try next */
    }
  }
  throw new Error("failed to open CDP tab");
}

async function ensureChromeTabs() {
  let pages = await listPageTabs();
  const opened = [];
  const closed = [];
  // Cap runaway tab storms from prior heal loops.
  while (pages.length > WANT_TABS) {
    const extra = pages[pages.length - 1];
    try {
      await fetch(`${CDP}/json/close/${extra.id}`);
      closed.push(String(extra.id).slice(0, 8));
    } catch {
      break;
    }
    pages = await listPageTabs();
  }
  while (pages.length < WANT_TABS) {
    const tab = await openTab();
    opened.push(tab.id);
    note(`opened_cdp_tab:${String(tab.id).slice(0, 8)}`);
    await new Promise((r) => setTimeout(r, 200));
    pages = await listPageTabs();
  }
  if (closed.length) note(`closed_extra_tabs:${closed.length}`);
  report.cdp = {
    want: WANT_TABS,
    pages: pages.length,
    opened: opened.length,
    closed: closed.length,
    sample: pages.slice(0, 3).map((t) => ({ title: t.title, url: t.url })),
  };
  return pages;
}

function jobSnapshot(job) {
  return {
    status: job.status,
    pages: job.pagesProcessed,
    processed: job.itemsProcessed,
    failed: job.itemsFailed,
    vins: job.vinsFound,
    err: job.errorMessage || null,
  };
}

function isStalled(job, lastProcessed, checkedAt) {
  return (
    job.status === "running" &&
    lastProcessed != null &&
    Number(job.itemsProcessed) === Number(lastProcessed) &&
    checkedAt &&
    Date.now() - new Date(checkedAt).getTime() >= STALL_MS
  );
}

async function ensureJob(cookie, state, tabInfo) {
  let job = await apiJson(cookie, "GET", `/api/admin/jobs/${JOB_ID}`);
  const before = jobSnapshot(job);

  const stalled = isStalled(job, state.lastProcessed, state.checkedAt);
  const needsResume = ["failed", "paused", "cancelled"].includes(job.status);
  // Never reset the CDP pool just because tab count drifted — that stalls a live crawl.
  const needsHeal = needsResume || stalled;

  if (needsHeal) {
    if (stalled) note(`job_stalled_processed=${job.itemsProcessed}`);
    try {
      const heal = await apiJson(cookie, "POST", "/api/admin/import-motor/cdp-heal", {});
      note(`cdp_heal_pool=${heal.poolSize}/chrome=${heal.chromePages}`);
    } catch (e) {
      fail(`cdp_heal: ${e.message}`);
    }
  }

  if (stalled && job.status === "running") {
    try {
      await apiJson(cookie, "POST", `/api/admin/jobs/${JOB_ID}/pause`, {});
      note("im_job_paused_for_stall");
      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      fail(`im_pause: ${e.message}`);
    }
  }

  if (needsResume || stalled) {
    job = await apiJson(cookie, "POST", `/api/admin/jobs/${JOB_ID}/resume`, {
      resetProgress: false,
    });
    note(`im_job_resumed:${job.status}`);
  } else if (job.status === "completed") {
    note("im_job_completed");
  }

  report.job = {
    id: job.id,
    ...jobSnapshot(job),
    before,
  };
  return job;
}

async function resolveJobId(cookie, preferId, nameHints) {
  try {
    const job = await apiJson(cookie, "GET", `/api/admin/jobs/${preferId}`);
    if (job && ["running", "pending", "paused", "failed"].includes(job.status)) {
      return preferId;
    }
  } catch {
    /* fall through and discover */
  }
  try {
    const list = await apiJson(cookie, "GET", `/api/admin/jobs?limit=50`);
    const items = list.items || [];
    const hit = items.find((j) => {
      const name = String(j.providerName || j.internalName || "").toLowerCase();
      return nameHints.some((h) => name.includes(h)) && ["running", "pending", "paused", "failed"].includes(j.status);
    });
    if (hit?.id) {
      note(`resolved_job:${nameHints[0]}=${hit.id}`);
      return hit.id;
    }
  } catch (e) {
    fail(`resolve_job ${nameHints[0]}: ${e.message}`);
  }
  return preferId;
}

async function ensureEncarJob(cookie, state) {
  const encarId = await resolveJobId(cookie, ENCAR_JOB_ID, ["encar"]);
  let job = await apiJson(cookie, "GET", `/api/admin/jobs/${encarId}`);
  const before = jobSnapshot(job);
  const stalled = isStalled(job, state.lastEncarProcessed, state.checkedAt);
  const needsResume = ["failed", "paused", "cancelled"].includes(job.status);

  if (needsResume || stalled) {
    if (stalled) note(`encar_stalled_processed=${job.itemsProcessed}`);
    job = await apiJson(cookie, "POST", `/api/admin/jobs/${encarId}/resume`, {
      resetProgress: false,
    });
    note(`encar_job_resumed:${job.status}`);
  } else if (job.status === "completed") {
    note("encar_job_completed");
  }

  report.encar = {
    id: job.id,
    ...jobSnapshot(job),
    before,
  };
  return job;
}

async function jsonIngestStats() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const htmlCol = await pool.query(`
      SELECT 1 AS ok
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'raw_source_records'
        AND column_name = 'raw_html'
      LIMIT 1
    `);
    const recent = await pool.query(
      `
      SELECT
        count(*)::int AS recent,
        count(*) FILTER (
          WHERE raw_json IS NOT NULL
            AND btrim(raw_json) <> ''
            AND raw_json <> 'null'
            AND left(ltrim(raw_json), 1) IN ('{', '[')
        )::int AS json_ok,
        count(*) FILTER (
          WHERE raw_json IS NOT NULL
            AND btrim(raw_json) <> ''
            AND left(ltrim(raw_json), 1) NOT IN ('{', '[')
        )::int AS html_documents
      FROM raw_source_records
      WHERE created_at > now() - ($1::int * interval '1 hour')
      `,
      [WINDOW_HOURS],
    );
    const listings = await pool.query(
      `
      SELECT
        p.internal_name AS provider,
        count(*) FILTER (WHERE l.created_at > now() - ($1::int * interval '1 hour'))::int AS created,
        count(*) FILTER (WHERE l.updated_at > now() - ($1::int * interval '1 hour'))::int AS updated
      FROM listings l
      JOIN providers p ON p.id = l.provider_id
      WHERE p.internal_name IN ('encar', 'import_motor')
        AND (l.created_at > now() - ($1::int * interval '1 hour')
          OR l.updated_at > now() - ($1::int * interval '1 hour'))
      GROUP BY p.internal_name
      `,
      [WINDOW_HOURS],
    );
    return {
      hours: WINDOW_HOURS,
      htmlColumnPresent: htmlCol.rows.length > 0,
      recent: recent.rows[0]?.recent ?? 0,
      jsonOk: recent.rows[0]?.json_ok ?? 0,
      htmlDocuments: recent.rows[0]?.html_documents ?? 0,
      listings: listings.rows,
    };
  } finally {
    await pool.end();
  }
}

async function mirrorStats() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });
  try {
    const recent = await pool.query(
      `
      SELECT
        count(*)::int AS created,
        count(*) FILTER (
          WHERE stored_path IS NOT NULL
            AND stored_path ~* 'imgsv\\.getcarapi\\.com|\\.r2\\.dev/'
        )::int AS mirrored_cdn,
        count(*) FILTER (WHERE stored_path IS NULL)::int AS pending
      FROM photos
      WHERE created_at > now() - ($1::int * interval '1 hour')
      `,
      [WINDOW_HOURS],
    );
    return {
      hours: WINDOW_HOURS,
      created: recent.rows[0]?.created ?? 0,
      mirroredCdn: recent.rows[0]?.mirrored_cdn ?? 0,
      pending: recent.rows[0]?.pending ?? 0,
    };
  } finally {
    await pool.end();
  }
}

async function kickMirrorIfNeeded(stats) {
  report.mirror = { ...stats, kicked: false };
  if ((stats.pending ?? 0) === 0) return;
  // Always nudge a small batch so crawl photos (incl. iaai/3d) keep moving even if
  // the host-filtered import-motor loop is busy on older backlog.
  const child = spawn(
    process.execPath,
    [
      "--import",
      path.join(ROOT, "scripts", "load-env.mjs"),
      "--enable-source-maps",
      path.join(ROOT, "artifacts", "api-server", "dist", "cli", "mirror-photos.mjs"),
      "--limit",
      "80",
      "--concurrency",
      "6",
    ],
    {
      cwd: path.join(ROOT, "artifacts", "api-server"),
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    },
  );
  child.unref();
  report.mirror.kicked = true;
  note("mirror_batch_kicked");
}

async function runOnce() {
  actions.length = 0;
  report.ok = true;
  report.t = new Date().toISOString();
  report.errors = [];
  report.api = null;
  report.cdp = null;
  report.job = null;
  report.encar = null;
  report.json = null;
  report.mirror = null;

  const state = readState();

  try {
    const health = await fetch(`${API}/api/healthz`);
    report.api = { ok: health.ok, status: health.status };
    if (!health.ok) fail("api_down");
  } catch (e) {
    report.api = { ok: false, error: e.message };
    fail(`api: ${e.message}`);
    return report;
  }

  let cookie;
  try {
    cookie = await login();
  } catch (e) {
    fail(`login: ${e.message}`);
    return report;
  }

  let jobPeek = null;
  try {
    jobPeek = await apiJson(cookie, "GET", `/api/admin/jobs/${JOB_ID}`);
  } catch {
    /* tabs still get a chance below if Chrome is empty */
  }
  const imLive = jobPeek?.status === "running";
  const imStalled = jobPeek ? isStalled(jobPeek, state.lastProcessed, state.checkedAt) : false;

  let tabInfo = null;
  if (!imLive || imStalled) {
    try {
      await ensureChromeTabs();
      tabInfo = report.cdp;
    } catch (e) {
      fail(`cdp_tabs: ${e.message}`);
    }
  } else {
    try {
      const pages = await listPageTabs();
      report.cdp = { want: WANT_TABS, pages: pages.length, opened: 0, closed: 0, skipped: "im_running" };
    } catch (e) {
      report.cdp = { error: e.message, skipped: "im_running" };
    }
  }

  let job;
  try {
    job = await ensureJob(cookie, state, tabInfo);
    const cfg = job?.jobConfig ? JSON.parse(String(job.jobConfig)) : {};
    if (cfg.origins?.length) {
      note("im_korean_only_mode_auto_fix");
      try {
        const { spawnSync } = await import("node:child_process");
        const fix = spawnSync(
          process.execPath,
          ["--import", path.join(ROOT, "scripts", "load-env.mjs"), path.join(ROOT, "scripts", "src", "im-enable-full-crawl.mjs")],
          { cwd: ROOT, encoding: "utf8", timeout: 240_000 },
        );
        if (fix.status !== 0) fail(`im_full_crawl_fix: ${fix.stderr || fix.stdout || fix.status}`);
        else note("im_full_crawl_enabled");
        job = await apiJson(cookie, "GET", `/api/admin/jobs/${JOB_ID}`);
      } catch (e) {
        fail(`im_full_crawl_fix: ${e.message}`);
      }
    }
  } catch (e) {
    fail(`job: ${e.message}`);
  }

  let encar;
  try {
    encar = await ensureEncarJob(cookie, state);
  } catch (e) {
    fail(`encar: ${e.message}`);
  }

  try {
    const json = await jsonIngestStats();
    report.json = json;
    if (json.htmlColumnPresent) fail("raw_html column still present");
    if (json.htmlDocuments > 0) fail(`${json.htmlDocuments} raw rows in the last ${WINDOW_HOURS}h are not JSON`);
    if (json.recent > 0) note(`json_ok=${json.jsonOk}/${json.recent}`);
  } catch (e) {
    fail(`json: ${e.message}`);
  }

  try {
    const stats = await mirrorStats();
    await kickMirrorIfNeeded(stats);
    if (stats.created >= 20 && stats.mirroredCdn === 0) {
      fail(`Cloudflare photo upload stalled (${stats.created} new photos, 0 CDN)`);
    }
  } catch (e) {
    fail(`mirror: ${e.message}`);
  }

  writeState({
    checkedAt: report.t,
    lastProcessed: job?.itemsProcessed ?? state.lastProcessed,
    lastStatus: job?.status ?? state.lastStatus,
    lastPages: job?.pagesProcessed ?? state.lastPages,
    lastEncarProcessed: encar?.itemsProcessed ?? state.lastEncarProcessed,
    lastEncarStatus: encar?.status ?? state.lastEncarStatus,
    lastEncarPages: encar?.pagesProcessed ?? state.lastEncarPages,
    lastReport: report,
  });

  return report;
}

async function main() {
  const first = await runOnce();
  console.log(JSON.stringify(first, null, 2));
  if (!WATCH) process.exit(first.ok ? 0 : 1);

  console.error(`crawl-health watch every ${WINDOW_HOURS}h`);
  for (;;) {
    await new Promise((r) => setTimeout(r, WATCH_MS));
    const next = await runOnce();
    console.log(JSON.stringify(next, null, 2));
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
