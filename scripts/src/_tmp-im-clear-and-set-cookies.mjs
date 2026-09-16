/** Clear all import-motor cookies in CDP, set fresh ones from JSON, verify Albania page. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const cookies = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/.import-motor.cookies.json"), "utf8"));
const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
const pages = await (await fetch(`${CDP}/json/list`)).json();
const page =
  (pages || []).find((p) => p.type === "page" && /import-motor\.com/i.test(String(p.url || ""))) ||
  (await (
    await fetch(`${CDP}/json/new?${encodeURIComponent("https://import-motor.com/")}`, { method: "PUT" })
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
const send = (method, params = {}, t = 30000) =>
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
const all = await send("Network.getAllCookies");
const imOld = (all.cookies || []).filter((c) => /import-motor/i.test(String(c.domain || "")));
for (const c of imOld) {
  try {
    await send("Network.deleteCookies", {
      name: c.name,
      domain: c.domain,
      path: c.path || "/",
    });
  } catch {
    /* ignore */
  }
}
console.log("deleted", imOld.length, "old IM cookies");

for (const c of cookies) {
  // Set on both host and domain forms to avoid stale duplicates winning.
  for (const domain of [".import-motor.com", "import-motor.com"]) {
    await send("Network.setCookie", {
      name: c.name,
      value: c.value,
      domain,
      path: "/",
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: "Lax",
    });
  }
  await send("Network.setCookie", {
    name: c.name,
    value: c.value,
    url: "https://import-motor.com/",
    path: "/",
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: "Lax",
  });
}

await send("Page.navigate", { url: "https://import-motor.com/buyer-locations/al" });
await new Promise((r) => setTimeout(r, 8000));
const evalRes = await send("Runtime.evaluate", {
  expression: `({title:document.title,len:(document.body&&document.body.innerText||'').length,hasVin:/[A-HJ-NPR-Z0-9]{17}/.test(document.body&&document.body.innerText||''),cf:/just a moment/i.test(document.title)})`,
  returnByValue: true,
});
console.log("page", evalRes?.result?.value);
ws.close();

const c = new pg.Client({
  connectionString: "postgresql://postgres:kmcheck_local@127.0.0.1:5432/vdip?sslmode=disable",
});
await c.connect();
await c.query(`UPDATE collection_jobs SET status='paused', updated_at=NOW() WHERE id=360`);
await new Promise((r) => setTimeout(r, 2000));
const { rows } = await c.query(`SELECT crawl_state FROM collection_jobs WHERE id=360`);
let state = rows[0]?.crawl_state;
if (typeof state === "string") state = JSON.parse(state);
if (state?.shards) {
  for (const s of state.shards) {
    if (s.status === "cooldown" || s.status === "active") {
      s.status = "pending";
      s.cooldownUntil = null;
      s.lastError = null;
      s.discoverFailures = 0;
    }
  }
  state.currentShardId = "im-al";
}
await c.query(
  `
  UPDATE collection_jobs
  SET status='pending', crawl_state=$2::text, error_message=NULL, started_at=NULL, completed_at=NULL,
      updated_at=NOW()-interval '2 days'
  WHERE id=$1
  `,
  [360, JSON.stringify(state)],
);
console.log("requeued im-al");
await c.end();
