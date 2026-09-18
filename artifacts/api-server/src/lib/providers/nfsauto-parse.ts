/**
 * NFS Auto (nfsauto.by) — Korea + China catalogs.
 * Ingest is JSON-first: embedded lot JSON + gallery API. No HTML fixtures; page body
 * is only scanned for JSON islands / structured data-* then discarded.
 */
import type {
  ListingReference,
  NormalizedEvent,
  NormalizedListing,
  NormalizedPhoto,
} from "@workspace/providers";
import { CHINA, SOUTH_KOREA } from "../geo";
import { findVinInListing, normalizeLabeledVin, normalizeKrVin, vehicleFromParts } from "./kr-common";
import {
  normalizeRuBody,
  normalizeRuColor,
  normalizeRuDrive,
  normalizeRuFuel,
  normalizeRuTransmission,
  parseRuDisplayDate,
} from "./ru-locale";
import {
  asPhotos,
  cleanPhotoUrl,
  isJunkPhotoUrl,
  photoIdentityKey,
} from "./web-html";

export const NFSAUTO_PARSER_VERSION = "nfsauto-v1.2.0";
export const NFSAUTO_WEB_BASE = "https://nfsauto.by";

export type NfsSource = "korea" | "china";

/** Structured lot payload persisted to raw_source_records (never HTML). */
export type NfsLotJson = {
  source: NfsSource;
  sourceId: string;
  slug: string;
  lotIdInternal?: number;
  encarOrChinaLotId: string;
  displayName?: string;
  brand?: string;
  title?: string;
  priceByn?: number;
  year?: number;
  fuelRaw?: string;
  engineCc?: number;
  mileageKm?: number;
  vin?: string;
  specs: Record<string, string>;
  publishDateRaw?: string;
  firstRegRaw?: string;
  galleryUrls: string[];
  fxTotals?: Record<string, number>;
};

const LOT_PATH_RE = /\/lot\/(korea|china)-(\d{5,})/gi;

const LABEL_ALIASES: Record<string, string> = {
  модель: "model",
  марка: "make",
  "год выпуска": "year",
  "пробег, км": "mileage",
  пробег: "mileage",
  топливо: "fuel",
  коробка: "transmission",
  трансмиссия: "transmission",
  привод: "drive",
  "объем двигателя": "engine",
  "объём двигателя": "engine",
  двигатель: "engine",
  цвет: "color",
  кузов: "body",
  "класс автомобиля": "body",
  vin: "vin",
  страна: "origin_country",
  "дата постановки на учет": "first_reg",
  "дата постановки на учёт": "first_reg",
};

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

export function nfsCountryForSource(source: NfsSource): string {
  return source === "china" ? CHINA : SOUTH_KOREA;
}

/** Country from listing source id (`nfs-china-…` / `nfs-korea-…`). */
export function nfsCountryFromSourceId(sourceId?: string | null): string | undefined {
  if (!sourceId) return undefined;
  if (/^nfs-china-/i.test(sourceId) || /\/lot\/china-/i.test(sourceId)) return CHINA;
  if (/^nfs-korea-/i.test(sourceId) || /\/lot\/korea-/i.test(sourceId)) return SOUTH_KOREA;
  return undefined;
}

