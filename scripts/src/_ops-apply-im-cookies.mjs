/**
 * Sync Import Motor cookies from IMPORT_MOTOR_COOKIE (.env) into cookies.json,
 * inject into every Chrome CDP tab (including cf_clearance), clear CF cooldowns,
 * heal pool, and ensure job 360 is claimable.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-apply-im-cookies.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const raw = process.env.IMPORT_MOTOR_COOKIE?.trim();
if (!raw) {
  console.error("IMPORT_MOTOR_COOKIE missing in env");
  process.exit(1);
}

const parsed = [];
for (const part of raw.split(";")) {
  const trimmed = part.trim();
  if (!trimmed) continue;
  const eq = trimmed.indexOf("=");
  if (eq <= 0) continue;
  parsed.push({ name: trimmed.slice(0, eq).trim(), value: trimmed.slice(eq + 1).trim() });
}
const byName = Object.fromEntries(parsed.map((c) => [c.name, c.value]));
for (const need of ["cf_clearance", "import_motor_session", "XSRF-TOKEN"]) {
  if (!byName[need]) {
    console.error(`IMPORT_MOTOR_COOKIE missing ${need}`);
    process.exit(1);
  }
}

const jsonPath =
  process.env.IMPORT_MOTOR_COOKIES_JSON?.trim() || path.join(ROOT, "scripts/.import-motor.cookies.json");
const cookies = fs.existsSync(jsonPath) ? JSON.parse(fs.readFileSync(jsonPath, "utf8")) : [];
const defaults = (name) => {
  if (name === "cf_clearance") return { httpOnly: true, secure: true };
  if (name === "import_motor_session" || name === "locale") return { httpOnly: true, secure: true };
  if (name === "XSRF-TOKEN") return { httpOnly: false, secure: false };
  return { httpOnly: false, secure: true };
};
for (const { name, value } of parsed) {
  const i = cookies.findIndex((c) => c.name === name);
  const row = {
    name,
    value,
    domain: ".import-motor.com",
    path: "/",
    ...defaults(name),
  };
  if (i >= 0) cookies[i] = { ...cookies[i], ...row };
  else cookies.push(row);
}
fs.writeFileSync(jsonPath, `${JSON.stringify(cookies, null, 2)}\n`);
console.log(
  "cookies.json synced:",
  parsed.map((c) => `${c.name}=${c.value.length}ch`).join(", "),
);

const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
const ver = await fetch(`${CDP}/json/version`).then((r) => r.json());
const pages = await fetch(`${CDP}/json/list`).then((r) => r.json());
const targets = (Array.isArray(pages) ? pages : []).filter(
  (p) => p.type === "page" && p.webSocketDebuggerUrl,
);
const wsUrls = [
  ...new Set([
    ...targets.map((t) => t.webSocketDebuggerUrl),
    ver.webSocketDebuggerUrl,
  ].filter(Boolean)),
];

async function inject(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", (ev) => reject(ev.error || new Error("ws error")));
  });
  let nextId = 1;
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      const t = setTimeout(() => reject(new Error(`timeout ${method}`)), 15_000);
      const onMsg = (rawMsg) => {
        const msg = JSON.parse(typeof rawMsg.data === "string" ? rawMsg.data : String(rawMsg.data));
        if (msg.id !== id) return;
        clearTimeout(t);
        ws.removeEventListener("message", onMsg);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      };
      ws.addEventListener("message", onMsg);
      ws.send(JSON.stringify({ id, method, params }));
    });
  await send("Network.enable");
  const results = {};
  for (const { name, value } of parsed) {
    const d = defaults(name);
    const r = await send("Network.setCookie", {
      name,
      value,
      domain: ".import-motor.com",
      path: "/",
      httpOnly: d.httpOnly,
      secure: d.secure,
    });
    results[name] = r?.success === false ? "fail" : "ok";
  }
  // Also set host-scoped clearance (some CF setups prefer non-dot domain).
  await send("Network.setCookie", {
    name: "cf_clearance",
    value: byName.cf_clearance,
    domain: "import-motor.com",
    path: "/",
    httpOnly: true,
    secure: true,
  });
  ws.close();
  return results;
}

let injected = 0;
for (const wsUrl of wsUrls) {
  try {
    const r = await inject(wsUrl);
    injected++;
    console.log("cdp inject", injected, r);
  } catch (e) {
    console.log("cdp inject skip", e.message);
  }
}
console.log(`injected into ${injected}/${wsUrls.length} CDP targets`);

const jobId = Number(process.env.IM_JOB_ID || 360);
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
const row = await client.query(`SELECT status, job_config, crawl_state FROM collection_jobs WHERE id=$1`, [
  jobId,
]);
const cfg = JSON.parse(row.rows[0].job_config || "{}");
const st = JSON.parse(row.rows[0].crawl_state || "{}");
delete cfg.nextRunAt;
cfg.crawlMode = "brands";
cfg.fullCrawl = true;
cfg.concurrency = Math.min(10, Number(process.env.IMPORT_MOTOR_CONCURRENCY || cfg.concurrency || 10) || 10);
cfg.delayMs = Math.max(75, Number(process.env.IMPORT_MOTOR_DELAY_MS || cfg.delayMs || 85) || 85);
let cleared = 0;
for (const s of st.shards || []) {
  if (!String(s.id || "").startsWith("im-brand-")) continue;
  if (
    s.status === "cooldown" ||
    /not readable|Cloudflare|websocket|challenge/i.test(String(s.lastError || ""))
  ) {
    s.status = "pending";
    s.lastError = null;
    s.cooldownUntil = null;
    cleared++;
  }
}
await client.query(
  `UPDATE collection_jobs
   SET status='pending', job_config=$1, crawl_state=$2, error_message=null, updated_at=now()
   WHERE id=$3`,
  [JSON.stringify(cfg), JSON.stringify(st), jobId],
);
console.log("job", jobId, "pending; cleared CF shards", cleared);
await client.end();

const API = process.env.API_URL || "http://127.0.0.1:5000";
try {
  const login = await fetch(`${API}/api/admin/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    }),
  });
  const cookie = (login.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (login.ok && cookie) {
    const heal = await fetch(`${API}/api/admin/import-motor/cdp-heal`, {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: "{}",
    });
    console.log("cdp_heal", heal.status, (await heal.text()).slice(0, 300));
  } else {
    console.log("heal skipped login", login.status);
  }
} catch (e) {
  console.log("heal skipped", e.message);
}
