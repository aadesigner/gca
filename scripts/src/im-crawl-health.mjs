/**
 * Encar + Import Motor crawl health check / auto-fix.
 *
 * Ensures:
 *  - API is up
 *  - Chrome CDP has IMPORT_MOTOR_CDP_TABS (default 10) page tabs (closes extras)
 *  - CDP pool is rebound via /api/admin/import-motor/cdp-heal
 *  - All worked marketplace crawls (Encar 361+362, Import Motor 360, + prior jobs) running
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
import { healCrawlState, boostForProvider, mergeConfig, SKIP_PROVIDERS } from "./crawl-shared.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STATE_PATH = path.join(ROOT, "scripts", ".im-crawl-health.json");
const API = process.env.API_URL || "http://127.0.0.1:5000";
const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
const WANT_TABS = Math.min(16, Math.max(1, Number(process.env.IMPORT_MOTOR_CDP_TABS || 16) || 16));
const JOB_ID = Number(process.env.IM_JOB_ID || 360);
const ENCAR_JOB_ID = Number(process.env.ENCAR_JOB_ID || 362);
const ENCAR_REFRESH_JOB_ID = Number(process.env.ENCAR_REFRESH_JOB_ID || 361);
/** Balkans + Georgia first — do not expand to full world until these finish. */
const IM_FOCUS_COUNTRIES = [
  "me", "mk", "xk", "ba", "al", "si", "hr", "bg", "rs", "ro", "gr", "ge",
];
/** Aggressive local full crawl — skip already-crawled VINs; JSON-only storage. */
const IM_BOOST = {
  fullCrawl: true,
  countries: IM_FOCUS_COUNTRIES,
  fullCrawlCountries: IM_FOCUS_COUNTRIES,
  concurrency: Math.min(16, Math.max(8, Number(process.env.IMPORT_MOTOR_CONCURRENCY || 16) || 16)),
  delayMs: Math.max(50, Number(process.env.IMPORT_MOTOR_DELAY_MS || 70) || 70),
  skipRecentHours: 0,
  maxPages: 0,
  maxListings: 0,
  retryCount: 5,
  detailLevel: "full",
};
/** Max worker concurrency (see worker.ts cap of 16). */
const ENCAR_BOOST = {
  concurrency: Math.min(16, Math.max(1, Number(process.env.ENCAR_CONCURRENCY || 16) || 16)),
  delayMs: Math.max(50, Number(process.env.ENCAR_DELAY_MS || 100) || 100),
  skipRecentHours: 0,
  maxPages: 0,
  maxListings: 0,
};
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
if (!email || !password) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set in the environment");
}
const STALL_MS = Number(process.env.IM_HEALTH_STALL_MS || 45 * 60 * 1000);
const WATCH = process.argv.includes("--watch");
const WATCH_MS = Math.max(
  60_000,
  Number(process.env.CRAWL_HEALTH_INTERVAL_MS || 6 * 60 * 60 * 1000) || 6 * 60 * 60 * 1000,
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
    try {
      job = await apiJson(cookie, "POST", `/api/admin/jobs/${JOB_ID}/resume`, {
        resetProgress: false,
        jobType: "full_collection",
        filterParams: IM_BOOST,
      });
      note(`im_job_resumed:${job.status}`);
    } catch (e) {
      job = await apiJson(cookie, "GET", `/api/admin/jobs/${JOB_ID}`);
      if (job.status === "pending" || job.status === "running") {
        note(`im_job_resume_skipped:${job.status}`);
      } else {
        fail(`im_resume: ${e.message}`);
      }
    }
  } else if (job.status === "completed") {
    job = await apiJson(cookie, "POST", `/api/admin/jobs/${JOB_ID}/resume`, {
      resetProgress: true,
      jobType: "full_collection",
      filterParams: IM_BOOST,
    });
    note("im_job_restarted_full");
  } else if (job.status === "running" || job.status === "pending") {
    const cfg = job.jobConfig ? JSON.parse(String(job.jobConfig)) : {};
    const isFull =
      job.jobType === "full_collection" ||
      cfg.fullCrawl === true ||
      (Array.isArray(cfg.fullCrawlCountries) && cfg.fullCrawlCountries.length > 0);
    const slow =
      !isFull ||
      Number(cfg.concurrency ?? 0) < IM_BOOST.concurrency ||
      Number(cfg.delayMs ?? 999) > IM_BOOST.delayMs + 10;
    if (slow) {
      if (job.status === "running") {
        await apiJson(cookie, "POST", `/api/admin/jobs/${JOB_ID}/pause`, {});
        note("im_job_paused_for_boost");
        await new Promise((r) => setTimeout(r, 1200));
        job = await apiJson(cookie, "POST", `/api/admin/jobs/${JOB_ID}/resume`, {
          resetProgress: false,
          jobType: "full_collection",
          filterParams: IM_BOOST,
        });
        note("im_job_boosted_full");
      } else if (job.status === "pending") {
        try {
          job = await apiJson(cookie, "POST", `/api/admin/jobs/${JOB_ID}/resume`, {
            resetProgress: false,
            jobType: "full_collection",
            filterParams: IM_BOOST,
          });
          note("im_job_pending_boosted");
        } catch (e) {
          note(`im_job_pending_queued:${e.message}`);
        }
      }
    }
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

async function encarJobIds(cookie) {
  const ids = new Set([ENCAR_JOB_ID, ENCAR_REFRESH_JOB_ID]);
  try {
    const list = await apiJson(cookie, "GET", `/api/admin/jobs?limit=80`);
    for (const j of list.items || []) {
      const name = String(j.providerName || j.internalName || "").toLowerCase();
      if (name.includes("encar") && j.status !== "completed") ids.add(j.id);
    }
  } catch {
    /* keep default ids */
  }
  return [...ids].sort((a, b) => a - b);
}

async function ensureEncarJob(cookie, state) {
  let primary = null;
  for (const encarId of await encarJobIds(cookie)) {
    let job;
    try {
      job = await apiJson(cookie, "GET", `/api/admin/jobs/${encarId}`);
    } catch {
      continue;
    }
    const before = jobSnapshot(job);
    const stalled =
      encarId === ENCAR_JOB_ID &&
      isStalled(job, state.lastEncarProcessed, state.checkedAt);
    const needsResume = ["failed", "paused", "cancelled"].includes(job.status);

    if (needsResume || stalled) {
      if (stalled) note(`encar_stalled_processed=${job.itemsProcessed}`);
      job = await apiJson(cookie, "POST", `/api/admin/jobs/${encarId}/resume`, {
        resetProgress: false,
        filterParams: ENCAR_BOOST,
      });
      note(`encar_job_resumed:${encarId}:${job.status}`);
    } else if (job.status === "completed") {
      note(`encar_job_completed:${encarId}`);
    }

    if (encarId === ENCAR_JOB_ID || !primary || job.status === "running") {
      primary = { job, before };
    }
  }

  if (!primary) {
    const encarId = await resolveJobId(cookie, ENCAR_JOB_ID, ["encar"]);
    const job = await apiJson(cookie, "GET", `/api/admin/jobs/${encarId}`);
    primary = { job, before: jobSnapshot(job) };
  }

  report.encar = {
    id: primary.job.id,
    ...jobSnapshot(primary.job),
    before: primary.before,
    boost: ENCAR_BOOST,
  };
  return primary.job;
}

/** DB fallback: resume failed/paused fleet jobs when admin login is rate-limited. */
async function ensureFleetJobsDb(state) {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const resumed = [];
  try {
    const { rows } = await pool.query(`
      SELECT cj.id, p.internal_name, cj.job_type, cj.status, cj.job_config, cj.crawl_state,
             cj.items_processed, cj.pages_processed
      FROM collection_jobs cj
      JOIN providers p ON p.id = cj.provider_id
      WHERE cj.provider_id IN (
        SELECT DISTINCT provider_id FROM collection_jobs WHERE items_processed > 0
      )
      AND p.internal_name <> ALL($1::text[])
      AND (cj.error_message IS NULL OR cj.error_message NOT LIKE 'superseded%')
      AND NOT (p.internal_name = 'import_motor' AND cj.id <> $2)
      AND NOT (p.internal_name = 'encar' AND cj.id NOT IN ($3, $4))
      AND (
        cj.status IN ('failed', 'paused')
        OR (cj.id IN ($2, $3, $4) AND cj.status IN ('failed', 'paused', 'cancelled'))
      )
      ORDER BY cj.id
    `, [[...SKIP_PROVIDERS], JOB_ID, ENCAR_JOB_ID, ENCAR_REFRESH_JOB_ID]);

    for (const job of rows) {
      const stalled =
        job.status === "running" &&
        state.lastProcessed != null &&
        Number(job.items_processed) === Number(state.lastProcessed) &&
        state.checkedAt &&
        Date.now() - new Date(state.checkedAt).getTime() >= STALL_MS;

      const needs = ["failed", "paused", "cancelled"].includes(job.status) || stalled;
      if (!needs) continue;

      const healed = healCrawlState(job.crawl_state);
      const boost = boostForProvider(job.internal_name, job.job_type);
      await pool.query(
        `UPDATE collection_jobs
         SET status = 'pending', completed_at = NULL, error_message = NULL,
             job_config = $1, crawl_state = $2, updated_at = NOW()
         WHERE id = $3`,
        [mergeConfig(job.job_config, boost), healed.json, job.id],
      );
      resumed.push(`${job.internal_name}:${job.id}`);
    }

    const pinned = await pool.query(
      `SELECT id, status, job_type, job_config FROM collection_jobs WHERE id = $1`,
      [JOB_ID],
    );
    const im = pinned.rows[0];
    if (im && im.status !== "running") {
      const cfg = im.job_config ? JSON.parse(im.job_config) : {};
      const boost = boostForProvider("import_motor", "full_collection");
      delete cfg.nextRunAt;
      delete cfg.origins;
      const next = { ...cfg, ...boost, fullCrawl: true, maxPages: 0, maxListings: 0 };
      await pool.query(
        `UPDATE collection_jobs
         SET status = 'pending', job_type = 'full_collection', completed_at = NULL, error_message = NULL,
             job_config = $1, updated_at = NOW()
         WHERE id = $2 AND status <> 'running'`,
        [JSON.stringify(next), JOB_ID],
      );
      resumed.push(`import_motor:${JOB_ID}:full`);
    }
  } finally {
    await pool.end();
  }
  if (resumed.length) note(`fleet_db_resumed:${resumed.join(",")}`);
  return resumed;
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
            AND raw_json !~* '<(!DOCTYPE|html|head|body)[[:space:]>]'
        )::int AS json_ok,
        count(*) FILTER (
          WHERE raw_json IS NOT NULL
            AND btrim(raw_json) <> ''
            AND (
              left(ltrim(raw_json), 1) NOT IN ('{', '[')
              OR raw_json ~* '<(!DOCTYPE|html|head|body)[[:space:]>]'
            )
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

  let cookie = null;
  try {
    cookie = await login();
  } catch (e) {
    fail(`login: ${e.message}`);
    try {
      await ensureFleetJobsDb(state);
    } catch (dbErr) {
      fail(`fleet_db: ${dbErr.message}`);
    }
    if (!WATCH) {
      writeState({
        checkedAt: report.t,
        lastProcessed: state.lastProcessed,
        lastStatus: state.lastStatus,
        lastPages: state.lastPages,
        lastEncarProcessed: state.lastEncarProcessed,
        lastEncarStatus: state.lastEncarStatus,
        lastEncarPages: state.lastEncarPages,
        lastReport: report,
      });
      return report;
    }
  }

  if (!cookie) {
    try {
      await ensureChromeTabs();
    } catch (e) {
      fail(`cdp_tabs: ${e.message}`);
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
      lastProcessed: state.lastProcessed,
      lastStatus: state.lastStatus,
      lastPages: state.lastPages,
      lastEncarProcessed: state.lastEncarProcessed,
      lastEncarStatus: state.lastEncarStatus,
      lastEncarPages: state.lastEncarPages,
      lastReport: report,
    });
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
    await ensureFleetJobsDb(state);
  } catch (e) {
    fail(`fleet_db: ${e.message}`);
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
