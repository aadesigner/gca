/**
 * Auto Partner (cars.autopartner.by) — Copart / IAAI / Encar catalog.
 * Detail: /v/{VIN}. Related-car cards pollute galleries — keep only photos
 * whose CDN path contains this page's VIN.
 */
import type {
  ListingReference,
  NormalizedEvent,
  NormalizedListing,
  NormalizedPhoto,
} from "@workspace/providers";
import { SOUTH_KOREA, UNITED_STATES } from "../geo";
import { findVinInListing, normalizeKrVin, vehicleFromParts } from "./kr-common";
import { extractMileageFromText } from "./mileage";
import {
  normalizeRuBody,
  normalizeRuColor,
  normalizeRuDrive,
  normalizeRuFuel,
  normalizeRuTransmission,
} from "./ru-locale";
import {
  asPhotos,
  cleanPhotoUrl,
  isJunkPhotoUrl,
  photoIdentityKey,
  str,
} from "./web-html";

export const AUTOPARTNER_PARSER_VERSION = "autopartner-v1.1.0";
export const AUTOPARTNER_WEB_BASE = "https://cars.autopartner.by";

const VIN_RE = /\b([A-HJ-NPR-Z0-9]{17})\b/i;

export function autopartnerDetailUrl(vinOrUrl: string): string {
  const raw = vinOrUrl.trim();
  if (raw.startsWith("http")) return raw.split("?")[0]!.replace(/\/$/, "");
  const vin = normalizeKrVin(raw) || raw.toUpperCase();
  return `${AUTOPARTNER_WEB_BASE}/v/${vin}`;
}

export function extractAutopartnerVin(url: string): string | undefined {
  const m = url.match(/\/v\/([A-HJ-NPR-Z0-9]{17})/i);
  return m?.[1] ? normalizeKrVin(m[1]) : undefined;
}

