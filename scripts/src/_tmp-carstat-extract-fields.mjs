/** Extract catalog lots[] and lot JSON-LD from saved / live HTML. */
import fs from "node:fs";

function extractLotsArray(html) {
  const marker = '"lots":[';
  const idx = html.indexOf(marker);
  if (idx < 0) return null;
  let i = idx + '"lots":'.length;
  while (i < html.length && html[i] !== "[") i++;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let j = i; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        const raw = html.slice(i, j + 1);
        // Unescape JSON string escapes from RSC push payload if needed
        try {
          return JSON.parse(raw);
        } catch {
          try {
            // Sometimes double-escaped inside a JS string
            const unesc = JSON.parse(`"${raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
            return JSON.parse(unesc);
          } catch {
            return { parseError: true, head: raw.slice(0, 500), len: raw.length };
          }
        }
      }
    }
  }
  return null;
}

function extractJsonLd(html) {
  const re = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    try {
      out.push(JSON.parse(m[1]));
    } catch {
      out.push({ parseError: true, head: m[1].slice(0, 200) });
    }
  }
  return out;
}

const catHtml = fs.readFileSync(`${process.env.TEMP}/carstat-catalog.html`, "utf8");
const lotHtml = fs.readFileSync(`${process.env.TEMP}/carstat-lot.html`, "utf8");

const lots = extractLotsArray(catHtml);
console.log("catalog_lots_count", Array.isArray(lots) ? lots.length : lots);
if (Array.isArray(lots) && lots[0]) {
  console.log("lot0_keys", Object.keys(lots[0]));
  console.log("lot0", JSON.stringify(lots[0], null, 2));
  console.log("lot1", JSON.stringify(lots[1], null, 2));
  const withVin = lots.filter((l) => l.vin || l.Vin || (l.href && /[A-HJ-NPR-Z0-9]{17}/i.test(JSON.stringify(l))));
  console.log("with_vinish", withVin.length, "/", lots.length);
}

const ld = extractJsonLd(lotHtml);
console.log("lot_jsonld", JSON.stringify(ld, null, 2).slice(0, 8000));

// Also try extracting from page 2 via CDP for fresh lots payload
const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";
const created = await (
  await fetch(`${CDP}/json/new?${encodeURIComponent("https://carstat.info/catalog/page/2")}`, { method: "PUT" })
).json();
await new Promise((r) => setTimeout(r, 8000));
const ws = new WebSocket(created.webSocketDebuggerUrl);
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
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const i = id++;
    const t = setTimeout(() => reject(new Error("timeout")), 30000);
    pending.set(i, {
      resolve: (v) => {
        clearTimeout(t);
        resolve(v);
      },
      reject: (e) => {
        clearTimeout(t);
        reject(e);
      },
    });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
await send("Runtime.enable");
const htmlR = await send("Runtime.evaluate", {
  expression: "document.documentElement.outerHTML",
  returnByValue: true,
});
ws.close();
const page2 = htmlR?.result?.value || "";
const lots2 = extractLotsArray(page2);
console.log("page2_lots", Array.isArray(lots2) ? lots2.length : lots2);
if (Array.isArray(lots2) && lots2[0]) {
  console.log("page2_lot0", JSON.stringify(lots2[0], null, 2));
  console.log("page2_keys", Object.keys(lots2[0]));
}
