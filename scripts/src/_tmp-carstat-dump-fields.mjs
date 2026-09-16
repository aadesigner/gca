/** Dump full catalog lot object + lot-page damage fields via CDP. */
import fs from "node:fs";

const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";

async function htmlOf(url) {
  const created = await (await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })).json();
  await new Promise((r) => setTimeout(r, 9000));
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
  const r = await send("Runtime.evaluate", {
    expression: "document.documentElement.outerHTML",
    returnByValue: true,
  });
  ws.close();
  return r?.result?.value || "";
}

function unescapePushes(html) {
  return [...html.matchAll(/self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g)].map((m) => {
    try {
      return JSON.parse(`"${m[1]}"`);
    } catch {
      return m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    }
  });
}

function extractLots(html) {
  for (const p of unescapePushes(html)) {
    if (typeof p !== "string" || !p.includes('"lots":[')) continue;
    const idx = p.indexOf('"lots":[');
    const start = p.indexOf("[", idx);
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = start; j < p.length; j++) {
      const c = p[j];
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
        if (depth === 0) return JSON.parse(p.slice(start, j + 1));
      }
    }
  }
  return [];
}

const cat = await htmlOf("https://carstat.info/catalog");
const lots = extractLots(cat);
const withVin = lots.filter((l) => l.vin);
const withZones = lots.find((l) => l.details?.damageZones?.length);
console.log("totals", { lots: lots.length, withVin: withVin.length });
console.log("with_zones", JSON.stringify(withZones, null, 2));
console.log("vin_sample", JSON.stringify(withVin[0], null, 2));

const lotHtml = fs.readFileSync(`${process.env.TEMP}/carstat-lot.html`, "utf8");
const text = lotHtml
  .replace(/<script[\s\S]*?<\/script>/gi, " ")
  .replace(/<style[\s\S]*?<\/style>/gi, " ")
  .replace(/<[^>]+>/g, "\n")
  .replace(/\n+/g, "\n");
const interesting = text
  .split("\n")
  .map((l) => l.trim())
  .filter((l) =>
    /전손|침수|교환|airbag|total loss|collision|damage|LOT|mileage|fuel|registered|D\d{2}-/i.test(l),
  )
  .slice(0, 60);
console.log("lot_lines", interesting);
