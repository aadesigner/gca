/**
 * Import Motor crawl health check + auto-repair for job 360
 * (Balkans → Europe → Middle East → Russia → *rest).
 * Exit 0 = healthy or repaired; exit 2 = needs human (CF stuck).
 */
import pg from "pg";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const JOB_IDS = []; // Import Motor crawl parked — do not auto-revive
const STALE_SEC = 10 * 60; // no DB update → consider stalled
const API = "http://127.0.0.1:5000";
const CDP = "http://127.0.0.1:9222";

function loadEnv() {
  const raw = fs.readFileSync(path.join(ROOT, ".env"), "utf8");
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

loadEnv();

const actions = [];
const report = { at: new Date().toISOString(), jobs: {}, cdp: {}, api: false, actions };

async function checkApi() {
  try {
    const res = await fetch(`${API}/api/healthz`, { signal: AbortSignal.timeout(8000) });
    report.api = res.ok;
    return res.ok ? "ok" : null;
  } catch {
    report.api = false;
    return null;
  }
}

async function ensureApiUp() {
  let cookie = await checkApi();
  if (cookie) return cookie;
  actions.push("restart_api");
  const { spawn } = await import("child_process");
  const cwd = path.join(ROOT, "artifacts", "api-server");
  spawn(
    "node",
    [
      "--import",
      "../../scripts/load-env.mjs",
      "--enable-source-maps",
      "--max-old-space-size=8192",
      "./dist/index.mjs",
    ],
    { cwd, detached: true, stdio: "ignore", windowsHide: true },
  ).unref();
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    cookie = await checkApi();
    if (cookie) {
      actions.push("api_ok");
      return cookie;
    }
  }
  actions.push("api_restart_failed");
  return null;
}

async function checkCdp() {
  try {
    const tabs = await (await fetch(`${CDP}/json/list`, { signal: AbortSignal.timeout(4000) })).json();
    const pages = tabs.filter((t) => t.type === "page");
    const im = pages.filter((t) => /import-motor/i.test(t.url || ""));
    const cf = pages.filter((t) => /just a moment|attention required/i.test(t.title || "")).length;
    const vin = im.filter((t) => /\/v\/[A-HJ-NPR-Z0-9]{17}/i.test(t.url || "")).length;
    const list = im.filter((t) => /buyer-locations\/[a-z]{2}/i.test(t.url || "")).length;
    report.cdp = { pages: pages.length, im: im.length, cf, vin, list, ok: true };
    return { pages, cf, ok: true };
  } catch (e) {
    report.cdp = { ok: false, error: String(e.message || e) };
    return { pages: [], cf: 0, ok: false };
  }
}

async function tryClearCf(pages) {
  const page = pages.find((t) => t.webSocketDebuggerUrl);
  if (!page) return false;
  try {
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    let id = 1;
    const pending = new Map();
    const send = (method, params, timeout = 12000) =>
      new Promise((resolve, reject) => {
        const mid = id++;
        const t = setTimeout(() => {
          pending.delete(mid);
          reject(new Error(`${method} timeout`));
        }, timeout);
        pending.set(mid, { resolve, reject, t });
        ws.send(JSON.stringify({ id: mid, method, params }));
      });
    ws.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id == null) return;
      const p = pending.get(msg.id);
      if (!p) return;
      clearTimeout(p.t);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error.message));
      else p.resolve(msg.result);
    };
    await new Promise((r, j) => {
      ws.onopen = r;
      ws.onerror = () => j(new Error("ws fail"));
      setTimeout(() => j(new Error("open timeout")), 5000);
    });
    await send("Page.enable");
    await send("Network.enable");
    await send("Page.navigate", { url: "https://import-motor.com/buyer-locations/me?page=1" });
    let cleared = false;
    for (let i = 0; i < 25; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const ev = await send("Runtime.evaluate", {
        returnByValue: true,
        expression: `({title:document.title,len:(document.documentElement||{}).outerHTML?.length||0,show:/Showing\\s+\\d+/i.test(document.body?.innerText||'')})`,
      });
      const v = ev.result?.value;
      if (v && !/just a moment/i.test(v.title || "") && (v.len > 40000 || v.show)) {
        cleared = true;
        break;
      }
    }
    if (cleared) {
      const cookies = await send("Network.getCookies", { urls: ["https://import-motor.com/"] });
      const wanted = ["cf_clearance", "XSRF-TOKEN", "import_motor_session", "locale"];
      const parts = [];
      for (const name of wanted) {
        const c = cookies.cookies?.find((x) => x.name === name);
        if (c) parts.push(`${c.name}=${c.value}`);
      }
      if (parts.length) {
        const envPath = path.join(ROOT, ".env");
        let env = fs.readFileSync(envPath, "utf8");
        const line = `IMPORT_MOTOR_COOKIE=${parts.join("; ")}`;
        if (/^IMPORT_MOTOR_COOKIE=/m.test(env)) {
          env = env.replace(/^IMPORT_MOTOR_COOKIE=.*$/m, line);
        } else {
          env += `\n${line}\n`;
        }
        fs.writeFileSync(envPath, env);
        actions.push("refreshed_import_motor_cookie");
      }
    }
    ws.close();
    return cleared;
  } catch (e) {
    actions.push(`cf_probe_error:${e.message}`);
    return false;
  }
}

