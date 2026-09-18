/**
 * NFS Auto (nfsauto.by) — Korea Encar + China import catalogs.
 * Lot pages: /lot/korea-{id} | /lot/china-{id}.
 * Photos: keep only Encar CDN frames for this lot id (related cars use other ids).
 */
import type {
  ListingReference,
  NormalizedEvent,
  NormalizedListing,
  NormalizedPhoto,
} from "@workspace/providers";
import { CHINA, SOUTH_KOREA } from "../geo";
import { findVinInListing, normalizeLabeledVin, normalizeKrVin, vehicleFromParts } from "./kr-common";
import { extractMileageFromText } from "./mileage";
import {
  asPhotos,
  cleanPhotoUrl,
  isJunkPhotoUrl,
  photoIdentityKey,
} from "./web-html";

export const NFSAUTO_PARSER_VERSION = "nfsauto-v1.0.0";
export const NFSAUTO_WEB_BASE = "https://nfsauto.by";

export type NfsSource = "korea" | "china";

const LOT_PATH_RE = /\/lot\/(korea|china)-(\d{5,})/gi;

export function nfsautoDetailUrl(sourceIdOrUrl: string): string {
  const raw = sourceIdOrUrl.trim();
  if (raw.startsWith("http")) return raw.split("?")[0]!.replace(/\/$/, "");
  if (/^(korea|china)-\d+$/i.test(raw)) return `${NFSAUTO_WEB_BASE}/lot/${raw}`;
  if (raw.startsWith("nfs-")) return `${NFSAUTO_WEB_BASE}/lot/${raw.slice(4)}`;
  if (raw.startsWith("/")) return `${NFSAUTO_WEB_BASE}${raw}`;
  return `${NFSAUTO_WEB_BASE}/lot/${raw}`;
}

export function extractNfsLotId(url: string): { source: NfsSource; lotId: string; sourceId: string } | undefined {
  const m = url.match(/\/lot\/(korea|china)-(\d{5,})/i);
  if (!m) return undefined;
  const source = m[1]!.toLowerCase() as NfsSource;
  const lotId = m[2]!;
  return { source, lotId, sourceId: `nfs-${source}-${lotId}` };
}