/** Search / catalog cards → /v/{VIN} refs (deduped). */
export function extractAutopartnerSearchRefs(html: string): ListingReference[] {
  const seen = new Set<string>();
  const out: ListingReference[] = [];
  for (const m of html.matchAll(/https?:\/\/cars\.autopartner\.by\/v\/([A-HJ-NPR-Z0-9]{17})/gi)) {
    const vin = normalizeKrVin(m[1]);
    if (!vin || seen.has(vin)) continue;
    seen.add(vin);
    out.push({
      sourceId: `ap-${vin}`,
      url: autopartnerDetailUrl(vin),
      discoveredAt: new Date(),
    });
  }
  for (const m of html.matchAll(/href=["']\/v\/([A-HJ-NPR-Z0-9]{17})["']/gi)) {
    const vin = normalizeKrVin(m[1]);
    if (!vin || seen.has(vin)) continue;
    seen.add(vin);
    out.push({
      sourceId: `ap-${vin}`,
      url: autopartnerDetailUrl(vin),
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

const AP_LABEL_ALIASES: Record<string, string> = {
  цвет: "color",
  топливо: "fuel",
  привод: "drive",
  трансмиссия: "transmission",
  коробка: "transmission",
  двигатель: "engine",
  "год выпуска": "year",
  марка: "make",
  модель: "model",
  "тип кузова": "body",
  кузов: "body",
  "основные повреждения": "damage",
  повреждения: "damage",
  местоположение: "location",
  "текущее местонахождение лота": "location",
};

/** Spec rows: label span + dotted rule + value div — never plain-text fieldAfter. */
export function extractAutopartnerSpecMap(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(
    /pr-2">\s*([^<]+?)\s*<\/span>[\s\S]{0,220}?pl-2">\s*([^<]+?)\s*<\/div>/gi,
  )) {
    const key = AP_LABEL_ALIASES[decodeHtml(m[1]!).replace(/\s+/g, " ").trim().toLowerCase()];
    if (!key) continue;
    const value = decodeHtml(m[2]!).replace(/\s+/g, " ").trim();
    if (!value || value === "—" || value === "-") continue;
    if (!out[key]) out[key] = value;
  }
  return out;
}

function fieldAfter(text: string, labels: string[]): string | undefined {
  // Bounded fallback only — stop before the next known RU/EN label.
  const stop =
    "VIN|Марка|Модель|Год|Цвет|Топливо|Привод|Коробка|Трансмиссия|Двигатель|Одометр|Пробег|Лот|Цена|Тип кузова|Поврежден";
  for (const label of labels) {
    const re = new RegExp(
      `${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*[:：]?\\s*([^|\\n]{1,60}?)(?=\\s*(?:${stop})\\b|$)`,
      "i",
    );
    const m = text.match(re);
    if (m?.[1]) {
      const v = m[1].replace(/\s{2,}/g, " ").trim();
      if (v && v.length <= 48 && !/^(VIN|Марка|Модель|Год)/i.test(v)) return v;
    }
  }
  return undefined;
}

function parseJsonLdVehicle(html: string): Record<string, unknown> | undefined {
  for (const m of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const raw = JSON.parse(m[1]!);
      const nodes = Array.isArray(raw) ? raw : [raw];
      for (const node of nodes) {
        if (node && typeof node === "object" && String((node as { "@type"?: string })["@type"]) === "Vehicle") {
          return node as Record<string, unknown>;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

/**
 * Keep only CDN frames for this VIN. Related-car carousels reuse other VINs in the path.
 * image.autopartner.by/{platform}/{make}/{model}/{year}/{lot}/{VIN}-{n}-….webp
 */
export function collectAutopartnerPhotos(html: string, vin: string): NormalizedPhoto[] {
  const vinUpper = vin.toUpperCase();
  const byKey = new Map<string, string>();
  for (const m of html.matchAll(
    /(?:src|data-src|data-srcset|href)=["'](https?:\/\/image\.autopartner\.by\/[^"'>\s]+)/gi,
  )) {
    let url = cleanPhotoUrl(decodeHtml(m[1]!));
    if (!url || isJunkPhotoUrl(url)) continue;
    if (!url.toUpperCase().includes(vinUpper)) continue;
    // Prefer full-size over tiny variants if query present — strip size params we don't need.
    const key = photoIdentityKey(url);
    if (!byKey.has(key)) byKey.set(key, url);
  }
  // Also bare URLs in HTML (lazy swiper).
  for (const m of html.matchAll(
    /https?:\/\/image\.autopartner\.by\/[a-z0-9/_-]*?[A-HJ-NPR-Z0-9]{17}[^"'\\\s>]*/gi,
  )) {
    let url = cleanPhotoUrl(decodeHtml(m[0]!));
    if (!url || isJunkPhotoUrl(url)) continue;
    if (!url.toUpperCase().includes(vinUpper)) continue;
    const key = photoIdentityKey(url);
    if (!byKey.has(key)) byKey.set(key, url);
  }

  const urls = [...byKey.values()].sort((a, b) => autopartnerPhotoSortKey(a) - autopartnerPhotoSortKey(b));
  return asPhotos(urls, 40);
}

/** Prefer exterior shot index 1–6; demote high indices (often close-ups / docs). */
export function autopartnerPhotoSortKey(url: string): number {
  const shot = url.match(/\/[A-HJ-NPR-Z0-9]{17}-(\d+)/i)?.[1];
  if (shot) {
    const n = Number(shot);
    if (n === 1) return 0;
    if (n >= 2 && n <= 8) return n;
    return 100 + n;
  }
  return 50;
}

function originCountry(text: string, platform?: string): string {
  const blob = `${platform ?? ""} ${text}`.toLowerCase();
  if (/encar|коре|korea/.test(blob)) return SOUTH_KOREA;
  return UNITED_STATES;
}

function platformOf(text: string, photoUrl?: string): string | undefined {
  if (/iaai|iaa\.com/i.test(text) || /\/iaai\//i.test(photoUrl ?? "")) return "IAAI";
  if (/copart/i.test(text) || /\/copart\//i.test(photoUrl ?? "")) return "Copart";
  if (/encar/i.test(text) || /\/encar\//i.test(photoUrl ?? "")) return "Encar";
  return undefined;
}

function parseLotId(text: string, photoUrl?: string): string | undefined {
  const fromPhoto = photoUrl?.match(/\/(\d{6,})\//)?.[1];
  if (fromPhoto) return fromPhoto;
  const m = text.match(/(?:Лот|Lot|лота)\s*[#:]?\s*(\d{6,})/i);
  return m?.[1];
}

function parseOdometerKm(text: string, ld?: Record<string, unknown>): number | undefined {
  const desc = str(ld?.description);
  const fromDesc = desc ? extractMileageFromText(desc) : undefined;
  if (fromDesc != null && fromDesc > 1) return fromDesc;
  const m =
    text.match(/Одометр\s*([\d\s\u00a0]+)\s*км/i) ||
    text.match(/Пробег[^0-9]{0,40}([\d\s\u00a0]+)\s*км/i);
  if (m?.[1]) {
    const n = Number(m[1].replace(/[\s\u00a0]/g, ""));
    if (Number.isFinite(n) && n > 1) return n;
  }
  return extractMileageFromText(text);
}

export function parseAutopartnerDetail(html: string, pageUrl: string): NormalizedListing {
  const vin =
    extractAutopartnerVin(pageUrl) ||
    normalizeKrVin(findVinInListing(html) ?? undefined) ||
    normalizeKrVin(html.match(VIN_RE)?.[1]);
  if (!vin) {
    return {
      sourceId: "ap-unknown",
      sourceUrl: pageUrl,
      title: "Unknown",
      vehicle: vehicleFromParts({}),
      photos: [],
    };
  }

  const ld = parseJsonLdVehicle(html);
  const text = plainText(html);
  const specs = extractAutopartnerSpecMap(html);
  const photos = collectAutopartnerPhotos(html, vin);
  const primaryPhoto = photos[0]?.sourceUrl;
  const platform = platformOf(text, primaryPhoto);
  const lotId = parseLotId(text, primaryPhoto);
  const country = originCountry(text, platform);
  const year =
    Number(ld?.modelDate) ||
    Number(specs.year?.match(/\d{4}/)?.[0]) ||
    Number(fieldAfter(text, ["Год выпуска"])?.match(/\d{4}/)?.[0]) ||
    undefined;
  const make =
    str((ld?.brand as { name?: string } | undefined)?.name) ||
    specs.make ||
    fieldAfter(text, ["Марка"]) ||
    undefined;
  const model = str(ld?.model) || specs.model || fieldAfter(text, ["Модель"]) || undefined;
  const color = normalizeRuColor(str(ld?.color) || specs.color || fieldAfter(text, ["Цвет"]));
  const fuel = normalizeRuFuel(specs.fuel || fieldAfter(text, ["Топливо"]));
  const transmission = normalizeRuTransmission(
    specs.transmission || fieldAfter(text, ["Трансмиссия", "Коробка"]),
  );
  const drive = normalizeRuDrive(specs.drive || fieldAfter(text, ["Привод"]));
  const engine = specs.engine || fieldAfter(text, ["Двигатель"]) || undefined;
  const bodyType = normalizeRuBody(specs.body);
  const mileage = parseOdometerKm(text, ld);
  const title =
    str(ld?.name) ||
    [year, make, model].filter(Boolean).join(" ") ||
    `VIN ${vin}`;

  const sold = /продано|sold\b|архив/i.test(text.slice(0, 2000)) && !/не назначена/i.test(text);
  const auctionAt = parseAutopartnerAuctionDate(text);
  const events: NormalizedEvent[] = [];
  if (platform && auctionAt) {
    events.push({
      eventType: "other",
      description: `Auction platform: ${platform}`,
      occurredAt: auctionAt,
      metadata: { source: "autopartner", field: "platform", value: platform },
    });
  }
  const damageRaw = specs.damage || fieldAfter(text, ["Основные повреждения", "Повреждения"]);
  const damage =
    damageRaw && damageRaw.length < 80 && !/[А-Яа-яЁё]{3,}/.test(damageRaw)
      ? damageRaw
      : damageRaw && damageRaw.length < 80
        ? damageRaw
            .replace(/передн(?:ий|яя|ее)?/gi, "Front")
            .replace(/задн(?:ий|яя|ее)?/gi, "Rear")
            .replace(/боков(?:ой|ая|ое)?/gi, "Side")
            .replace(/всесторон/gi, "All over")
            .replace(/неизвестно/gi, "Unknown")
        : undefined;
  if (damage && damage.length < 80 && auctionAt) {
    events.push({
      eventType: "accident",
      description: `Primary damage: ${damage}`,
      occurredAt: auctionAt,
      metadata: { source: "autopartner", field: "primary_damage", value: damage },
    });
  }

  const locRaw = specs.location || fieldAfter(text, ["Местоположение", "Текущее местонахождение лота"]);
  const location =
    locRaw && !/[А-Яа-яЁё]/.test(locRaw) ? locRaw : country;

  return {
    sourceId: lotId ? `ap-${lotId}` : `ap-${vin}`,
    sourceUrl: autopartnerDetailUrl(vin),
    title,
    mileage: mileage ?? undefined,
    mileageUnit: "km",
    location,
    country,
    isActive: !sold,
    listingStatus: sold ? "sold" : "active",
    soldAt: sold ? auctionAt : undefined,
    sourceListedAt: auctionAt,
    sourceModifiedAt: auctionAt,
    events: events.length ? events : undefined,
    vehicle: vehicleFromParts({
      vin,
      make,
      model,
      year: Number.isFinite(year) ? year : undefined,
      color,
      fuelType: fuel,
      transmission,
      driveType: drive,
      bodyType,
      engineDisplacement: engine,
      country,
    }),
    photos,
  };
}

/** `Дата аукциона 28.09.2026 16:00` / `28.09.2026 14:00` (Europe/Minsk ≈ UTC+3). */
export function parseAutopartnerAuctionDate(text: string): Date | undefined {
  const m =
    text.match(
      /(?:Дата\s+аукциона|Auction\s+date)\s*(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/i,
    ) || text.match(/\b(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})\b/);
  if (!m) return undefined;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  const hh = m[4] != null ? Number(m[4]) : 12;
  const mm = m[5] != null ? Number(m[5]) : 0;
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  // Treat wall clock as UTC+3 (BY) → store UTC.
  const utc = Date.UTC(year, month - 1, day, hh - 3, mm, 0);
  const d = new Date(utc);
  return Number.isNaN(d.getTime()) ? undefined : d;
}