async function repairJobs(pool) {
  for (const id of JOB_IDS) {
    const { rows } = await pool.query(
      `SELECT id, status, items_processed, items_failed, listings_fetched, error_message, updated_at, crawl_state, job_config
       FROM collection_jobs WHERE id=$1`,
      [id],
    );
    const j = rows[0];
    if (!j) continue;
    const ago = Math.round((Date.now() - new Date(j.updated_at).getTime()) / 1000);
    report.jobs[id] = {
      status: j.status,
      processed: j.items_processed,
      failed: j.items_failed,
      fetched: j.listings_fetched,
      agoSec: ago,
      err: (j.error_message || "").slice(0, 120),
    };

    let s = j.crawl_state;
    if (typeof s === "string") s = JSON.parse(s);
    let cfg = j.job_config;
    if (typeof cfg === "string") cfg = JSON.parse(cfg);

    const badStatus = ["failed", "paused", "pending"].includes(j.status);
    if (j.status === "cancelled") continue;
    const stalled = j.status === "running" && ago > STALE_SEC;
    // A sibling shard in cooldown (e.g. XK) must not requeue a healthy running job —
    // that resets XK to pending and steals the cursor from Georgia.
    if (j.status === "running" && !stalled) continue;
    const cooldown =
      Array.isArray(s?.shards) &&
      s.shards.some(
        (sh) =>
          sh.status === "cooldown" ||
          (sh.cooldownUntil && Date.parse(sh.cooldownUntil) > Date.now()),
      );

    if (!badStatus && !stalled && !cooldown && j.status === "running") continue;

    if (s?.shards) {
      for (const sh of s.shards) {
        sh.lastError = null;
        sh.cooldownUntil = null;
        if (sh.status === "cooldown" || sh.status === "failed") sh.status = "pending";
        if (sh.expectedTotalPages > 100_000) sh.expectedTotalPages = null;
        if (sh.filters) {
          sh.filters.concurrency = Math.max(sh.filters.concurrency ?? 5, 5);
          sh.filters.delayMs = Math.min(sh.filters.delayMs ?? 120, 120);
        }
      }
      s.lastBlock = null;
    }
    if (cfg) {
      cfg.concurrency = Math.max(cfg.concurrency ?? 5, 5);
      cfg.delayMs = Math.min(cfg.delayMs ?? 120, 120);
    }

    await pool.query(
      `UPDATE collection_jobs
       SET status='pending', error_message=NULL, completed_at=NULL,
           crawl_state=$2::jsonb, job_config=$3::jsonb, updated_at=now()
       WHERE id=$1`,
      [id, JSON.stringify(s), JSON.stringify(cfg)],
    );
    actions.push(`requeued_job_${id}:${j.status}${stalled ? "+stale" : ""}${cooldown ? "+cooldown" : ""}`);
    report.jobs[id].repaired = true;
  }
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  const cookie = await ensureApiUp();
  if (!cookie) {
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  const cdp = await checkCdp();
  if (!cdp.ok) {
    actions.push("cdp_unreachable");
    console.log(JSON.stringify(report, null, 2));
    process.exit(2);
  }

  if (cdp.cf >= 3) {
    actions.push(`cf_tabs_${cdp.cf}`);
    const cleared = await tryClearCf(cdp.pages);
    if (!cleared) {
      actions.push("cf_needs_human");
      console.log(JSON.stringify(report, null, 2));
      process.exit(2);
    }
    actions.push("cf_auto_cleared");
    // Re-check after clear
    await checkCdp();
  }

  await repairJobs(pool);
  console.log(JSON.stringify(report, null, 2));
  const needsHuman = actions.includes("cf_needs_human") || actions.includes("cdp_unreachable");
  process.exit(needsHuman ? 2 : 0);
} finally {
  await pool.end().catch(() => {});
}