export function extractNfsLotRefs(html: string, preferSource?: NfsSource): ListingReference[] {
  const seen = new Set<string>();
  const out: ListingReference[] = [];
  for (const m of html.matchAll(LOT_PATH_RE)) {
    const source = m[1]!.toLowerCase() as NfsSource;
    if (preferSource && source !== preferSource) continue;
    const lotId = m[2]!;
    const key = `${source}-${lotId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      sourceId: `nfs-${key}`,
      url: nfsautoDetailUrl(`${source}-${lotId}`),
      discoveredAt: new Date(),
    });
  }
  return out;
}

function decodeHtml(raw: string): string {
  return raw
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function plainText(html: string): string {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function fieldAfter(text: string, labels: string[]): string | undefined {
  for (const label of labels) {
    const re = new RegExp(
      `${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:：]?\\s*([^|\\n]{1,100})`,
      "i",
    );
    const m = text.match(re);
    if (m?.[1]) {
      const v = m[1].replace(/\s{2,}/g, " ").trim();
      if (v) return v;
    }
  }
  return undefined;
}

/**
 * Encar gallery paths embed the lot id: .../pic4237/42370022_001.jpg
 * Related cards point at other lots — drop those frames.
 */
export function collectNfsPhotos(html: string, lotId: string): NormalizedPhoto[] {
  const byKey = new Map<string, string>();
  const candidates: string[] = [];
  for (const m of html.matchAll(
    /(?:src|data-src|data-srcset|href)=["'](https?:\/\/[^"'>\s]+)/gi,
  )) {
    candidates.push(decodeHtml(m[1]!));
  }
  for (const m of html.matchAll(/https?:\/\/ci\.encar\.com\/[^"'\\\s>]+/gi)) {
    candidates.push(decodeHtml(m[0]!));
  }

  for (const raw of candidates) {
    let url = cleanPhotoUrl(raw);
    if (!url || isJunkPhotoUrl(url)) continue;
    // Same-lot Encar frames only.
    if (/ci\.encar\.com/i.test(url)) {
      if (!url.includes(lotId)) continue;
      // Prefer exterior gallery (_001…) over inspection diagrams when sorting later.
    } else if (/nfsauto\.by\/static\/uploads/i.test(url)) {
      // Site-hosted mirror — keep only if no other VIN-looking pollution; OK as extras.
    } else {
      continue;
    }
    const key = photoIdentityKey(url);
    if (!byKey.has(key)) byKey.set(key, url);
  }

  const urls = [...byKey.values()].sort((a, b) => nfsPhotoSortKey(a) - nfsPhotoSortKey(b));
  return asPhotos(urls, 40);
}

export function nfsPhotoSortKey(url: string): number {
  if (/\/inspection\//i.test(url) || /_photoFront|_photoRear|diagram/i.test(url)) return 500;
  const n = Number(url.match(/_(\d{3})\.(?:jpe?g|webp|png)/i)?.[1]);
  if (Number.isFinite(n)) {
    if (n >= 1 && n <= 20) return n;
    if (n >= 21) return 200 + n; // often VIN plate / docs
  }
  return 50;
}

function parseMileageKm(text: string): number | undefined {
  const m = text.match(/Пробег(?:,?\s*км)?\s*([\d\s\u00a0]+)/i);
  if (m?.[1]) {
    const n = Number(m[1].replace(/[\s\u00a0]/g, ""));
    if (Number.isFinite(n) && n > 1) return n;
  }
  return extractMileageFromText(text);
}

function parsePriceByn(text: string): number | undefined {
  const m = text.match(/Цена объявления\s*([\d\s\u00a0]+)\s*BYN/i);
  if (!m?.[1]) return undefined;
  const n = Number(m[1].replace(/[\s\u00a0]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function extractNfsVin(html: string, text: string): string | undefined {
  // Spec tile: label VIN → value in sibling tile
  const tile = html.match(
    /nfs-spec-tile-label-text">\s*VIN\s*<\/span>[\s\S]{0,200}?nfs-spec-tile-value">\s*([A-HJ-NPR-Z0-9]{17})\s*</i,
  );
  if (tile?.[1]) {
    return normalizeLabeledVin(tile[1]) ?? normalizeKrVin(tile[1]);
  }
  const labeled = findVinInListing(html, text);
  if (labeled) return labeled;
  const loose = text.match(/\b([A-HJ-NPR-Z0-9]{17})\b/);
  return loose?.[1] ? normalizeLabeledVin(loose[1]) ?? normalizeKrVin(loose[1]) : undefined;
}

export function parseNfsautoDetail(html: string, pageUrl: string): NormalizedListing {
  const lot = extractNfsLotId(pageUrl);
  const lotId = lot?.lotId ?? pageUrl.match(/(\d{5,})/)?.[1] ?? "unknown";
  const source = lot?.source ?? (/china/i.test(pageUrl) ? "china" : "korea");
  const country = source === "china" ? CHINA : SOUTH_KOREA;
  const text = plainText(html);
  const vin = extractNfsVin(html, text);

  const photos = collectNfsPhotos(html, lotId);
  const year = Number(fieldAfter(text, ["Год выпуска"])?.match(/\d{4}/)?.[0]) || undefined;
  const modelLine = fieldAfter(text, ["Модель"]);
  // "New Sorento 4 th generation …" — take first token-ish brand from known list in page.
  const make =
    fieldAfter(text, ["Марка"]) ||
    text.match(/\b(Kia|Hyundai|Genesis|BMW|Mercedes|Toyota|Honda|Chevrolet|Audi|Volkswagen)\b/i)?.[1];
  const mileage = parseMileageKm(text);
  const priceAmount = parsePriceByn(text);
  const fuel = fieldAfter(text, ["Топливо"]);
  const transmission = fieldAfter(text, ["Коробка"]);
  const drive = fieldAfter(text, ["Привод"]);
  const engine = fieldAfter(text, ["Объем двигателя", "Объём двигателя"]);
  const title =
    [year, make, modelLine].filter(Boolean).join(" ").replace(/\s{2,}/g, " ").trim() ||
    `NFS ${source} ${lotId}`;

  const events: NormalizedEvent[] = [];
  // No reliable auction/listing date on NFS lot HTML — omit dated events rather than stamp crawl time.

  return {
    sourceId: lot?.sourceId ?? `nfs-${source}-${lotId}`,
    sourceUrl: nfsautoDetailUrl(`${source}-${lotId}`),
    title,
    priceAmount,
    priceCurrency: priceAmount != null ? "BYN" : undefined,
    mileage: mileage ?? undefined,
    mileageUnit: "km",
    location: country,
    country,
    isActive: true,
    listingStatus: "active",
    events: events.length ? events : undefined,
    vehicle: vehicleFromParts({
      vin: vin ?? undefined,
      make: make ? String(make) : undefined,
      model: modelLine,
      year: Number.isFinite(year) ? year : undefined,
      fuelType: fuel,
      transmission,
      driveType: drive,
      engineDisplacement: engine,
      country,
    }),
    photos,
  };
}
