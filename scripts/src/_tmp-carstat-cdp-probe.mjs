/** Fetch carstat catalog + one lot page via CDP; dump HTML/JSON clues. */
import fs from "node:fs";

const CDP = process.env.CARSTAT_CDP_URL || process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";

async function open(url) {
  const created = await (await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  await new Promise((r) => setTimeout(r, 12000));
  return created;
}

async function evalPage(page, expression) {
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
  await send("Runtime.enable");
  const r = await send("Runtime.evaluate", { expression, returnByValue: true });
  const html = await send("Runtime.evaluate", {
    expression: "document.documentElement.outerHTML",
    returnByValue: true,
  });
  ws.close();
  return { value: r?.result?.value, html: html?.result?.value || "" };
}

const catalog = await open("https://carstat.info/catalog");
const cat = await evalPage(
  catalog,
  `({
    title: document.title,
    href: location.href,
    cf: /just a moment/i.test(document.title),
    len: document.documentElement.outerHTML.length,
    links: [...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(Boolean).slice(0,80),
    nexts: [...document.querySelectorAll('a[href*="page"], a[rel="next"], button')].slice(0,20).map(a => ({t:(a.textContent||'').trim().slice(0,40), h:a.getAttribute('href')||a.tagName})),
    scripts: [...document.querySelectorAll('script[src]')].map(s=>s.src).slice(0,20),
    jsonLd: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s=>s.textContent.slice(0,200)),
    textHead: (document.body.innerText||'').slice(0,800)
  })`,
);
console.log("CATALOG_META", JSON.stringify(cat.value, null, 2).slice(0, 6000));
fs.writeFileSync(`${process.env.TEMP}/carstat-catalog.html`, cat.html);

const lotHref =
  (cat.value?.links || []).find((h) => /\/(lot|car|vehicle|vin|record|file)\//i.test(h)) ||
  (cat.value?.links || []).find((h) => /[A-HJ-NPR-Z0-9]{11,17}/i.test(h));
console.log("picked_lot_href", lotHref);

if (lotHref) {
  const abs = lotHref.startsWith("http") ? lotHref : new URL(lotHref, "https://carstat.info").href;
  const lotPage = await open(abs);
  const lot = await evalPage(
    lotPage,
    `({
      title: document.title,
      href: location.href,
      cf: /just a moment/i.test(document.title),
      len: document.documentElement.outerHTML.length,
      vin: (document.body.innerText.match(/\\b([A-HJ-NPR-Z0-9]{17})\\b/i)||[])[1]||null,
      imgs: [...document.querySelectorAll('img[src]')].map(i=>i.src).filter(s=>/carstat|cdn|cloud|ibb|imgur|auction/i.test(s)).slice(0,30),
      textHead: (document.body.innerText||'').slice(0,2000),
      damageHints: (document.body.innerText||'').match(/total loss|collision|airbag|flood|전손|침수|damage|inspect/gi)?.slice(0,40)||[]
    })`,
  );
  console.log("LOT_META", JSON.stringify(lot.value, null, 2).slice(0, 6000));
  fs.writeFileSync(`${process.env.TEMP}/carstat-lot.html`, lot.html);
}