export function extractNfsLotRefs(blob: string, preferSource?: NfsSource): ListingReference[] {
  const seen = new Set<string>();
  const out: ListingReference[] = [];
  for (const m of blob.matchAll(LOT_PATH_RE)) {
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
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function aliasLabel(raw: string): string | undefined {
  const key = decodeHtml(raw).replace(/\s+/g, " ").trim().toLowerCase();
  return LABEL_ALIASES[key];
}

/** Pull structured label→value pairs into a JSON map (not free-text fieldAfter). */
function extractSpecMap(page: string): Record<string, string> {
  const out: Record<string, string> = {};
  const put = (labelRaw: string, valueRaw: string) => {
    const key = aliasLabel(labelRaw);
    if (!key) return;
    const value = decodeHtml(valueRaw).replace(/\s+/g, " ").trim();
    if (!value || value === "—" || value === "-" || value === "–") return;
    if (!out[key]) out[key] = value;
  };
  for (const m of page.matchAll(
    /quick-spec-label">\s*([^<]+?)\s*<\/div>\s*<div class="quick-spec-value">\s*([^<]*?)\s*</gi,
  )) {
    put(m[1]!, m[2]!);
  }
  for (const m of page.matchAll(
    /nfs-spec-tile-label-text">\s*([^<]+?)\s*<\/span>[\s\S]{0,240}?nfs-spec-tile-value">\s*([^<]*?)\s*</gi,
  )) {
    put(m[1]!, m[2]!);
  }
  return out;
}

function parseLotPageObject(page: string): Record<string, unknown> | undefined {
  const m = page.match(/window\.__NFS_LOT_PAGE__\s*=\s*(\{[\s\S]*?\});/);
  if (!m?.[1]) return undefined;
  try {
    return JSON.parse(m[1]);
  } catch {
    try {
      // Site emits a JS object literal (unquoted keys) — evaluate as expression only.
      // eslint-disable-next-line @typescript-eslint/no-implied-eval
      const val = new Function(`"use strict"; return (${m[1]});`)();
      return val && typeof val === "object" ? (val as Record<string, unknown>) : undefined;
    } catch {
      return undefined;
    }
  }
}

function parseDeliveryInitial(page: string): {
  priceByn?: number;
  source?: NfsSource;
  year?: number;
  fuelRaw?: string;
  engineCc?: number;
  fxTotals?: Record<string, number>;
} {
  const attr = page.match(/data-initial='(\{[\s\S]*?\})'/);
  if (!attr?.[1]) return {};
  try {
    const json = JSON.parse(attr[1].replace(/&quot;/g, '"')) as {
      input?: {
        price_byn?: number;
        source?: string;
        year?: number;
        fuel_type?: string;
        engine_cc?: number;
      };
      insights?: { future_totals?: Record<string, number> };
    };
    const src = String(json.input?.source ?? "").toLowerCase();
    return {
      priceByn: typeof json.input?.price_byn === "number" ? json.input.price_byn : undefined,
      source: src === "china" || src === "korea" ? (src as NfsSource) : undefined,
      year: typeof json.input?.year === "number" ? json.input.year : undefined,
      fuelRaw: json.input?.fuel_type,
      engineCc: typeof json.input?.engine_cc === "number" ? json.input.engine_cc : undefined,
      fxTotals: json.insights?.future_totals,
    };
  } catch {
    return {};
  }
}

function parseLotDataAttrs(page: string): {
  brand?: string;
  title?: string;
  priceByn?: number;
  slug?: string;
  lotIdInternal?: number;
} {
  const block =
    page.match(
      /data-lot-id="(\d+)"[\s\S]{0,800}?data-lot-slug="((?:korea|china)-\d+)"/i,
    ) ||
    page.match(
      /data-lot-slug="((?:korea|china)-\d+)"[\s\S]{0,800}?data-lot-id="(\d+)"/i,
    );
  const slug = page.match(/data-lot-slug="((?:korea|china)-\d+)"/i)?.[1];
  const brand = page.match(/data-lot-brand="([^"]+)"/i)?.[1];
  const title = page.match(/data-lot-title="([^"]+)"/i)?.[1];
  const price = page.match(/data-lot-price="([\d.]+)"/i)?.[1];
  const lotIdInternal = Number(page.match(/data-lot-id="(\d+)"/i)?.[1]);
  return {
    brand: brand ? decodeHtml(brand) : undefined,
    title: title ? decodeHtml(title) : undefined,
    priceByn: price && Number.isFinite(Number(price)) ? Number(price) : undefined,
    slug: slug ?? (block ? String(block[2] || block[1]) : undefined),
    lotIdInternal: Number.isFinite(lotIdInternal) ? lotIdInternal : undefined,
  };
}

function extractPublishRaw(page: string): string | undefined {
  const clock = page.match(
    /nfs-t-clock-hour-4[\s\S]{0,280}?<span>\s*(\d{1,2}\s+[А-Яа-яЁё]+\s+\d{4})\s*<\/span>/i,
  );
  return clock?.[1]?.trim();
}

/**
 * Build the JSON lot document from a lot page body (JSON islands + structured attrs).
 * Callers should persist this object and discard the HTML.
 */
