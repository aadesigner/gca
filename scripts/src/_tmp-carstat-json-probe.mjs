/** Dump __NEXT_DATA__ / RSC JSON from carstat lot + catalog pages. */
import fs from "node:fs";

const CDP = process.env.CARSTAT_CDP_URL || process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";

async function open(url) {
  const created = await (await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  await new Promise((r) => setTimeout(r, 10000));
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
  const r = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  ws.close();
  return r?.result?.value;
}

const expr = `(() => {
  const next = document.getElementById('__NEXT_DATA__');
  const scripts = [...document.querySelectorAll('script')].map(s => ({
    type: s.type || '',
    id: s.id || '',
    len: (s.textContent||'').length,
    head: (s.textContent||'').slice(0, 120)
  })).filter(s => s.len > 50);
  // Next App Router often puts flight data in script tags
  const selfData = [...document.querySelectorAll('script')].find(s =>
    (s.textContent||'').includes('"lot"') && (s.textContent||'').includes('vin')
  );
  let parsed = null;
  if (next) {
    try { parsed = JSON.parse(next.textContent); } catch {}
  }
  // Try window.__NEXT_DATA__
  // Also try fetching RSC payload hints from link rel
  const preload = [...document.querySelectorAll('link[rel]')]
    .map(l => ({rel:l.rel, href:l.href})).slice(0,30);
  return {
    hasNextData: !!next,
    nextKeys: parsed ? Object.keys(parsed) : null,
    pagePropsKeys: parsed?.props?.pageProps ? Object.keys(parsed.props.pageProps) : null,
    scripts: scripts.slice(0,25),
    selfDataHead: selfData ? selfData.textContent.slice(0,500) : null,
    selfDataLen: selfData ? selfData.textContent.length : 0,
    preload,
    // Look for JSON in body attributes / data props
    lotAnchors: [...document.querySelectorAll('a[href*="/lot/"]')].slice(0,5).map(a => ({
      href: a.getAttribute('href'),
      text: (a.innerText||'').replace(/\\s+/g,' ').trim().slice(0,120)
    }))
  };
})()`;

const lotUrl =
  "https://carstat.info/lot/5e019dd3-92b0-4c5b-b496-01fb01aa78f5/mercedes-benz/WDD1J6GB7HF026959";
const lotPage = await open(lotUrl);
const lotMeta = await evalPage(lotPage, expr);
console.log("LOT_STRUCT", JSON.stringify(lotMeta, null, 2).slice(0, 8000));

// Also try to find API endpoints by intercepting or checking fetch history
const apiProbe = await evalPage(
  lotPage,
  `(async () => {
    const id = location.pathname.split('/')[2];
    const candidates = [
      '/api/lot/' + id,
      '/api/lots/' + id,
      '/api/catalog?page=1',
      '/api/catalog/page/1',
      '/_next/data'
    ];
    const out = [];
    for (const path of candidates) {
      try {
        const r = await fetch(path, { credentials: 'include' });
        const ct = r.headers.get('content-type') || '';
        const text = await r.text();
        out.push({ path, status: r.status, ct, head: text.slice(0, 300), len: text.length });
      } catch (e) {
        out.push({ path, err: String(e) });
      }
    }
    return out;
  })()`,
);
console.log("API_PROBE", JSON.stringify(apiProbe, null, 2).slice(0, 6000));

const catPage = await open("https://carstat.info/catalog/page/2");
const catMeta = await evalPage(catPage, expr);
console.log("CAT_STRUCT", JSON.stringify(catMeta, null, 2).slice(0, 5000));

// Try common Next.js RSC / JSON patterns in HTML file we already have
const htmlPath = `${process.env.TEMP}/carstat-lot.html`;
if (fs.existsSync(htmlPath)) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const idx = html.indexOf("__NEXT_DATA__");
  console.log("html_has_next_data", idx >= 0, "html_len", html.length);
  // Find push( sequences typical of Next flight
  const m = html.match(/self\.__next_f\.push\(/g);
  console.log("next_f_push_count", m?.length || 0);
  // Extract vin/damage from a known pattern
  const vinM = html.match(/WDD1J6GB7HF026959/g);
  console.log("vin_occurrences", vinM?.length || 0);
}
