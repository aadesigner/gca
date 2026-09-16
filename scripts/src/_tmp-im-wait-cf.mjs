/** Wait on CF challenge tab up to 60s for auto-pass after cookies set. */
const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
const pages = await (await fetch(`${CDP}/json/list`)).json();
const page = (pages || []).find((p) => p.type === "page" && /import-motor\.com/i.test(String(p.url || "")));
if (!page) throw new Error("no IM tab");
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

await send("Page.enable");
for (let i = 0; i < 12; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const evalRes = await send("Runtime.evaluate", {
    expression: `({title:document.title,len:(document.body&&document.body.innerText||'').length,hasVin:/[A-HJ-NPR-Z0-9]{17}/.test(document.body&&document.body.innerText||''),cf:/just a moment/i.test(document.title)})`,
    returnByValue: true,
  });
  const v = evalRes?.result?.value;
  console.log(`t=${(i + 1) * 5}s`, v);
  if (v && !v.cf && v.hasVin) break;
}
ws.close();
