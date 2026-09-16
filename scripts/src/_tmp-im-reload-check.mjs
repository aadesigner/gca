/** Reload IM Albania after cookie inject; report CF vs list. */
const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
const pages = await (await fetch(`${CDP}/json/list`)).json();
const page =
  (pages || []).find((p) => p.type === "page" && /import-motor\.com/i.test(String(p.url || ""))) ||
  null;
if (!page?.webSocketDebuggerUrl) {
  console.error("no IM tab");
  process.exit(1);
}
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
await send("Page.reload", { ignoreCache: true });
await new Promise((r) => setTimeout(r, 15000));
const evalRes = await send("Runtime.evaluate", {
  expression: `({href:location.href,title:document.title,len:(document.body&&document.body.innerText||'').length,hasVin:/[A-HJ-NPR-Z0-9]{17}/.test(document.body&&document.body.innerText||''),cf:/just a moment|checking your browser/i.test(document.title),cookieNames:document.cookie.split(';').map(s=>s.trim().split('=')[0]).filter(Boolean)})`,
  returnByValue: true,
});
console.log(evalRes?.result?.value);
ws.close();
