/**
 * Convert kmcheck.com vin-catalog JSON → getcarapi-vin-catalog v1
 * Keeps only rows with at least one http(s) image URL.
 *
 * Usage:
 *   node scripts/convert-kmcheck-catalog.mjs [input.json] [output.json]
 */
import fs from "node:fs";
import path from "node:path";

const input =
  process.argv[2] || "c:/Users/Pc/Desktop/vin-catalog-2026-08-26.json";
const output =
  process.argv[3] ||
  path.join(path.dirname(input), "getcarapi-vin-catalog-from-kmcheck-2026-08-26.json");

const MARKET_PROVIDERS = {
  encar: { provider: "encar", providerName: "Encar" },
  copart: { provider: "copart", providerName: "Copart" },
  iaa: { provider: "iaa", providerName: "IAA" },
  autowini: { provider: "autowini", providerName: "Autowini" },
  getcarapi: { provider: "getcarapi", providerName: "GetCarAPI" },
};

function countryCode(raw) {
  if (!raw) return null;
  const s = String(raw).trim().toLowerCase();
  if (s === "kr" || s === "korea" || s === "south korea") return "KR";
  if (s.length === 2) return s.toUpperCase();
  return s.slice(0, 2).toUpperCase();
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function iso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function photoUrls(data) {
  const lists = [];
  if (Array.isArray(data?.photos)) lists.push(...data.photos);
  if (Array.isArray(data?.photosHd)) lists.push(...data.photosHd);
  const out = [];
  const seenUrl = new Set();
  const seenKey = new Set();
  for (const u of lists) {
    if (typeof u !== "string") continue;
    const url = u.trim();
    if (!/^https?:\/\//i.test(url)) continue;
    if (seenUrl.has(url)) continue;
    const key = photoIdentityKey(url);
    if (seenKey.has(key)) continue;
    seenUrl.add(url);
    seenKey.add(key);
    out.push(url);
  }
  return out;
}

/** Loose URL identity — collapses size variants and photos vs photosHd dupes. */
function photoIdentityKey(url) {
  let u = String(url).trim().split("#")[0].split("?")[0].replace(/\/+$/, "").toLowerCase();
  u = u.replace(/\/w_\d+x\d+\//g, "/");
  u = u.replace(/\/\d{2,4}x\d{2,4}\//g, "/");
  u = u.replace(/_(?:thumb|small|medium|large|orig)\.(jpe?g|webp|png)$/i, ".$1");
  return u;
}

function encarCarIdFromUrl(url) {
  const m = String(url).match(/\/pic\d+\/(\d+)_\d+\./i);
  return m?.[1] ?? null;
}

/**
 * Map kmcheck/carstat catalog rows onto real market providers when possible.
 * Fallback: getcarapi (never leave carstat/kmcheck as the public provider name).
 */
function inferMarketProvider({ urls = [], auctionHistory = [], events = [], country = null, rawProvider = null } = {}) {
  const blob = [
    rawProvider,
    country,
    ...urls,
    JSON.stringify(auctionHistory),
    JSON.stringify(events),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();

  if (/copart\.com|cs\.copart|\bcopart\b/.test(blob)) return MARKET_PROVIDERS.copart;
  if (/iaai\.com|vis\.iaai|mediaretriever\.iaai|\biaai\b/.test(blob)) return MARKET_PROVIDERS.iaa;
  if (/encar\.com|ci\.encar|fem\.encar|\bencar\b/.test(blob)) return MARKET_PROVIDERS.encar;
  if (/autowini\.com|\bautowini\b/.test(blob)) return MARKET_PROVIDERS.autowini;
  if (urls.some((u) => encarCarIdFromUrl(u))) return MARKET_PROVIDERS.encar;

  // Korean domestic auction footprint (cities / KRW) without naming Encar
  if (
    (country === "KR" || /"country"\s*:\s*"kr"|south korea|₩|\bkrw\b/.test(blob)) &&
    /(daejeon|seoul|busan|incheon|gwangju|ulsan|suwon|finalprice|auction)/.test(blob)
  ) {
    return MARKET_PROVIDERS.encar;
  }

  return MARKET_PROVIDERS.getcarapi;
}

function mapProvider(row, data, urls, events) {
  const country = countryCode(data.country || row.country);
  return inferMarketProvider({
    urls,
    auctionHistory: data.auctionHistory || [],
    events,
    country,
    rawProvider: row.provider,
  });
}

function mileageKm(data) {
  const odo = num(data?.odometer);
  if (odo != null && odo > 0) return { mileage: Math.round(odo), mileageUnit: "km" };
  const miles = num(data?.miles);
  if (miles != null && miles > 0) return { mileage: Math.round(miles * 1.60934), mileageUnit: "km" };
  const mileage = num(data?.mileage);
  if (mileage != null && mileage > 0) {
    const unit = String(data?.mileageUnit || data?.odometerUnit || "km").toLowerCase();
    if (unit.startsWith("mi")) return { mileage: Math.round(mileage * 1.60934), mileageUnit: "km" };
    return { mileage: Math.round(mileage), mileageUnit: "km" };
  }
  return { mileage: null, mileageUnit: "km" };
}

function priceFrom(data) {
  const md = data?.marketData;
  if (md && num(md.estimatedValue) != null) {
    return {
      priceAmount: Math.round(num(md.estimatedValue)),
      priceCurrency: String(md.currency || "USD").toUpperCase(),
    };
  }
  const auctions = Array.isArray(data?.auctionHistory) ? data.auctionHistory : [];
  for (const a of auctions) {
    for (const key of ["finalPrice", "buyNowPrice", "openingBid", "auctionPrice"]) {
      const n = num(a?.[key]);
      if (n != null && n > 0) {
        return { priceAmount: Math.round(n), priceCurrency: "USD" };
      }
    }
  }
  return { priceAmount: null, priceCurrency: "USD" };
}

function pushEvent(events, eventType, description, occurredAt, metadata) {
  if (!eventType) return;
  events.push({
    eventType,
    description: description || null,
    occurredAt: iso(occurredAt),
    metadata: metadata ? JSON.stringify(metadata) : null,
  });
}

function buildEvents(data) {
  const events = [];
  for (const a of data?.accidents || []) {
    pushEvent(
      events,
      "accident",
      a.description || a.type || a.severity || "accident",
      a.date,
      a,
    );
  }
  for (const r of data?.registryHistory || []) {
    const type = String(r.type || "").toLowerCase();
    const eventType = type.includes("owner") ? "owner_change" : "other";
    pushEvent(events, eventType, r.title || r.subtitle || r.type || "registry", r.date, r);
  }
  for (const a of data?.auctionHistory || []) {
    pushEvent(
      events,
      "sale",
      [a.city, a.lotStatus, a.condition].filter(Boolean).join(" · ") || "auction",
      a.date,
      a,
    );
  }
  for (const o of data?.ownerHistory || []) {
    pushEvent(events, "owner_change", o.lotStatus || o.condition || "owner history", o.date, o);
  }
  for (const m of data?.mileageHistory || []) {
    pushEvent(
      events,
      "inspection",
      `odometer ${m.odometer ?? "?"} ${m.unit || "km"} (${m.source || "history"})`,
      m.date,
      m,
    );
  }
  return events;
}

const rows = JSON.parse(fs.readFileSync(input, "utf8"));
if (!Array.isArray(rows)) throw new Error("Expected root JSON array");

const listings = [];
let skippedNoPhoto = 0;
let skippedNoVin = 0;

for (const row of rows) {
  const vin = String(row.vin || "").trim().toUpperCase();
  if (!vin || vin.length < 5) {
    skippedNoVin++;
    continue;
  }
  const data = row.data && typeof row.data === "object" ? row.data : {};
  const urls = photoUrls(data);
  if (!urls.length) {
    skippedNoPhoto++;
    continue;
  }

  const events = buildEvents(data);
  const { provider, providerName } = mapProvider(row, data, urls, events);
  const { mileage, mileageUnit } = mileageKm(data);
  const { priceAmount, priceCurrency } = priceFrom(data);
  const country = countryCode(data.country || row.country);
  const make = data.make || row.make || null;
  const model = data.model || row.model || null;
  const year = num(data.year ?? row.year);
  const trim = data.trim || null;
  const encarId = urls.map(encarCarIdFromUrl).find(Boolean) || null;

  listings.push({
    vin,
    provider,
    providerName,
    sourceId: `kmcheck:${row.id ?? vin}`,
    sourceUrl: encarId ? `https://fem.encar.com/cars/detail/${encarId}` : null,
    title: [year, make, model, trim].filter(Boolean).join(" ") || null,
    priceAmount,
    priceCurrency,
    mileage,
    mileageUnit,
    location: null,
    country,
    isActive: true,
    firstSeenAt: iso(row.imported_at),
    lastSeenAt: iso(row.updated_at || row.imported_at),
    vehicle: {
      make,
      model,
      year,
      trim,
      bodyType: data.bodyType || null,
      fuelType: data.fuelType || null,
      transmission: data.transmission || null,
      driveType: data.driveType || null,
      engineDisplacement: data.engine ? String(data.engine) : null,
      color: data.color || null,
      country,
      currentKnownMileage: mileage,
    },
    photos: urls.map((sourceUrl, i) => ({
      sourceUrl,
      isPrimary: i === 0,
      sortOrder: i,
    })),
    observations: [
      {
        priceAmount,
        priceCurrency,
        mileage,
        mileageUnit,
        listingStatus: "active",
        location: null,
        observedAt: iso(row.updated_at || row.imported_at) || new Date().toISOString(),
      },
    ],
    events,
  });
}

const catalog = {
  format: "getcarapi-vin-catalog",
  version: 1,
  exportedAt: new Date().toISOString(),
  source: "kmcheck-vin-catalog",
  listings,
};

fs.writeFileSync(output, JSON.stringify(catalog));
const photoCount = listings.reduce((n, l) => n + (l.photos?.length || 0), 0);
console.log(
  JSON.stringify(
    {
      input,
      output,
      inputRows: rows.length,
      skippedNoVin,
      skippedNoPhoto,
      listings: listings.length,
      photos: photoCount,
      avgPhotos: +(photoCount / Math.max(listings.length, 1)).toFixed(1),
      providers: Object.fromEntries(
        [...listings.reduce((m, l) => m.set(l.provider, (m.get(l.provider) || 0) + 1), new Map())],
      ),
      bytes: fs.statSync(output).size,
    },
    null,
    2,
  ),
);
