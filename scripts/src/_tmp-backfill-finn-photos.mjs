/**
 * Backfill Finn gallery photos for VINs missing photos.
 * Usage: node scripts/src/_tmp-backfill-finn-photos.mjs
 */
import fs from "node:fs";
import pg from "pg";

const VINS = process.env.VINS
  ? process.env.VINS.split(",").map((s) => s.trim()).filter(Boolean)
  : ["KNACC81GFK5024200", "WDD2050401F222026", "WAUZZZ4G6HN011606"];

function collectFinnPhotos(html, sourceId) {
  const best = new Map();
  const normalized = html.replace(/\\u002F/g, "/").replace(/\\\//g, "/");
  const re =
    /https?:\/\/images\.finncdn\.no\/dynamic\/([^/"'\s]+)\/item\/(\d+)\/([a-f0-9-]{20,})/gi;
  for (const match of normalized.matchAll(re)) {
    const sizeToken = match[1] ?? "";
    const itemId = match[2] ?? "";
    const uuid = match[3] ?? "";
    if (sourceId && itemId !== sourceId) continue;
    if (/profile_placeholders/i.test(sizeToken)) continue;
    const score =
      sizeToken === "default"
        ? 2000
        : sizeToken.endsWith("w")
          ? Number(sizeToken.replace(/\D/g, "")) || 0
          : 100;
    const url = `https://images.finncdn.no/dynamic/1600w/item/${itemId}/${uuid}`;
    const prev = best.get(uuid);
    if (!prev || score > prev.score) best.set(uuid, { url, score });
  }
  return [...best.values()].sort((a, b) => b.score - a.score).map((r) => r.url);
}

const raw = fs.readFileSync(`${process.env.TEMP}/gca-pg-vars-prod.json`, "utf8");
const j = JSON.parse(raw.slice(raw.indexOf("{")));
const vars = j.variables || j;
const get = (n) => {
  const v = vars[n];
  return v && typeof v === "object" && "value" in v ? v.value : v;
};
const c = new pg.Client({
  host: get("RAILWAY_TCP_PROXY_DOMAIN"),
  port: Number(get("RAILWAY_TCP_PROXY_PORT")),
  user: get("PGUSER") || "postgres",
  password: get("PGPASSWORD") || get("POSTGRES_PASSWORD"),
  database: get("PGDATABASE") || "railway",
  ssl: { rejectUnauthorized: false },
});
await c.connect();

for (const vin of VINS) {
  const listing = await c.query(
    `SELECT l.id AS listing_id, l.vehicle_id, l.source_id, l.source_url, v.vin
     FROM listings l
     JOIN vehicles v ON v.id = l.vehicle_id
     JOIN providers pr ON pr.id = l.provider_id AND pr.internal_name = 'finn'
     WHERE v.vin = $1
     ORDER BY l.id DESC LIMIT 1`,
    [vin],
  );
  const row = listing.rows[0];
  if (!row) {
    console.log(vin, "no finn listing");
    continue;
  }
  const url = row.source_url || `https://www.finn.no/mobility/item/${row.source_id}`;
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
      "Accept-Language": "en,nb;q=0.9",
    },
  });
  const html = await res.text();
  const photos = collectFinnPhotos(html, String(row.source_id));
  console.log(vin, "fetched", photos.length, "photos");
  if (!photos.length) continue;

  let inserted = 0;
  for (let i = 0; i < photos.length; i++) {
    const sourceUrl = photos[i];
    const r = await c.query(
      `INSERT INTO photos (vehicle_id, listing_id, source_url, is_primary, sort_order, photo_group)
       VALUES ($1, $2, $3, $4, $5, 'gallery')
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [row.vehicle_id, row.listing_id, sourceUrl, i === 0, i],
    );
    inserted += r.rowCount;
  }
  const count = await c.query(
    `SELECT count(*)::int n FROM photos WHERE listing_id = $1`,
    [row.listing_id],
  );
  console.log(vin, "inserted", inserted, "listingPhotos", count.rows[0].n);
}

await c.end();
