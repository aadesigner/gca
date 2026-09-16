/** Navigate IM CDP tab to Albania list and wait for content (not CF). */
const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
const targets = await (await fetch(`${CDP}/json/list`)).json();
const page =
  targets.find((t) => t.type === "page" && /import-motor\.com/i.test(String(t.url || ""))) ||
  (await (await fetch(`${CDP}/json/new?${encodeURIComponent("https://import-motor.com/buyer-locations/al")}`, { method: "PUT" })).json());

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
const send = (method, params = {}, t = 60000) =>
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

await send("Page.enable");
await send("Page.navigate", { url: "https://import-motor.com/buyer-locations/al" });
await new Promise((r) => setTimeout(r, 12000));
const evalRes = await send("Runtime.evaluate", {
  expression: `({href: location.href, title: document.title, len: document.body?.innerText?.length||0, hasVin: /[A-HJ-NPR-Z0-9]{17}/i.test(document.body?.innerText||''), cf: /just a moment|cloudflare|checking your browser/i.test(document.title+' '+(document.body?.innerText||'').slice(0,200))})`,
  returnByValue: true,
});
console.log("page", evalRes?.result?.value);
ws.close();