export function extractNfsLotJson(page: string, pageUrl: string): NfsLotJson {
  const fromUrl = extractNfsLotId(pageUrl);
  const lotPage = parseLotPageObject(page);
  const delivery = parseDeliveryInitial(page);
  const attrs = parseLotDataAttrs(page);
  const specs = extractSpecMap(page);

  const slug =
    attrs.slug ||
    String(lotPage?.slug ?? "") ||
    (fromUrl ? `${fromUrl.source}-${fromUrl.lotId}` : "");
  const parsedSlug = extractNfsLotId(`/lot/${slug}`) ?? fromUrl;
  const source: NfsSource =
    delivery.source ||
    parsedSlug?.source ||
    (/china/i.test(pageUrl) ? "china" : "korea");
  const encarOrChinaLotId = parsedSlug?.lotId ?? fromUrl?.lotId ?? "unknown";
  const sourceId = parsedSlug?.sourceId ?? `nfs-${source}-${encarOrChinaLotId}`;

  const galleryFromPage = Array.isArray(lotPage?.galleryUrls)
    ? (lotPage!.galleryUrls as unknown[]).map(String)
    : [];

  let vin =
    specs.vin ||
    page.match(
      /nfs-spec-tile-label-text">\s*VIN\s*<\/span>[\s\S]{0,200}?nfs-spec-tile-value">\s*([A-HJ-NPR-Z0-9]{17})\s*</i,
    )?.[1];
  if (vin) vin = normalizeLabeledVin(vin) ?? normalizeKrVin(vin) ?? vin;
  if (!vin) vin = findVinInListing(page) ?? undefined;

  const mileageRaw = specs.mileage?.replace(/[^\d]/g, "");
  const mileageKm = mileageRaw ? Number(mileageRaw) : undefined;

  return {
    source,
    sourceId,
    slug: slug || `${source}-${encarOrChinaLotId}`,
    lotIdInternal:
      attrs.lotIdInternal ||
      (typeof lotPage?.lotId === "number" ? lotPage.lotId : undefined),
    encarOrChinaLotId,
    displayName: String(lotPage?.displayName ?? attrs.title ?? lotPage?.lotName ?? "") || undefined,
    brand: attrs.brand || specs.make,
    title: attrs.title || String(lotPage?.displayName ?? ""),
    priceByn:
      delivery.priceByn ??
      attrs.priceByn ??
      (typeof lotPage?.lotPrice === "number" ? lotPage.lotPrice : undefined),
    year: delivery.year || Number(specs.year?.match(/\d{4}/)?.[0]) || undefined,
    fuelRaw: delivery.fuelRaw || specs.fuel,
    engineCc: delivery.engineCc,
    mileageKm: Number.isFinite(mileageKm) && (mileageKm as number) > 1 ? mileageKm : undefined,
    vin: vin || undefined,
    specs,
    publishDateRaw: extractPublishRaw(page),
    firstRegRaw: specs.first_reg,
    galleryUrls: galleryFromPage,
    fxTotals: delivery.fxTotals,
  };
}

export function mergeNfsGalleryUrls(lot: NfsLotJson, urls: string[]): NfsLotJson {
  const merged = [...lot.galleryUrls];
  const seen = new Set(merged.map((u) => photoIdentityKey(u)));
  for (const raw of urls) {
    const url = cleanPhotoUrl(raw.startsWith("/") ? `${NFSAUTO_WEB_BASE}${raw}` : raw);
    if (!url || isJunkPhotoUrl(url)) continue;
    const key = photoIdentityKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(url);
  }
  return { ...lot, galleryUrls: merged };
}

