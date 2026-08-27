/** Export diverse KR listings from DB + download photos into frontend assets.
 *  Static marketing demo only — not wired to the live API.
 *  pnpm --filter @workspace/api-server exec tsx --import ../../scripts/load-env.mjs scripts/export-live-sample.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(__dirname, "../../site");
const outDir = path.join(siteDir, "public/assets/cars");
const jsonOut = path.join(siteDir, "public/assets/live-sample.json");

const TARGET = 18;
const PER_PROVIDER = 6;
const QUOTAS = {
  encar: PER_PROVIDER,
  autowini: PER_PROVIDER,
  kbchachacha: PER_PROVIDER,
};

async function fetchRanked(provider, limit) {
  const { rows } = await pool.query(
    `
    WITH photo_pick AS (
      SELECT DISTINCT ON (p.listing_id)
        p.listing_id,
        CASE
          WHEN p.stored_path IS NOT NULL AND p.stored_path <> '' THEN p.stored_path
          ELSE p.source_url
        END AS photo_url,
        CASE WHEN p.stored_path IS NOT NULL AND p.stored_path <> '' THEN 0 ELSE 1 END AS photo_rank
      FROM photos p WHERE p.listing_id IS NOT NULL
      ORDER BY p.listing_id,
        CASE WHEN p.stored_path IS NOT NULL AND p.stored_path <> '' THEN 0 ELSE 1 END,
        p.is_primary DESC, p.sort_order ASC, p.id ASC
    ),
    ranked AS (
      SELECT
        pr.internal_name AS provider,
        CASE pr.internal_name
          WHEN 'encar' THEN 'Encar'
          WHEN 'autowini' THEN 'Autowini'
          WHEN 'kbchachacha' THEN 'KB ChaChaCha'
          ELSE pr.name
        END AS provider_name,
        v.make, v.model, v.year, v.trim, v.fuel_type AS fuel, v.transmission,
        l.price_amount::bigint AS price,
        COALESCE(l.price_currency, 'KRW') AS currency,
        l.mileage::int AS mileage,
        pp.photo_url,
        pp.photo_rank,
        ROW_NUMBER() OVER (
          PARTITION BY v.make
          ORDER BY pp.photo_rank ASC, l.last_seen_at DESC
        ) AS rn
      FROM listings l
      JOIN providers pr ON pr.id = l.provider_id
      JOIN vehicles v ON v.id = l.vehicle_id
      JOIN photo_pick pp ON pp.listing_id = l.id
      WHERE pr.internal_name = $1
        AND l.is_active = TRUE
        AND v.make IS NOT NULL
        AND pp.photo_url IS NOT NULL
        AND COALESCE(l.price_amount, 0) > 0
        AND COALESCE(v.body_type, '') NOT ILIKE '%motor%'
        AND COALESCE(v.body_type, '') NOT ILIKE '%trailer%'
        AND COALESCE(v.make, '') NOT ILIKE '%trailer%'
    )
    SELECT * FROM ranked WHERE rn <= 4 ORDER BY photo_rank ASC, make, rn LIMIT $2
  `,
    [provider, limit],
  );
  return rows;
}

const providerOrder = ["encar", "autowini", "kbchachacha"];
const rows = [];
for (const p of providerOrder) {
  try {
    rows.push(...(await fetchRanked(p, 80)));
  } catch (e) {
    console.warn("provider query failed", p, e.message);
  }
}

await pool.end();

if (!rows.length) {
  console.error("No listings found in DB");
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });

function slug(s) {
  return String(s || "car")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function liveInternal(provider) {
  if (provider === "encar") return "encar_live";
  if (provider === "autowini") return "autowini_live";
  if (provider === "kbchachacha") return "kbchachacha_live";
  return `${provider}_live`;
}

async function downloadPhoto(url, dest) {
  let resolved = String(url || "").trim();
  if (!resolved) throw new Error("empty url");
  // Local/R2 mirror keys → public CDN
  if (!/^https?:\/\//i.test(resolved)) {
    const base = (process.env.R2_PUBLIC_BASE_URL || "https://imgsv.getcarapi.com").replace(/\/$/, "");
    resolved = `${base}/${resolved.replace(/^\//, "")}`;
  }
  const host = (() => {
    try {
      return new URL(resolved).hostname;
    } catch {
      return "";
    }
  })();
  const headers = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    Accept: "image/avif,image/webp,image/jpeg,image/*,*/*;q=0.8",
  };
  if (/autowini/i.test(host)) headers.Referer = "https://www.autowini.com/";
  else if (/encar/i.test(host)) headers.Referer = "https://www.encar.com/";
  else if (/kbchachacha|chachacha/i.test(host)) headers.Referer = "https://www.kbchachacha.com/";

  const res = await fetch(resolved, { headers, redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 4000) throw new Error("too small");
  const ct = res.headers.get("content-type") || "";
  let ext = ".jpg";
  if (ct.includes("webp")) ext = ".webp";
  else if (ct.includes("png")) ext = ".png";
  const final = dest.replace(/\.(jpg|webp|png)$/, "") + ext;
  fs.writeFileSync(final, buf);
  return final;
}

const vehicles = [];
const usedPhotos = new Set();
const counts = { encar: 0, autowini: 0, kbchachacha: 0 };

async function takeForProvider(provider, need) {
  const candidates = rows.filter((r) => r.provider === provider);
  for (const row of candidates) {
    if ((counts[provider] || 0) >= need) break;
    if (!row.photo_url || usedPhotos.has(row.photo_url)) continue;
    if (row.price == null || Number(row.price) <= 0) continue;

    const base = `db-${slug(row.provider)}-${slug(row.make)}-${slug(row.model)}-${row.year}`;
    let localPath = `/assets/cars/${base}.jpg`;

    try {
      const saved = await downloadPhoto(row.photo_url, path.join(outDir, `${base}.jpg`));
      localPath = `/assets/cars/${path.basename(saved)}`;
      usedPhotos.add(row.photo_url);
    } catch (e) {
      console.warn("skip photo", row.make, row.model, e.message);
      continue;
    }

    counts[provider] = (counts[provider] || 0) + 1;
    vehicles.push({
      year: row.year,
      make: row.make,
      model: row.model,
      trim: row.trim || undefined,
      mileage: row.mileage,
      price: Number(row.price),
      currency: row.currency || "KRW",
      fuel: row.fuel || "Gasoline",
      transmission: row.transmission || "Automatic",
      location: "South Korea",
      photos: [localPath],
      sourceProvider: {
        name: row.provider_name,
        internalName: liveInternal(row.provider),
      },
    });
    console.log("ok", row.provider_name, row.year, row.make, row.model, localPath);
  }
}

for (const p of providerOrder) {
  await takeForProvider(p, QUOTAS[p] || PER_PROVIDER);
}

if (vehicles.length < 6) {
  console.error("Only got", vehicles.length, "vehicles");
  process.exit(1);
}

fs.writeFileSync(
  jsonOut,
  JSON.stringify(
    {
      limit: TARGET,
      perProvider: PER_PROVIDER,
      providers: [
        { name: "All feeds", internalName: "all" },
        { name: "Encar", internalName: "encar_live" },
        { name: "Autowini", internalName: "autowini_live" },
        { name: "KB ChaChaCha", internalName: "kbchachacha_live" },
      ],
      vehicles,
    },
    null,
    2,
  ),
);
console.log("Wrote", jsonOut, "with", vehicles.length, "vehicles", counts);
