/** Force-set IM cookies via CDP with url=https://import-motor.com and verify Network.getAllCookies. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
for (const c of cookies) {
  const r = await send("Network.setCookie", {
    name: c.name,
    value: c.value,
    url: "https://import-motor.com/",
    path: c.path || "/",
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: "Lax",
  });
  console.log("set", c.name, r);
}
const all = await send("Network.getAllCookies");
const im = (all.cookies || []).filter((c) => String(c.domain || "").includes("import-motor"));
console.log(
  "stored",
  im.map((c) => ({ name: c.name, domain: c.domain, len: String(c.value || "").length })),
);
await send("Page.navigate", { url: "https://import-motor.com/buyer-locations/al" });
await new Promise((r) => setTimeout(r, 12000));
const evalRes = await send("Runtime.evaluate", {
  expression: `({title:document.title,len:(document.body&&document.body.innerText||'').length,hasVin:/[A-HJ-NPR-Z0-9]{17}/.test(document.body&&document.body.innerText||''),cf:/just a moment/i.test(document.title)})`,
  returnByValue: true,
});
console.log("page", evalRes?.result?.value);
ws.close();
