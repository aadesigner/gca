/**
 * Correctly refetch VIN photos via a dedicated Chrome tab (no pool reuse),
 * expand IAA spin only when origin is IAA, then rewrite prod DB photos.
 */
import fs from "node:fs";
import pg from "pg";
import { parseImportMotorDetail, attachImportMotorSpinPhotos } from "../../artifacts/api-server/src/lib/providers/import-motor-parse.ts";

const VIN = process.env.VIN || "1FMCU0MN8PUA00785";
const CDP = process.env.IMPORT_MOTOR_CDP_URL || "http://127.0.0.1:9222";

async function cdpFetch(url) {
  const created = await (
    await fetch(`${CDP}/json/new?${encodeURIComponent(url)}`, { method: "PUT" })
  ).json();
  const pageWs = created.webSocketDebuggerUrl;
  if (!pageWs) throw new Error("no page websocket");

  // Node 22 has global WebSocket
  const ws = new WebSocket(pageWs);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", () => resolve());
    ws.addEventListener("error", (e) => reject(e));
  });

  let nextId = 0;
  const pending = new Map();
  ws.addEventListener("message", (ev) => {
    const msg = JSON.parse(String(ev.data));
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) reject(new Error(JSON.stringify(msg.error)));
      else resolve(msg.result);
    }
  });

  const send = (method, params = {}, timeoutMs = 30000) => {
    const id = ++nextId;
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`timeout ${method}`));
      }, timeoutMs);
      pending.set(id, {
        resolve: (v) => {
          clearTimeout(t);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(t);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ id, method, params }));
    });
  };

  try {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Network.enable");
    await send("Page.navigate", { url });
    // Wait until title/VIN appears
    let html = "";
    let href = "";
    let title = "";
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      const ev = await send("Runtime.evaluate", {
        returnByValue: true,
        expression: `({
          href: location.href,
          title: document.title,
          ready: document.readyState,
          hasVin: document.documentElement.outerHTML.includes(${JSON.stringify(VIN)}),
          len: document.documentElement.outerHTML.length
        })`,
      });
      const st = ev.result.value;
      href = st.href;
      title = st.title;
      console.log("wait", i, st);
      if (st.hasVin && st.len > 20000 && !/just a moment/i.test(st.title)) break;
    }

    // Expand fotorama like crawler does
    await send("Runtime.evaluate", {
      expression: `(() => {
        const vin = ${JSON.stringify(VIN)};
        const urls = [];
        const push = (u) => { if (u && /^https?:/i.test(u) && !urls.includes(u)) urls.push(u); };
        try {
          const api = window.jQuery && jQuery('.fotorama').data('fotorama');
          if (api && typeof api.size === 'number' && typeof api.show === 'function') {
            const n = Math.min(api.size, 80);
            for (let i = 0; i < n; i++) { try { api.show(i); } catch {} }
          }
        } catch {}
        document.querySelectorAll('.fotorama__nav__frame, .fotorama img, img').forEach((el) => {
          if (el.tagName === 'IMG') push(el.currentSrc || el.src || el.getAttribute('data-src'));
          else {
            const img = el.querySelector('img');
            if (img) push(img.currentSrc || img.src || img.getAttribute('data-src'));
          }
        });
        let box = document.getElementById('gca-im-gallery-urls');
        if (!box) {
          box = document.createElement('div');
          box.id = 'gca-im-gallery-urls';
          box.style.display = 'none';
          document.body.appendChild(box);
        }
        box.innerHTML = urls.map(u => '<img src="'+u.replace(/"/g,'&quot;')+'" alt="'+vin+'">').join('');
        return urls.length;
      })()`,
    });
    await new Promise((r) => setTimeout(r, 800));

    const doc = await send("DOM.getDocument", { depth: 0 });
    const outer = await send("DOM.getOuterHTML", { nodeId: doc.root.nodeId }, 60000);
    html = outer.outerHTML || "";
    return { href, title, html };
  } finally {
    try {
      ws.close();
    } catch {}
    try {
      await fetch(`${CDP}/json/close/${created.id}`);
    } catch {}
  }
}