export function nfsPhotoSortKey(url: string): number {
  if (/\/inspection\//i.test(url) || /_photoFront|_photoRear|diagram/i.test(url)) return 500;
  const n = Number(url.match(/_(\d{3})\.(?:jpe?g|webp|png)/i)?.[1]);
  if (Number.isFinite(n)) {
    if (n >= 1 && n <= 20) return n;
    if (n >= 21) return 200 + n;
  }
  return 50;
}

function collectPhotos(lot: NfsLotJson): NormalizedPhoto[] {
  const byKey = new Map<string, string>();
  const lotId = lot.encarOrChinaLotId;
  for (const raw of lot.galleryUrls) {
    let url = cleanPhotoUrl(raw.startsWith("/") ? `${NFSAUTO_WEB_BASE}${raw}` : raw);
    if (!url || isJunkPhotoUrl(url)) continue;
    if (/ci\.encar\.com/i.test(url) && lotId && !url.includes(lotId)) continue;
    const key = photoIdentityKey(url);
    if (!byKey.has(key)) byKey.set(key, url);
  }
  const urls = [...byKey.values()].sort((a, b) => nfsPhotoSortKey(a) - nfsPhotoSortKey(b));
  return asPhotos(urls, 40);
}

function priceUsdFromLot(lot: NfsLotJson): { amount: number; currency: "USD" | "KRW" | "CNY" } | undefined {
  const priceByn = lot.priceByn;
  if (priceByn == null || !(priceByn > 0)) return undefined;
  const bynRef = lot.fxTotals?.BYN;
  const usdRef = lot.fxTotals?.USD;
  if (bynRef && usdRef && bynRef > 0 && usdRef > 0) {
    const usd = Math.round((priceByn * (usdRef / bynRef)) * 100) / 100;
    if (usd > 0) return { amount: usd, currency: "USD" };
  }
  const usd = Math.round((priceByn / 3.03) * 100) / 100;
  if (usd > 0) return { amount: usd, currency: "USD" };
  return undefined;
}

function engineLiters(lot: NfsLotJson): string | undefined {
  if (lot.engineCc && lot.engineCc > 0) {
    if (lot.engineCc >= 100) return `${(lot.engineCc / 1000).toFixed(lot.engineCc % 1000 === 0 ? 0 : 1)}L`;
  }
  const raw = lot.specs.engine;
  if (!raw) return undefined;
  const t = raw.replace(",", ".").replace(/\s+/g, " ").trim();
  const n = Number(t.replace(/[^\d.]/g, ""));
  if (Number.isFinite(n) && n > 0 && n < 20) return `${n}L`;
  return t || undefined;
}

/** Parse from structured NFS JSON (preferred path). */
export function parseNfsautoLotJson(lot: NfsLotJson): NormalizedListing {
  const country = nfsCountryForSource(lot.source);
  const year = lot.year || Number(lot.specs.year?.match(/\d{4}/)?.[0]) || undefined;
  const modelLine = lot.specs.model;
  const make =
    lot.brand ||
    lot.specs.make ||
    lot.displayName?.match(
      /\b(Kia|Hyundai|Genesis|BMW|Mercedes(?:-Benz)?|Toyota|Honda|Chevrolet|Audi|Volkswagen|Nissan|Lexus|SsangYong|Renault|Mini|Ford|Mazda|Subaru|Volvo|Porsche|Land\s*Rover|Jeep|Tesla|BYD|Geely|Chery|Haval|Great\s*Wall|Changan|Hongqi|GAC|Buick|Cadillac)\b/i,
    )?.[1];
  const price = priceUsdFromLot(lot);
  const fuel = normalizeRuFuel(lot.fuelRaw || lot.specs.fuel);
  const transmission = normalizeRuTransmission(lot.specs.transmission);
  const drive = normalizeRuDrive(lot.specs.drive);
  const color = normalizeRuColor(lot.specs.color);
  const bodyType = normalizeRuBody(lot.specs.body);
  const title =
    lot.displayName ||
    lot.title ||
    [year, make, modelLine].filter(Boolean).join(" ").trim() ||
    `NFS ${lot.source} ${lot.encarOrChinaLotId}`;

  const publishedAt = lot.publishDateRaw ? parseRuDisplayDate(lot.publishDateRaw) : undefined;
  const firstReg = lot.firstRegRaw ? parseRuDisplayDate(lot.firstRegRaw) : undefined;
  const events: NormalizedEvent[] = [];
  if (firstReg) {
    events.push({
      eventType: "other",
      description: "First registration",
      occurredAt: firstReg,
      metadata: { source: "nfsauto", field: "first_registration" },
    });
  }

  return {
    sourceId: lot.sourceId,
    sourceUrl: nfsautoDetailUrl(lot.slug),
    title,
    priceAmount: price?.amount,
    priceCurrency: price?.currency,
    mileage: lot.mileageKm,
    mileageUnit: "km",
    location: country,
    country,
    isActive: true,
    listingStatus: "active",
    sourceListedAt: publishedAt,
    sourceModifiedAt: publishedAt,
    events: events.length ? events : undefined,
    vehicle: vehicleFromParts({
      vin: lot.vin,
      make: make ? String(make) : undefined,
      model: modelLine,
      year: Number.isFinite(year) ? year : undefined,
      fuelType: fuel,
      transmission,
      driveType: drive,
      color,
      bodyType,
      engineDisplacement: engineLiters(lot),
      country,
    }),
    photos: collectPhotos(lot),
  };
}

/** @deprecated Prefer extractNfsLotJson + parseNfsautoLotJson. */
export function parseNfsautoDetail(html: string, pageUrl: string): NormalizedListing {
  return parseNfsautoLotJson(extractNfsLotJson(html, pageUrl));
}

/** Photo helper kept for unit tests with URL lists. */
export function collectNfsPhotosFromUrls(urls: string[], lotId: string): NormalizedPhoto[] {
  return collectPhotos({
    source: "korea",
    sourceId: `nfs-korea-${lotId}`,
    slug: `korea-${lotId}`,
    encarOrChinaLotId: lotId,
    specs: {},
    galleryUrls: urls,
  });
}
