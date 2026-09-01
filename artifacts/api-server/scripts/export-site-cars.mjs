/** Export all marketing-site car photos from DB — no stock images.
 *  pnpm --filter @workspace/db exec tsx --import ../../scripts/load-env.mjs ../../artifacts/api-server/scripts/export-site-cars.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import jpeg from "jpeg-js";
import { pool } from "@workspace/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const siteDir = path.resolve(__dirname, "../../site");
const outDir = path.join(siteDir, "public/assets/cars");
const jsonOut = path.join(siteDir, "public/assets/site-cars.json");

const MARKETS = [
  { key: "kr", slug: "south-korea", providers: ["encar", "autowini"], limit: 10 },
  { key: "us", slug: "usa", providers: ["copart", "iaa", "salvagebid"], limit: 8 },
  { key: "ca", slug: "canada", providers: ["autotraderca", "carpages"], limit: 6 },
  { key: "ae", slug: "dubai", providers: ["dubicars"], limit: 4 },
  { key: "eu", slug: "europe", providers: ["autoscout24", "mobile_de"], limit: 4 },
  { key: "cn", slug: "china", providers: ["kolon_auto", "guazi"], limit: 4 },
  { key: "jp", slug: "japan", providers: ["koreaauto_auction"], limit: 4 },
];

function slug(s) {
  return String(s || "car")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 36);
}

async function fetchListings(providers, limit) {
  const { rows } = await pool.query(
    `
    WITH photo_urls AS (
      SELECT
        p.listing_id,
        json_agg(
          COALESCE(NULLIF(p.stored_path, ''), p.source_url)
          ORDER BY p.sort_order ASC, p.is_primary DESC, p.id ASC
        ) AS photo_urls
      FROM photos p
      WHERE p.listing_id IS NOT NULL
      GROUP BY p.listing_id
    ),
    ranked AS (
      SELECT
        pr.internal_name AS provider,
        pr.name AS provider_name,
        v.make, v.model, v.year, v.body_type,
        l.price_amount::bigint AS price,
        COALESCE(l.price_currency, 'KRW') AS currency,
        l.mileage::int AS mileage,
        pu.photo_urls,
        ROW_NUMBER() OVER (PARTITION BY v.make ORDER BY l.last_seen_at DESC) AS rn
      FROM listings l
      JOIN providers pr ON pr.id = l.provider_id
      JOIN vehicles v ON v.id = l.vehicle_id
      JOIN photo_urls pu ON pu.listing_id = l.id
      WHERE pr.internal_name = ANY($1::text[])
        AND l.is_active = TRUE
        AND v.make IS NOT NULL
        AND jsonb_array_length(pu.photo_urls::jsonb) > 0
    )
    SELECT * FROM ranked WHERE rn = 1
    ORDER BY
      CASE
        WHEN provider = ANY(ARRAY['copart','iaa','encar','autowini','autotraderca','carpages','dubicars','autoscout24']) THEN 0
        ELSE 1
      END,
      year DESC NULLS LAST,
      make
    LIMIT $2
  `,
    [providers, limit * 8],
  );
  return rows;
}

function jpegDimensions(buf) {
  // Only parse real JPEGs — WebP payloads often contain 0xFFC0 bytes that fake SOF.
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  for (let i = 2; i < Math.min(buf.length - 8, 128_000); i++) {
    if (buf[i] === 0xff && (buf[i + 1] === 0xc0 || buf[i + 1] === 0xc2)) {
      return { h: buf.readUInt16BE(i + 5), w: buf.readUInt16BE(i + 7) };
    }
  }
  return null;
}

/** Copart VIN plates are often landscape pixels + EXIF Orientation 6/8 (display portrait). */
function jpegExifOrientation(buf) {
  if (buf.length < 12 || buf[0] !== 0xff || buf[1] !== 0xd8) return 1;
  let i = 2;
  while (i + 8 < buf.length) {
    if (buf[i] !== 0xff) break;
    const marker = buf[i + 1];
    const len = buf.readUInt16BE(i + 2);
    if (len < 2 || i + 2 + len > buf.length) break;
    if (marker === 0xe1) {
      const start = i + 4;
      if (buf.slice(start, start + 6).toString("ascii") === "Exif\0\0") {
        const tiff = start + 6;
        const le = buf.slice(tiff, tiff + 2).toString("ascii") === "II";
        const u16 = (o) => (le ? buf.readUInt16LE(o) : buf.readUInt16BE(o));
        const u32 = (o) => (le ? buf.readUInt32LE(o) : buf.readUInt32BE(o));
        const ifd0 = tiff + u32(tiff + 4);
        if (ifd0 + 2 > buf.length) return 1;
        const entries = u16(ifd0);
        for (let e = 0; e < entries; e++) {
          const off = ifd0 + 2 + e * 12;
          if (off + 12 > buf.length) break;
          if (u16(off) === 0x0112) return u16(off + 8) || 1;
        }
      }
    }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return 1;
}

function webpDimensions(buf) {
  if (buf.length < 30) return null;
  if (buf.slice(0, 4).toString("ascii") !== "RIFF" || buf.slice(8, 12).toString("ascii") !== "WEBP") {
    return null;
  }
  // VP8X
  if (buf.slice(12, 16).toString("ascii") === "VP8X" && buf.length >= 30) {
    const w = 1 + buf[24] + (buf[25] << 8) + (buf[26] << 16);
    const h = 1 + buf[27] + (buf[28] << 8) + (buf[29] << 16);
    return { w, h };
  }
  // VP8 lossy
  if (buf.slice(12, 16).toString("ascii") === "VP8 " && buf.length >= 30) {
    const w = buf.readUInt16LE(26) & 0x3fff;
    const h = buf.readUInt16LE(28) & 0x3fff;
    return { w, h };
  }
  // VP8L lossless
  if (buf.slice(12, 16).toString("ascii") === "VP8L" && buf.length >= 25) {
    const bits = buf[21] | (buf[22] << 8) | (buf[23] << 16) | ((buf[24] & 0x0f) << 24);
    return { w: (bits & 0x3fff) + 1, h: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

function imageDimensions(buf) {
  const jpeg = jpegDimensions(buf);
  if (jpeg) {
    const orient = jpegExifOrientation(buf);
    // 5–8 = 90° / 270° — displayed aspect is swapped.
    if (orient >= 5 && orient <= 8) return { w: jpeg.h, h: jpeg.w };
    return jpeg;
  }
  return webpDimensions(buf);
}

function isImageResponse(buf, contentType) {
  const ct = (contentType || "").toLowerCase();
  if (ct.includes("text/html") || ct.includes("application/json")) return false;
  if (ct.startsWith("image/")) return true;
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true;
  if (buf.length >= 12 && buf.slice(0, 4).toString("ascii") === "RIFF" && buf.slice(8, 12).toString("ascii") === "WEBP") {
    return true;
  }
  if (buf.length >= 8 && buf.slice(0, 8).toString("binary") === "\x89PNG\r\n\x1a\n") return true;
  return false;
}

/** Dealer logos, stock CDNs, VIN plates, obvious non-car assets. */
function isRejectedPhotoUrl(url) {
  const u = String(url || "").toLowerCase();
  if (!u) return true;
  if (/\/dealer-info\//.test(u)) return true;
  if (/\/resize\/(50|100|150|200)x\b/.test(u)) return true;
  if (/\b(logo|favicon|sprite|placeholder|no[_-]?image)\b/.test(u)) return true;
  // BidScan / Copart often label certification / door-jamb plates.
  if (/\b(vin[_-]?plate|vin[_-]?sticker|cert[_-]?label|door[_-]?jamb|compliance)\b/.test(u)) return true;
  // Copart “vehicle history / VIN plate” slot (before real lot photos).
  if (/_vhrs\.(jpe?g|png|webp)(\?|$)/.test(u)) return true;
  // Manufacturer / agency stock — never for marketing cards.
  if (
    /\b(unsplash|istockphoto|shutterstock|gettyimages|pexels|pixabay|chromedata|evox|spinacar|imagin\.studio|media\.carsforsale|stockimages?|studio[_-]?shot)\b/.test(
      u,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * Studio / catalogue shots: near-white backdrop (manufacturer pack shots).
 * Soft floor shadows are common — we key off a white top strip + bright sides.
 */
function isStudioWhiteBackdrop(buf) {
  if (!buf || buf.length < 1000) return null;
  if (!(buf[0] === 0xff && buf[1] === 0xd8)) return null;
  let decoded;
  try {
    decoded = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  } catch {
    return null;
  }
  const { width: w, height: h, data } = decoded;
  if (!w || !h || !data?.length) return null;

  const sample = (x, y) => {
    const i = (Math.max(0, Math.min(h - 1, y)) * w + Math.max(0, Math.min(w - 1, x))) * 4;
    return { r: data[i], g: data[i + 1], b: data[i + 2] };
  };
  const nearWhite = ({ r, g, b }) => r >= 228 && g >= 228 && b >= 228;
  const topY = Math.max(2, Math.floor(h * 0.04));
  const top = [
    [4, topY],
    [Math.floor(w * 0.25), topY],
    [Math.floor(w * 0.5), topY],
    [Math.floor(w * 0.75), topY],
    [w - 5, topY],
  ];
  const topWhite = top.filter(([x, y]) => nearWhite(sample(x, y))).length;
  // Catalogue shots almost always have a clean white top strip.
  if (topWhite >= 4) return true;

  const sideY1 = Math.floor(h * 0.2);
  const sideY2 = Math.floor(h * 0.35);
  const sides = [
    [3, sideY1],
    [w - 4, sideY1],
    [3, sideY2],
    [w - 4, sideY2],
  ];
  const softWhite = ({ r, g, b }) => r >= 210 && g >= 210 && b >= 210;
  const sideWhite = sides.filter(([x, y]) => softWhite(sample(x, y))).length;
  if (topWhite >= 3 && sideWhite >= 3) return true;

  // Dealer placeholders ("PHOTOS À VENIR" / "PHOTOS COMING SOON") are bright white text
  // stamped across the middle of a catalogue car.
  let bright = 0;
  let total = 0;
  const y0 = Math.floor(h * 0.36);
  const y1 = Math.floor(h * 0.64);
  const x0 = Math.floor(w * 0.1);
  const x1 = Math.floor(w * 0.9);
  const step = Math.max(3, Math.floor(Math.min(w, h) / 100));
  for (let y = y0; y < y1; y += step) {
    for (let x = x0; x < x1; x += step) {
      total++;
      const c = sample(x, y);
      if (c.r >= 236 && c.g >= 236 && c.b >= 236) bright++;
    }
  }
  const sky = sample(Math.floor(w / 2), topY);
  const indoorGrey =
    Math.abs(sky.r - sky.g) < 14 &&
    Math.abs(sky.g - sky.b) < 14 &&
    sky.r >= 145 &&
    sky.r <= 215;
  // Indoor catalogue / “photos coming soon” overlays — not outdoor lot shots.
  if (indoorGrey && total > 40 && bright / total >= 0.04) return true;
  return false;
}

function jpegUrlCandidate(url) {
  const u = String(url || "");
  if (/\.jpe?g(\?|$)/i.test(u)) return u;
  // AutoScout / AutoTrader CA resize path: …/1280x960.webp → …/1280x960.jpg
  if (/\/\d+x\d+\.webp(\?|$)/i.test(u)) return u.replace(/\.webp(\?|$)/i, ".jpg$1");
  if (/\.webp(\?|$)/i.test(u)) return u.replace(/\.webp(\?|$)/i, ".jpg$1");
  return null;
}

/**
 * Prefer full exterior lot shots. Reject wheels, VIN plates, studio stock, tiny thumbs.
 */
function marketingPhotoScore(buf, contentType) {
  if (buf.length < 12_000) return -1;
  if (!isImageResponse(buf, contentType)) return -1;

  const dim = imageDimensions(buf);
  // No dims → cannot prove landscape exterior; skip (VIN plates used to sneak through here).
  if (!dim) return -1;

  const { w, h } = dim;
  const minSide = Math.min(w, h);
  const maxSide = Math.max(w, h);
  const ar = w / Math.max(h, 1);
  if (minSide < 420 || maxSide < 560) return -1;

  // Exterior lot shots are landscape. Portrait = VIN stickers / interiors (after EXIF).
  if (ar < 1.25 || ar > 2.35) return -1;

  const studio = isStudioWhiteBackdrop(buf);
  if (studio === true) return -1;

  const mp = (w * h) / 1e6;
  const density = mp > 0 ? buf.length / mp : 0;
  // Compliance stickers / blank dealer graphics: huge canvas, tiny file.
  if (buf.length < 28_000 && density > 0 && density < 55_000) return -1;
  if (buf.length < 35_000 && mp >= 1.2 && density < 35_000) return -1;
  // KAA narrow compliance plates (~810×616).
  if (minSide >= 600 && maxSide <= 850 && buf.length < 40_000 && density > 200_000) return -1;

  let score = Math.max(density || 0, buf.length / 10);
  if (ar >= 1.28 && ar <= 1.85) score *= 1.35;
  if (buf.length >= 45_000) score *= 1.2;
  return score;
}

const NON_CAR_TEXT =
  /\b(trailer|motorcycle|motorbike|atv|utv|snowmobile|boat|jet\s*ski|\brv\b|camper|coachmen|carry-on|big\s*tex|cf\s*moto|taizhou|uforce|dirt\s*bike|scooter|moped|semi\b|tractor|forklift|\bbus\b|chassis|flatbed|pontoon|golf\s*cart|motorhome|side\s*by\s*side|pro\s*xd|q-max|just\s*a\s*moment|polaris|zhilong|spartan\s*motors|\bmt[- ]?\d|\byamaha\b|\bkawasaki\b|\bsuzuki\b|\bharley\b)\b/i;
const NON_CAR_MAKE =
  /^(carry-on|big\s*tex|cf\s*moto|taizhou|coachmen|polaris|zhilong|spartan\s*motors|just|yamaha|kawasaki|harley-davidson|harley)$/i;
const NON_CAR_BODY =
  /\b(motorcycle|trailer|atv|utv|boat|rv|recreational|industrial|medium duty|heavy duty|bus|motorhome)\b/i;

function isPassengerVehicle(row) {
  const make = String(row?.make || "").trim();
  const model = String(row?.model || "").trim();
  const body = String(row?.body_type || "").trim();
  const text = `${make} ${model}`.trim();
  if (!make || !model) return false;
  if (!row?.year || Number(row.year) < 1990) return false;
  if (/moment/i.test(text)) return false;
  if (NON_CAR_TEXT.test(text)) return false;
  if (NON_CAR_MAKE.test(make)) return false;
  if (body && NON_CAR_BODY.test(body)) return false;
  if (model.toLowerCase() === make.toLowerCase()) return false;
  return true;
}

async function fetchPhotoBuffer(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "GetCarAPI-site-export/1.0", Accept: "image/*" },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") || "";
  return { buf, ct };
}

async function pickMarketingPhoto(urls, provider) {
  let ordered = urls.filter((u) => u && !isRejectedPhotoUrl(u));
  if (provider === "koreaauto_auction" && ordered.length > 1) {
    ordered.sort((a, b) => {
      const scoreUrl = (u) => {
        const name = u.split("/").pop()?.toLowerCase() || "";
        if (/\.webp(\?|$)/.test(name)) return 1;
        if (/-\d+\.(jpe?g|png)(\?|$)/.test(name)) return 2;
        return 3;
      };
      return scoreUrl(b) - scoreUrl(a);
    });
  }

  // Copart / IAA: gallery[0] is often a sideways VIN sticker (.jpg); exteriors are .webp.
  if (["copart", "iaa", "salvagebid"].includes(provider) && ordered.length > 1) {
    ordered = [...ordered].sort((a, b) => {
      const rank = (u) => {
        const s = String(u).toLowerCase();
        if (/\.webp(\?|$)/.test(s)) return 0;
        if (/imgsv\.getcarapi\.com\/.+\.webp/.test(s)) return 0;
        if (/_hrs\.(jpe?g|png)(\?|$)/.test(s)) return 1;
        if (/\.jpe?g(\?|$)/.test(s)) return 3;
        return 2;
      };
      return rank(a) - rank(b);
    });
  }

  // Scan early gallery slots. Prefer the best exterior among them —
  // Copart often puts a rotated VIN plate first (landscape pixels + EXIF 6).
  const maxScan = Math.min(ordered.length, 10);
  let best = null;
  for (let i = 0; i < maxScan; i++) {
    const url = ordered[i];
    try {
      const { buf, ct } = await fetchPhotoBuffer(url);
      if (buf.slice(0, 300).toString("utf8").includes("Just a moment")) continue;

      // WebP catalogue shots: score a JPEG sibling for white-backdrop detection.
      let scoreBuf = buf;
      let scoreCt = ct;
      if (!(buf[0] === 0xff && buf[1] === 0xd8)) {
        const jpgUrl = jpegUrlCandidate(url);
        if (jpgUrl && jpgUrl !== url) {
          try {
            const alt = await fetchPhotoBuffer(jpgUrl);
            if (alt.buf[0] === 0xff && alt.buf[1] === 0xd8) {
              scoreBuf = alt.buf;
              scoreCt = alt.ct;
            }
          } catch {
            // keep original
          }
        }
      }

      if (isStudioWhiteBackdrop(scoreBuf) === true) continue;

      let score = marketingPhotoScore(scoreBuf, scoreCt);
      // Do not fall back to an unscored WebP if the JPEG sibling looked like studio stock
      // or failed — WebP alone cannot run the white-backdrop check.
      if (score < 0) continue;
      // Strongly prefer earlier exterior slots over later interiors/engines.
      score *= 1 + (maxScan - i) * 0.08;
      if (/\.webp(\?|$)/i.test(url) || (ct || "").includes("webp")) score *= 1.45;
      // Prefer keeping the JPEG we already proved is a real lot shot when available.
      const keepBuf = scoreBuf[0] === 0xff && scoreBuf[1] === 0xd8 ? scoreBuf : buf;
      const keepCt = keepBuf === scoreBuf ? scoreCt : ct;
      if (!best || score > best.score) best = { url, buf: keepBuf, ct: keepCt, score, index: i };
      // Early high-confidence landscape exterior — stop scanning.
      if (i <= 1 && score >= 50_000) break;
    } catch {
      // try next photo
    }
  }
  return best;
}

function writePhoto(buf, contentType, destBase) {
  const ct = contentType || "";
  const ext = ct.includes("webp") ? ".webp" : ct.includes("png") ? ".png" : ".jpg";
  const file = destBase + ext;
  // Drop stale siblings so cards never keep pointing at an old VIN .jpg
  // after a later export wrote a .webp exterior.
  for (const other of [".jpg", ".jpeg", ".png", ".webp"]) {
    if (other === ext) continue;
    const stale = path.join(outDir, destBase + other);
    if (fs.existsSync(stale)) fs.unlinkSync(stale);
  }
  fs.writeFileSync(path.join(outDir, file), buf);
  return `/assets/cars/${file}`;
}

function formatPrice(price, currency) {
  if (price == null || !Number(price)) return "";
  const n = Number(price);
  const cur = (currency || "").toUpperCase();
  if (cur === "KRW") return `₩${n.toLocaleString("en-US")}`;
  if (cur === "USD") return `$${n.toLocaleString("en-US")}`;
  if (cur === "CAD") return `CAD ${n.toLocaleString("en-US")}`;
  if (cur === "AED") return `AED ${n.toLocaleString("en-US")}`;
  if (cur === "EUR") return `€ ${n.toLocaleString("en-US")}`;
  return `${cur} ${n.toLocaleString("en-US")}`.trim();
}

function rowToCar(row, img, prefix) {
  const chip =
    row.provider === "encar"
      ? "Encar"
      : row.provider === "autowini"
        ? "Autowini"
        : row.provider === "koreaauto_auction"
          ? "KAA Auction"
          : row.provider === "copart"
            ? "Copart"
            : row.provider === "iaa"
              ? "IAA"
              : row.provider_name || row.provider;
  return {
    make: row.make,
    model: row.model,
    year: row.year,
    km: row.mileage != null ? `${Number(row.mileage).toLocaleString("en-US")} km` : "",
    chip,
    img,
    price: formatPrice(row.price, row.currency),
    sold: "—",
    when: "Archive",
    _prefix: prefix,
    _photoScore: row._photoScore ?? 0,
  };
}

fs.mkdirSync(outDir, { recursive: true });
const out = { markets: {}, heroSalvage: [], heroLiveKr: [] };
const usedUrls = new Set();

for (const m of MARKETS) {
  const rows = await fetchListings(m.providers, m.limit);
  const cars = [];
  for (const row of rows) {
    if (cars.length >= m.limit) break;
    if (!isPassengerVehicle(row)) {
      console.warn("skip non-car", m.key, row.make, row.model, row.body_type || "");
      continue;
    }
    const urls = Array.isArray(row.photo_urls) ? row.photo_urls : [];
    const pick = await pickMarketingPhoto(urls, row.provider);
    if (!pick || usedUrls.has(pick.url)) continue;
    const base = `real-${m.key}-${slug(row.provider)}-${slug(row.make)}-${row.year}`;
    try {
      const img = writePhoto(pick.buf, pick.ct, base);
      usedUrls.add(pick.url);
      cars.push(rowToCar({ ...row, _photoScore: pick.score }, img, m.key));
      console.log("ok", m.key, row.make, row.model, img, `photo#${pick.index ?? "?"}`);
    } catch (e) {
      console.warn("skip", m.key, row.make, e.message);
    }
  }

  // Hero card uses markets[key][0] — put best exterior shot first.
  cars.sort((a, b) => (b._photoScore || 0) - (a._photoScore || 0));
  for (const c of cars) delete c._photoScore;

  out.markets[m.key] = cars;
  if (m.key === "us") out.heroSalvage = cars.slice(0, 8);
  if (m.key === "kr") out.heroLiveKr = cars.slice(0, 9);
}

await pool.end();

const total = Object.values(out.markets).reduce((n, arr) => n + arr.length, 0);
if (total < 10) {
  console.error("Too few cars exported:", total);
  process.exit(1);
}

fs.writeFileSync(jsonOut, JSON.stringify(out, null, 2));
console.log("Wrote", jsonOut, "—", total, "cars across", Object.keys(out.markets).length, "markets");
