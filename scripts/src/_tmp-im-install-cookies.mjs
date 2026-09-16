/**
 * Install fresh Import Motor CF/session cookies into:
 *  - scripts/.import-motor.cookies.json
 *  - root .env IMPORT_MOTOR_COOKIE
 *  - live Chrome CDP :9222
 * Then pause/rewrite/requeue IM #360 front sweep.
 *
 * Usage: node scripts/src/_tmp-im-install-cookies.mjs
 * (reads cookie values from env IM_CF / IM_SESSION / IM_XSRF, or argv)
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COOKIE_JSON = path.join(ROOT, "scripts", ".import-motor.cookies.json");
const ENV_PATH = path.join(ROOT, ".env");
const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";

const cf = (process.env.IM_CF || process.argv[2] || "").trim();
const session = decodeURIComponent((process.env.IM_SESSION || process.argv[3] || "").trim());
const xsrf = decodeURIComponent((process.env.IM_XSRF || process.argv[4] || "").trim());

if (!cf || !session || !xsrf) {
  console.error("Need cf_clearance, import_motor_session, XSRF-TOKEN");
  process.exit(1);
}

const cookies = [
  {
    name: "cf_clearance",
    value: cf,
    domain: ".import-motor.com",
    path: "/",
    httpOnly: true,
    secure: true,
  },
  {
    name: "import_motor_session",
    value: session,
    domain: ".import-motor.com",
    path: "/",
    httpOnly: true,
    secure: true,
  },
  {
    name: "XSRF-TOKEN",
    value: xsrf,
    domain: ".import-motor.com",
    path: "/",
    httpOnly: false,
    secure: false,
  },
];

fs.writeFileSync(COOKIE_JSON, `${JSON.stringify(cookies, null, 2)}\n`);
console.log("wrote", COOKIE_JSON, "names=", cookies.map((c) => c.name).join(","));

const header = [
  `cf_clearance=${cf}`,
  `import_motor_session=${session}`,
  `XSRF-TOKEN=${xsrf}`,
].join("; ");

let envText = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, "utf8") : "";
const line = `IMPORT_MOTOR_COOKIE=${header}`;
if (/^IMPORT_MOTOR_COOKIE=/m.test(envText)) {
  envText = envText.replace(/^IMPORT_MOTOR_COOKIE=.*$/m, line);
} else {
  envText = `${envText.trimEnd()}\n\n${line}\n`;
}
fs.writeFileSync(ENV_PATH, envText);
console.log("updated .env IMPORT_MOTOR_COOKIE (len=", header.length, ")");

// Inject into CDP Chrome
try {
  const pages = await (await fetch(`${CDP}/json/list`)).json();
  const page =
    (pages || []).find((p) => p.type === "page" && /import-motor\.com/i.test(String(p.url || ""))) ||
    (await (
      await fetch(`${CDP}/json/new?${encodeURIComponent("https://import-motor.com/buyer-locations/al")}`, {
        method: "PUT",
      })
    ).json());

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", () => res());
    ws.addEventListener("error", rej);
  });
  let id = 1;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const m = JSON.parse(String(ev.data));
    if (m.id && pending.has(m.id)) {
      const { resolve, reject } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result);
    }
  });
  const send = (method, params = {}, t = 20000) =>
    new Promise((resolve, reject) => {
      const i = id++;
      const timer = setTimeout(() => reject(new Error(`timeout ${method}`)), t);
      pending.set(i, {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ id: i, method, params }));
    });

  await send("Network.enable");
  for (const c of cookies) {
    await send("Network.setCookie", {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      httpOnly: c.httpOnly,
      secure: c.secure,
    });
  }
  await send("Page.enable");
  await send("Page.navigate", { url: "https://import-motor.com/buyer-locations/al" });
  await new Promise((r) => setTimeout(r, 10000));
  const evalRes = await send("Runtime.evaluate", {
    expression: `({href:location.href,title:document.title,len:(document.body&&document.body.innerText||'').length,hasVin:/[A-HJ-NPR-Z0-9]{17}/.test(document.body&&document.body.innerText||''),cf:/just a moment|checking your browser/i.test(document.title)})`,
    returnByValue: true,
  });
  console.log("cdp_page", evalRes?.result?.value);
  ws.close();
} catch (err) {
  console.warn("CDP inject failed:", err instanceof Error ? err.message : err);
}

// Requeue IM job without wiping sweep state — clear cooldowns only
const dbUrl =
  process.env.DATABASE_URL ||
  "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable";
const c = new pg.Client({
  connectionString: dbUrl.includes("sslmode=") ? dbUrl : `${dbUrl}?sslmode=disable`,
});
await c.connect();
await c.query(`UPDATE collection_jobs SET status='paused', updated_at=NOW() WHERE id=360 AND status='running'`);
await new Promise((r) => setTimeout(r, 1500));

const { rows } = await c.query(`SELECT crawl_state FROM collection_jobs WHERE id=360`);
let state = rows[0]?.crawl_state;
if (typeof state === "string") {
  try {
    state = JSON.parse(state);
  } catch {
    state = null;
  }
}
if (state && Array.isArray(state.shards)) {
  for (const s of state.shards) {
    if (s.status === "cooldown" || s.status === "active") {
      s.status = "pending";
      s.cooldownUntil = null;
      s.lastError = null;
    }
  }
  if (!state.currentShardId) {
    state.currentShardId = state.shards.find((s) => s.status === "pending")?.id ?? null;
  }
}
await c.query(
  `
  UPDATE collection_jobs
  SET status='pending',
      crawl_state=COALESCE($2::text, crawl_state),
      error_message=NULL,
      started_at=NULL,
      completed_at=NULL,
      updated_at=NOW()-interval '1 day'
  WHERE id=$1
  `,
  [360, state ? JSON.stringify(state) : null],
);
console.log("im_requeued", { shard: state?.currentShardId });
await c.end();
