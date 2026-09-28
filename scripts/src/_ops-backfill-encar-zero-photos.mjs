/**
 * Backfill Encar vehicles with 0 photos on production.
 * Handles recar lot ids (gallery filename ≠ listings.source_id).
 * Inserts source_url only — never sets stored_path (no Cloudflare re-upload).
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-backfill-encar-zero-photos.mjs
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-backfill-encar-zero-photos.mjs --vin=WBA...
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-backfill-encar-zero-photos.mjs --days=60
 */
import fs from "node:fs";
import pg from "pg";

const ENCAR_PHOTO_CDN = "https://ci.encar.com";

function loadProd() {
  if (process.env.PROD_DATABASE_URL) {
    return new pg.Client({
      connectionString: process.env.PROD_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
  const j = JSON.parse(raw.slice(raw.indexOf("{")));
  const vars = j.variables || j;
  const get = (n) => (vars[n] && typeof vars[n] === "object" && "value" in vars[n] ? vars[n].value : vars[n]);
  return new pg.Client({
    host: process.env.PROD_PG_HOST ?? get("RAILWAY_TCP_PROXY_DOMAIN"),
    port: Number(process.env.PROD_PG_PORT ?? get("RAILWAY_TCP_PROXY_PORT") ?? 5432),
    user: process.env.PROD_PG_USER ?? get("PGUSER") ?? "postgres",
    password: process.env.PROD_PG_PASSWORD ?? get("PGPASSWORD") ?? get("POSTGRES_PASSWORD"),
    database: process.env.PROD_PG_DATABASE ?? get("PGDATABASE") ?? "railway",
    ssl: false,
  });
}

function buildEncarPhotoUrl(path) {
  if (!path?.trim()) return null;
  let base;
  if (path.startsWith("http://") || path.startsWith("https://")) {
    base = path.split("?")[0];
  } else if (path.startsWith("//")) {
    base = `https:${path.split("?")[0]}`;
  } else {
    const normalized = path.startsWith("/") ? path : `/${path}`;
    if (normalized.startsWith("/carpicture/")) base = `${ENCAR_PHOTO_CDN}${normalized}`;
    else if (normalized.startsWith("/carpicture")) base = `${ENCAR_PHOTO_CDN}/carpicture${normalized}`;
    else if (normalized.includes("carpicture")) base = `${ENCAR_PHOTO_CDN}/${normalized.replace(/^\/+/, "")}`;
    else return null;
  }
  if (!/carpicture/i.test(base)) return null;
  const q = new URLSearchParams({
    impolicy: "heightRate",
    rh: "1650",
    cw: "2200",
    ch: "1650",
    cg: "Center",
  });
  return `${base}?${q.toString()}`;
}

function collectPaths(value, out, depth = 0) {
  if (value == null || depth > 6) return;
  if (typeof value === "string") {
    if (/carpicture|\.jpe?g|\.webp|\.png/i.test(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPaths(item, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    const row = value;
    const path = row.path ?? row.location ?? row.url ?? row.imageUrl ?? row.src;
    if (typeof path === "string") out.push(path);
    for (const v of Object.values(row)) collectPaths(v, out, depth + 1);
  }
}

function uniqueUrls(raws) {
  const seen = new Set();
  const urls = [];
  for (const raw of raws) {
    const url = buildEncarPhotoUrl(raw);
    if (!url) continue;
    const key = url.split("?")[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    urls.push(url);
  }
  return urls;
}

function lotId(url) {
  return url.match(/carpicture\d*\/pic\d+\/(\d{6,})_/i)?.[1] ?? null;
}

function picPrefix(url) {
  const m = String(url).match(/^(https?:\/\/ci\.encar\.com\/carpicture\/carpicture\d+\/pic\d+\/\d{6,})_/i);
  return m?.[1] ?? null;
}

function filterToListingLot(sourceId, urls) {
  const pin = String(sourceId ?? "").replace(/^im-/i, "");
  const matching = urls.filter((u) => {
    const lot = lotId(u);
    return !lot || lot === pin;
  });
  if (matching.length) return matching;
  const lots = new Set(urls.map(lotId).filter(Boolean));
  if (lots.size === 1) return urls;
  return [];
}

const headers = {
  "User-Agent":
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  Accept: "application/json",
  "Accept-Language": "ko-KR,ko;q=0.9",
  Referer: "https://fem.encar.com/",
};

async function probeCdnFromSeed(seedUrl) {
  const prefix = picPrefix(seedUrl);
  if (!prefix) return [];
  const q = "?impolicy=heightRate&rh=1650&cw=2200&ch=1650&cg=Center";
  const found = [];
  for (let i = 1; i <= 60; i++) {
    const n = String(i).padStart(3, "0");
    const url = `${prefix}_${n}.jpg${q}`;
    try {
      const res = await fetch(url, {
        method: "HEAD",
        redirect: "follow",
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) found.push(url);
    } catch {
      /* skip */
    }
  }
  return found;
}

async function fetchPhotoUrls(sourceId) {
  const cleanId = String(sourceId ?? "").replace(/^im-/i, "");
  if (!/^\d{6,}$/.test(cleanId)) {
    throw new Error(`Not a numeric Encar lot id: ${sourceId}`);
  }
  const include =
    "ADVERTISEMENT,CATEGORY,CONDITION,CONTACT,MANAGE,OPTIONS,PHOTOS,PRICE,SPEC,VIEW";
  const url = `https://api.encar.com/v1/readside/vehicle/${cleanId}?include=${include}`;
  let lastErr;
  let apiUrls = [];
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`Encar ${cleanId} HTTP ${res.status}`);
      const json = await res.json();
      const raws = [];
      collectPaths(json.photos, raws);
      collectPaths(json.view?.photos, raws);
      apiUrls = filterToListingLot(cleanId, uniqueUrls(raws));
      break;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    }
  }
  if (apiUrls.length >= 2) return { urls: apiUrls, via: "api" };
  if (apiUrls.length === 1) {
    const probed = await probeCdnFromSeed(apiUrls[0]);
    if (probed.length >= 2) return { urls: probed, via: "cdn-probe" };
  }
  if (lastErr && apiUrls.length === 0) throw lastErr;
  return { urls: apiUrls, via: "api-sparse" };
}

const onlyVin = process.argv.find((a) => a.startsWith("--vin="))?.split("=")[1];
const daysArg = process.argv.find((a) => a.startsWith("--days="))?.split("=")[1];
const days = Number(daysArg || "60") || 60;

const prod = loadProd();
await prod.connect();

const { rows: targets } = await prod.query(
  onlyVin
    ? `SELECT v.id AS vehicle_id, v.vin, l.id AS listing_id, l.source_id
       FROM vehicles v
       JOIN listings l ON l.vehicle_id = v.id
       JOIN providers p ON p.id = l.provider_id
       WHERE v.vin = $1 AND p.internal_name = 'encar'`
    : `SELECT v.id AS vehicle_id, v.vin, l.id AS listing_id, l.source_id
       FROM vehicles v
       JOIN listings l ON l.vehicle_id = v.id
       JOIN providers p ON p.id = l.provider_id
       WHERE p.internal_name = 'encar'
         AND v.created_at > now() - ($1::text || ' days')::interval
         AND NOT EXISTS (SELECT 1 FROM photos ph WHERE ph.vehicle_id = v.id)
       ORDER BY v.created_at DESC`,
  onlyVin ? [onlyVin] : [String(days)],
);

console.log(JSON.stringify({ targets: targets.length, days, onlyVin: onlyVin || null }));

const summary = [];
let insertedTotal = 0;
for (const row of targets) {
  try {
    const { urls, via } = await fetchPhotoUrls(row.source_id);
    if (urls.length < 2) {
      summary.push({
        vin: row.vin,
        sourceId: row.source_id,
        inserted: 0,
        reason: `only ${urls.length} urls via ${via}`,
      });
      continue;
    }
    const values = [];
    const ph = urls
      .map((u, i) => {
        const n = values.length;
        values.push(row.vehicle_id, row.listing_id, u, i === 0, i, "gallery");
        return `($${n + 1},$${n + 2},$${n + 3},$${n + 4},$${n + 5},$${n + 6})`;
      })
      .join(",");
    const ins = await prod.query(
      `INSERT INTO photos (vehicle_id, listing_id, source_url, is_primary, sort_order, photo_group)
       VALUES ${ph}
       ON CONFLICT (listing_id, source_url) DO NOTHING`,
      values,
    );
    insertedTotal += ins.rowCount;
    summary.push({
      vin: row.vin,
      sourceId: row.source_id,
      inserted: ins.rowCount,
      urls: urls.length,
      via,
    });
  } catch (err) {
    summary.push({ vin: row.vin, sourceId: row.source_id, inserted: 0, error: String(err) });
  }
  await new Promise((r) => setTimeout(r, 500));
}

const checkVins = onlyVin
  ? [onlyVin]
  : ["5YJ3E1EB9NF228344", "1HGCV2630KA510203", "WBA31DP04P9N91864"];
const { rows: verify } = await prod.query(
  `SELECT v.vin, count(ph.id)::int AS photos
   FROM vehicles v
   LEFT JOIN photos ph ON ph.vehicle_id = v.id
   WHERE v.vin = ANY($1::text[])
   GROUP BY v.vin`,
  [checkVins],
);

const { rows: remaining } = await prod.query(
  `SELECT count(*)::int AS n
   FROM vehicles v
   JOIN listings l ON l.vehicle_id = v.id
   JOIN providers p ON p.id = l.provider_id
   WHERE p.internal_name = 'encar'
     AND v.created_at > now() - ($1::text || ' days')::interval
     AND NOT EXISTS (SELECT 1 FROM photos ph WHERE ph.vehicle_id = v.id)`,
  [String(days)],
);

console.log(
  JSON.stringify(
    {
      n: targets.length,
      insertedTotal,
      remainingEncarZero: remaining[0]?.n,
      verify,
      summary,
    },
    null,
    2,
  ),
);
await prod.end();
