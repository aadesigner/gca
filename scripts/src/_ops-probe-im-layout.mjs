/**
 * Probe live Import Motor detail HTML for gallery / spec layout.
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-probe-im-layout.mjs
 */
const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
const pages = await fetch(`${CDP}/json/list`).then((r) => r.json());
const page = (pages || []).find((p) => p.type === "page" && p.webSocketDebuggerUrl);
if (!page) throw new Error("no CDP page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener("open", resolve);
  ws.addEventListener("error", () => reject(new Error("ws")));
});
let id = 1;
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const n = id++;
    const t = setTimeout(() => reject(new Error(method)), 20000);
    const on = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id !== n) return;
      clearTimeout(t);
      ws.removeEventListener("message", on);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    };
    ws.addEventListener("message", on);
    ws.send(JSON.stringify({ id: n, method, params }));
  });

await send("Page.enable");
await send("Runtime.enable");
await send("Page.navigate", { url: "https://import-motor.com/v/WAUJGCFC2DN100089" });
await new Promise((r) => setTimeout(r, 8000));
const info = await send("Runtime.evaluate", {
  returnByValue: true,
  expression: `(() => {
    const html = document.documentElement.outerHTML;
    const text = document.body?.innerText || '';
    const imgs = [...document.querySelectorAll('img, source, picture')];
    return {
      title: document.title,
      href: location.href,
      ready: document.readyState,
      htmlLen: html.length,
      textLen: text.length,
      textHead: text.replace(/\\s+/g,' ').slice(0,400),
      cf: /just a moment|cf-challenge|checking your browser/i.test(html),
      scripts: [...document.querySelectorAll('script[src]')].map(s => s.src).filter(s => /app|vite|livewire|alpine|nuxt|inertia/i.test(s)).slice(0,15),
      dataAttrs: [...document.querySelectorAll('[data-gallery],[data-images],[data-photos],[x-data]')].slice(0,8).map(e => e.tagName+'.'+(e.className||'')+Object.keys(e.dataset||{}).join(',')),
      imgCount: imgs.length,
      imgSample: imgs.slice(0,15).map(i => (i.currentSrc||i.src||i.getAttribute('srcset')||'').slice(0,140)),
      hasVin: /WAUJGCFC2DN100089/i.test(html),
      lot: (html.match(/Lot[^<]{0,40}/i)||[])[0],
      classes: [...new Set([...document.querySelectorAll('[class]')].flatMap(e => [...e.classList]))].filter(c => /gal|photo|slider|carousel|fotorama|swiper|image|spec|vin/i.test(c)).slice(0,40)
    };
  })()`,
});
console.log(JSON.stringify(info.result?.value ?? info, null, 2));
ws.close();
