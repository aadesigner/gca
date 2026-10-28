/**
 * Convert Carstat/kmcheck VIN CSV → getcarapi-vin-catalog v1.
 * Only cars with Encar photos. Korean registry → vehicle events.
 *
 *   node --import ./scripts/load-env.mjs ./scripts/src/_ops-convert-carstat-csv.mjs [in.csv] [out.json]
 */
import fs from "node:fs";
import path from "node:path";

const input =
  process.argv[2] ||
  "c:/Users/Pc/.cursor/projects/c-Users-Pc-Downloads-gca/attachments/f697aa6f-10bd-47bc-bc7a-59eb19217877/vin-catalog-2026-10-28.csv";
const output =
  process.argv[3] ||
  path.join(path.dirname(input), "getcarapi-vin-catalog-2026-10-28.json");

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function parseJsonCell(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : v && typeof v === "object" ? [v] : [];
  } catch {
    return [];
  }
}

function parseObjCell(raw) {
  const s = String(raw ?? "").trim();
  if (!s) return {};
  try {
    const v = JSON.parse(s);
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch {
    return {};
  }
}

function num(v) {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function iso(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function encarCarIdFromUrl(url) {
  const m = String(url).match(/\/pic\d+\/(\d+)_\d+\./i);
  return m?.[1] ?? null;
}

function photoIdentityKey(url) {
  let u = String(url).trim().split("#")[0].split("?")[0].replace(/\/+$/, "").toLowerCase();
  u = u.replace(/\/w_\d+x\d+\//g, "/");
  u = u.replace(/\/\d{2,4}x\d{2,4}\//g, "/");
  u = u.replace(/_(?:thumb|small|medium|large|orig)\.(jpe?g|webp|png)$/i, ".$1");
  return u;
}

function usablePhotos(photosCell) {
  const parts = String(photosCell ?? "")
    .split("|")
    .map((u) => u.trim())
    .filter((u) => /^https?:\/\//i.test(u));
  const out = [];
  const seen = new Set();
  for (const raw of parts) {
    let parsed;
    try {
      parsed = new URL(raw);
    } catch {
      continue;
    }
    const host = parsed.hostname.toLowerCase();
    if (/copart\.com$|iaai\.com$|carstat\.info$/.test(host)) continue;
    const isEncar = /(^|\.)encar\.com$/.test(host);
    if (isEncar && parsed.searchParams.get("rh") === "600") continue;
    const clean = isEncar ? `${parsed.origin}${parsed.pathname}` : raw.split("#")[0];
    const key = photoIdentityKey(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }
  // Prefer Encar frames; keep other hosts if that's all the car has.
  const encar = out.filter((u) => /encar\.com/i.test(u));
  return encar.length ? encar : out;
}

function mapRegistryType(type) {
  const t = String(type || "").toLowerCase();
  if (t.includes("owner")) return "owner_change";
  if (t.includes("inspect")) return "inspection";
  if (t.includes("delivery") || t.includes("new_car") || t.includes("shipment")) return "delivery";
  if (t.includes("accident") || t.includes("insurance") || t.includes("claim")) return "accident";
  if (t.includes("flood")) return "flood_damage";
  if (t.includes("total_loss") || t.includes("total loss")) return "total_loss";
  return "other";
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

function buildEvents(row) {
  const events = [];
  for (const a of parseJsonCell(row.accidents_json)) {
    pushEvent(events, "accident", a.description || a.type || a.severity || "accident", a.date, a);
  }
  for (const a of parseJsonCell(row.insurance_claims_json)) {
    pushEvent(
      events,
      "accident",
      a.description || a.type || "insurance claim",
      a.date,
      { kind: "insurance_claim", ...a },
    );
  }
  for (const r of parseJsonCell(row.registry_history_json)) {
    pushEvent(
      events,
      mapRegistryType(r.type),
      r.title || r.subtitle || r.type || "registry",
      r.date,
      { kind: "korean_registry", ...r },
    );
  }
  for (const o of parseJsonCell(row.owner_history_json)) {
    pushEvent(events, "owner_change", o.lotStatus || o.condition || "owner history", o.date, o);
  }
  for (const s of parseJsonCell(row.service_history_json)) {
    pushEvent(events, "other", s.title || s.type || "service", s.date, { kind: "service", ...s });
  }
  return events;
}

function observationsFrom(row, mileage, priceAmount, priceCurrency) {
  const out = [];
  const seen = new Set();
  for (const m of parseJsonCell(row.mileage_history_json)) {
    const km = num(m.odometer ?? m.mileage);
    const at = iso(m.date);
    const key = `${at || ""}:${km ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      priceAmount: num(m.auctionPrice) ?? priceAmount,
      priceCurrency,
      mileage: km,
      mileageUnit: String(m.unit || "km").toLowerCase().startsWith("mi") ? "mi" : "km",
      listingStatus: String(m.lotStatus || "active").toLowerCase() === "sold" ? "inactive" : "active",
      location: m.location || row.country || null,
      observedAt: at,
    });
  }
  if (!out.length) {
    out.push({
      priceAmount,
      priceCurrency,
      mileage,
      mileageUnit: "km",
      listingStatus: "active",
      location: row.country || null,
      observedAt: iso(row.updated_at || row.imported_at) || new Date().toISOString(),
    });
  }
  return out;
}

function priceFrom(row) {
  const md = parseObjCell(row.market_data_json);
  if (num(md.estimatedValue) != null) {
    return {
      priceAmount: Math.round(num(md.estimatedValue)),
      priceCurrency: String(md.currency || "USD").toUpperCase(),
    };
  }
  for (const a of parseJsonCell(row.auction_history_json)) {
    for (const key of ["finalPrice", "buyNowPrice", "openingBid", "auctionPrice"]) {
      const n = num(a?.[key]);
      if (n != null && n > 0) return { priceAmount: Math.round(n), priceCurrency: "USD" };
    }
  }
  return { priceAmount: null, priceCurrency: "USD" };
}

const raw = fs.readFileSync(input, "utf8").replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
const lines = raw.split("\n").filter((line) => line.trim());
const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const get = (cols, name) => (cols[idx[name]] ?? "").trim();

const listings = [];
let skippedNoPhoto = 0;
let skippedNoVin = 0;

for (const line of lines.slice(1)) {
  const cols = parseCsvLine(line);
  const row = {};
  for (const name of header) row[name] = get(cols, name);

  const vin = String(row.vin || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-HJ-NPR-Z0-9]/g, "");
  if (vin.length !== 17) {
    skippedNoVin++;
    continue;
  }

  const urls = usablePhotos(row.photos);
  if (!urls.length) {
    skippedNoPhoto++;
    continue;
  }

  const encarId = urls.map(encarCarIdFromUrl).find(Boolean) || null;
  const mileage = num(row.odometer_km);
  const { priceAmount, priceCurrency } = priceFrom(row);
  const make = row.make || null;
  const model = row.model || null;
  const year = num(row.year);
  const trim = row.trim || null;
  const country = (row.country || "kr").toUpperCase() === "KR" ? "KR" : (row.country || "KR").toUpperCase();

  listings.push({
    vin,
    provider: "encar",
    providerName: "Encar",
    sourceId: encarId || `import:${vin}`,
    sourceUrl: encarId ? `https://fem.encar.com/cars/detail/${encarId}` : null,
    title: [year, make, model, trim].filter(Boolean).join(" ") || null,
    priceAmount,
    priceCurrency,
    mileage,
    mileageUnit: "km",
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
      bodyType: row.body_type || null,
      fuelType: row.fuel_type || null,
      transmission: row.transmission || null,
      driveType: null,
      engineDisplacement: row.engine ? String(row.engine) : null,
      color: row.color || null,
      country,
      currentKnownMileage: mileage,
    },
    photos: urls.map((sourceUrl, i) => ({
      sourceUrl,
      isPrimary: i === 0,
      sortOrder: i,
    })),
    observations: observationsFrom(row, mileage, priceAmount, priceCurrency),
    events: buildEvents(row),
  });
}

const catalog = {
  format: "getcarapi-vin-catalog",
  version: 1,
  exportedAt: new Date().toISOString(),
  source: "carstat-vin-catalog-csv",
  listings,
};

fs.writeFileSync(output, JSON.stringify(catalog));
const photos = listings.reduce((n, l) => n + (l.photos?.length || 0), 0);
const events = listings.reduce((n, l) => n + (l.events?.length || 0), 0);
console.log(
  JSON.stringify(
    {
      input,
      output,
      rows: lines.length - 1,
      listings: listings.length,
      skippedNoVin,
      skippedNoPhoto,
      photos,
      events,
      mb: (fs.statSync(output).size / 1024 / 1024).toFixed(2),
    },
    null,
    2,
  ),
);
