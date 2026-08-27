/** One hero + sample listing photo per history market from DB. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(__dirname, "../../site");
const outDir = path.join(siteDir, "public/assets/cars");
const jsonOut = path.join(siteDir, "public/assets/history-markets.json");

const MARKETS = [
  { slug: "south-korea", provider: "encar", file: "hist-kr" },
  { slug: "usa", provider: "salvagebid", file: "hist-us" },
  { slug: "canada", provider: "autotraderca", file: "hist-ca" },
  { slug: "dubai", provider: "dubicars", file: "hist-ae" },
  { slug: "europe", provider: "autoscout24", file: "hist-eu" },
  { slug: "china", provider: "kolon_auto", file: "hist-cn" },
  { slug: "japan", provider: "koreaauto_auction", file: "hist-jp" },
];

async function pickListing(provider) {
  const { rows } = await pool.query(
    `
    WITH photo_pick AS (
      SELECT DISTINCT ON (p.listing_id)
        p.listing_id,
        CASE WHEN p.stored_path IS NOT NULL AND p.stored_path <> '' THEN p.stored_path ELSE p.source_url END AS photo_url
      FROM photos p WHERE p.listing_id IS NOT NULL
      ORDER BY p.listing_id, p.is_primary DESC, p.sort_order ASC, p.id ASC
    )
    SELECT v.make, v.model, v.year, l.price_amount::bigint AS price, l.price_currency AS currency,
      l.mileage::int AS mileage, pp.photo_url, pr.name AS provider_name
    FROM listings l
    JOIN providers pr ON pr.id = l.provider_id
    JOIN vehicles v ON v.id = l.vehicle_id
    JOIN photo_pick pp ON pp.listing_id = l.id
    WHERE pr.internal_name = $1 AND l.is_active = TRUE AND v.make IS NOT NULL
    ORDER BY l.last_seen_at DESC
    LIMIT 8
  `,
    [provider],
  );
  return rows;
}

function slug(s) {
  return String(s || "x").toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 30);
}

async function download(url, destBase) {
  const res = await fetch(url, { headers: { "User-Agent": "GetCarAPI/1.0", Accept: "image/*" }, redirect: "follow" });
  if (!res.ok) throw new Error(String(res.status));
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4000) throw new Error("small");
  const ct = res.headers.get("content-type") || "";
  const ext = ct.includes("webp") ? ".webp" : ct.includes("png") ? ".png" : ".jpg";
  const file = destBase + ext;
  fs.writeFileSync(path.join(outDir, file), buf);
  return `/assets/cars/${file}`;
}

fs.mkdirSync(outDir, { recursive: true });
const out = {};

for (const m of MARKETS) {
  const rows = await pickListing(m.provider);
  let saved = null;
  for (const row of rows) {
    try {
      const img = await download(row.photo_url, `${m.file}-${slug(row.make)}-${row.year}`);
      saved = {
        img,
        make: row.make,
        model: row.model,
        year: row.year,
        km: row.mileage != null ? `${Number(row.mileage).toLocaleString("en-US")} km` : "",
        price: row.price ? `${row.currency || ""} ${Number(row.price).toLocaleString("en-US")}`.trim() : "",
        chip: row.provider_name,
        sold: "—",
        when: "Archive",
      };
      console.log("ok", m.slug, img);
      break;
    } catch (e) {
      console.warn("skip", m.slug, row.make, e.message);
    }
  }
  if (saved) out[m.slug] = saved;
}

await pool.end();
fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2));
console.log("Wrote", jsonOut, Object.keys(out).length, "markets");
