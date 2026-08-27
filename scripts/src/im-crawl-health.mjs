/**
 * Encar + Import Motor crawl health check / auto-fix.
 *
 * Ensures:
 *  - API is up
 *  - Chrome CDP has IMPORT_MOTOR_CDP_TABS (default 10) page tabs (closes extras)
 *  - CDP pool is rebound via /api/admin/import-motor/cdp-heal
 *  - Job 360 (IM) and job 201 (Encar) are running; resume if failed/paused/stuck
 *  - R2 mirror backlog is moving; kick a small mirror batch if needed
 *
 * Usage:
 *   node --import ./scripts/load-env.mjs ./scripts/src/im-crawl-health.mjs
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
const ENCAR_JOB_ID = Number(process.env.ENCAR_JOB_ID || 201);
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in the environment");
}
const STALL_MS = Number(process.env.IM_HEALTH_STALL_MS || 25 * 60 * 1000);

const actions = [];
const report = {
  t: new Date().toISOString(),
  ok: true,
  actions,
  api: null,
  cdp: null,
  job: null,
  encar: null,
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
  const needsHeal =
    needsResume ||
    stalled ||
    (tabInfo?.opened ?? 0) > 0 ||
    (tabInfo?.closed ?? 0) > 0 ||
    (tabInfo?.pages ?? 0) !== WANT_TABS;

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

async function ensureEncarJob(cookie, state) {
  let job = await apiJson(cookie, "GET", `/api/admin/jobs/${ENCAR_JOB_ID}`);
  const before = jobSnapshot(job);
  const stalled = isStalled(job, state.lastEncarProcessed, state.checkedAt);
  const needsResume = ["failed", "paused", "cancelled"].includes(job.status);

  if (needsResume || stalled) {
    if (stalled) note(`encar_stalled_processed=${job.itemsProcessed}`);
    job = await apiJson(cookie, "POST", `/api/admin/jobs/${ENCAR_JOB_ID}/resume`, {
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

async function mirrorStats() {
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
  });
  try {
    // Avoid full-table scans — only inspect recent crawl photos.
    const recent = await pool.query(`
      SELECT
        count(*)::int AS created30m,
        count(*) FILTER (WHERE stored_path IS NOT NULL)::int AS mirrored30m,
        count(*) FILTER (WHERE stored_path IS NULL)::int AS pending30m
      FROM photos
      WHERE created_at > now() - interval '30 minutes'
        AND (
          source_url ILIKE '%import-motor.com%'
          OR source_url ILIKE '%vis.iaai.com%'
          OR source_url ILIKE '%mediaretriever.iaai.com%'
        )
    `);
    return {
      pending30m: recent.rows[0]?.pending30m ?? 0,
      created30m: recent.rows[0]?.created30m ?? 0,
      mirrored30m: recent.rows[0]?.mirrored30m ?? 0,
    };
  } finally {
    await pool.end();
  }
}

async function kickMirrorIfNeeded(stats) {
  report.mirror = { ...stats, kicked: false };
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

async function main() {
  const state = readState();

  try {
    const health = await fetch(`${API}/api/healthz`);
    report.api = { ok: health.ok, status: health.status };
    if (!health.ok) fail("api_down");
  } catch (e) {
    report.api = { ok: false, error: e.message };
    fail(`api: ${e.message}`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  let tabInfo = null;
  try {
    await ensureChromeTabs();
    tabInfo = report.cdp;
  } catch (e) {
    fail(`cdp_tabs: ${e.message}`);
  }

  let cookie;
  try {
    cookie = await login();
  } catch (e) {
    fail(`login: ${e.message}`);
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  let job;
  try {
    job = await ensureJob(cookie, state, tabInfo);
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
    const stats = await mirrorStats();
    await kickMirrorIfNeeded(stats);
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
  });

  console.log(JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