const page = await cdpFetch(`https://import-motor.com/v/${VIN}`);
console.log({ href: page.href, title: page.title, htmlLen: page.html.length, hasVin: page.html.includes(VIN) });
fs.writeFileSync(`${process.env.TEMP}/im-correct-${VIN}.html`, page.html);

if (!page.html.includes(VIN)) {
  throw new Error("Fetched page does not contain target VIN — refusing to write");
}

const listing = await attachImportMotorSpinPhotos(
  parseImportMotorDetail(page.html, `https://import-motor.com/v/${VIN}`),
  page.html,
);
const photos = listing.photos || [];
console.log({
  origin: listing.targetProvider,
  sourceId: listing.sourceId,
  counts: photos.reduce((a, p) => {
    a[p.group || "gallery"] = (a[p.group || "gallery"] || 0) + 1;
    return a;
  }, {}),
  sample: photos.slice(0, 12).map((p) => ({ g: p.group, u: (p.sourceUrl || "").slice(0, 130) })),
});

// Safety: never keep IAA hosts on a Copart VIN
const safePhotos = photos.filter((p) => {
  const u = p.sourceUrl || "";
  if (listing.targetProvider === "copart" && /vis\.iaai\.com|mediaretriever\.iaai\.com|\/iaai?\//i.test(u)) {
    return false;
  }
  // Drop related-car images for other VINs
  const otherVin = u.match(/\/([A-HJ-NPR-Z0-9]{17})-/i)?.[1];
  if (otherVin && otherVin.toUpperCase() !== VIN) return false;
  return true;
});

console.log({ safeCount: safePhotos.length, dropped: photos.length - safePhotos.length });

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const getEnv = (n) => {
  const v = vars[n];
  return v && typeof v === "object" && "value" in v ? v.value : v;
};
const c = new pg.Client({
  host: getEnv("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(getEnv("RAILWAY_TCP_PROXY_PORT")),
  user: getEnv("PGUSER") || "postgres",
  password: getEnv("PGPASSWORD") || getEnv("POSTGRES_PASSWORD"),
  database: getEnv("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const vehicleId = (await c.query(`SELECT id FROM vehicles WHERE vin=$1`, [VIN])).rows[0]?.id;
const listingId = (
  await c.query(
    `SELECT l.id FROM listings l JOIN providers p ON p.id=l.provider_id
     WHERE l.vehicle_id=$1 AND p.internal_name='import_motor' ORDER BY l.id DESC LIMIT 1`,
    [vehicleId],
  )
).rows[0]?.id;
if (!vehicleId || !listingId) throw new Error("missing vehicle/listing");

const del = await c.query(`DELETE FROM photos WHERE vehicle_id=$1 RETURNING id`, [vehicleId]);
console.log("deleted", del.rowCount);

let n = 0;
for (const [i, p] of safePhotos.entries()) {
  const group = p.group === "exterior_3d" || p.group === "interior_3d" ? p.group : "gallery";
  await c.query(
    `INSERT INTO photos (vehicle_id, listing_id, source_url, stored_path, is_primary, sort_order, photo_group, created_at)
     VALUES ($1,$2,$3,NULL,$4,$5,$6,NOW())`,
    [vehicleId, listingId, p.sourceUrl, i === 0, p.sortOrder ?? i, group],
  );
  n += 1;
}

// If Copart and no 360, that's correct — do not invent IAA frames.
const after = await c.query(
  `SELECT photo_group, count(*)::int n FROM photos WHERE vehicle_id=$1 GROUP BY 1 ORDER BY 1`,
  [vehicleId],
);
const samples = await c.query(
  `SELECT photo_group, sort_order, left(source_url,140) u FROM photos WHERE vehicle_id=$1 ORDER BY photo_group, sort_order LIMIT 20`,
  [vehicleId],
);
console.log({ inserted: n, after: after.rows, samples: samples.rows });
await c.end();
