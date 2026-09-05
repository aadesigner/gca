/**
 * Pull import-motor.com cookies from debug Chrome CDP and write
 * scripts/.import-motor.cookies.json + print Cookie header for .env.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const OUT = process.env.IMPORT_MOTOR_COOKIES_JSON?.trim() || path.join(ROOT, "scripts/.import-motor.cookies.json");

const ver = await fetch(`${CDP}/json/version`).then((r) => r.json());
const pages = await fetch(`${CDP}/json/list`).then((r) => r.json());
const page =
  (Array.isArray(pages) ? pages : []).find(
    (p) => p.type === "page" && /import-motor\.com/i.test(String(p.url || "")),
  ) ||
  (Array.isArray(pages) ? pages : []).find((p) => p.type === "page" && p.webSocketDebuggerUrl);
const wsUrl = page?.webSocketDebuggerUrl || ver.webSocketDebuggerUrl;
if (!wsUrl) throw new Error("No CDP websocket — is Chrome on :9222?");
console.log(`CDP target: ${page?.url || "browser"}`);

const WS = globalThis.WebSocket;
if (!WS) throw new Error("globalThis.WebSocket missing (need Node 22+)");

const ws = new WS(wsUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", () => resolve());
  ws.addEventListener("error", (ev) => reject(ev.error || new Error("CDP websocket error")));
});

let nextId = 1;
function send(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`CDP timeout ${method}`)), 10_000);
    const onMsg = (raw) => {
      const msg = JSON.parse(typeof raw.data === "string" ? raw.data : String(raw.data));
      if (msg.id !== id) return;
      clearTimeout(t);
      ws.removeEventListener("message", onMsg);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    };
    ws.addEventListener("message", onMsg);
    ws.send(JSON.stringify({ id, method, params }));
  });
}

await send("Network.enable");
const { cookies } = await send("Network.getAllCookies");
const wanted = (cookies || []).filter((c) => String(c.domain || "").includes("import-motor.com"));
const keep = wanted.map((c) => ({
  name: c.name,
  value: c.value,
  domain: c.domain?.startsWith(".") ? c.domain : ".import-motor.com",
  path: c.path || "/",
  httpOnly: Boolean(c.httpOnly),
  secure: c.secure !== false,
}));

if (keep.length === 0) {
  console.error("No import-motor cookies in Chrome CDP — log in via the debug Chrome window first.");
  ws.close();
  process.exit(2);
}

fs.writeFileSync(OUT, `${JSON.stringify(keep, null, 2)}\n`);
const header = keep.map((c) => `${c.name}=${c.value}`).join("; ");
console.log(`Wrote ${keep.length} cookies → ${OUT}`);
console.log(`names: ${keep.map((c) => c.name).join(", ")}`);
console.log(`IMPORT_MOTOR_COOKIE=${header}`);
ws.close();
