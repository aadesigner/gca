import { load, type CheerioAPI } from "cheerio";
import type { NormalizedEvent, NormalizedListing, NormalizedPhoto } from "@workspace/providers";
import { parseKm, parseMoney, parseYear, vehicleFromParts } from "./kr-common";
import { normalizeVin, USA, CANADA } from "./us-common";
import { UNITED_KINGDOM } from "../geo";
import { parseTitleState, textIndicatesSalvage } from "../salvage-title";

export const BIDSCAN_PARSER_VERSION = "bidscan-v1.1.1";
export const BIDSCAN_WEB_BASE = "https://bidscan.vin";
export const IAA_VIS_CDN = "https://vis.iaai.com/resizer";

const PHOTO_SKIP =
  /logo|favicon|apple-pay|google-pay|mastercard|visa|icon-|sprite|flag|langs\//i;

export function bidscanListingName(input: {
  raw?: string;
  make?: string;
  model?: string;
  year?: number;
}): { title?: string; trim?: string } {
  let raw = String(input.raw ?? "").replace(/\s+/g, " ").trim();
  raw = raw.replace(/[-–—]\s*Auto history.*$/i, "");
  raw = raw.replace(/,?\s*VIN\s*:\s*[A-HJ-NPR-Z0-9]{11,17}/gi, "");
  raw = raw.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/gi, "");
  raw = raw.replace(/\b(\d{4})\s+\1\b/g, "$1");
  raw = raw.replace(/\bVIN\b:?/gi, "");
  raw = raw.replace(/[,\s]+$/g, "").replace(/\s+/g, " ").trim();

  const make = input.make?.replace(/\s+/g, " ").trim();
  const model = input.model?.replace(/\s+/g, " ").trim();
  const year = input.year;

  let rest = raw;
  if (year) rest = rest.replace(new RegExp(`\\b${year}\\b`, "g"), " ");
  if (make) rest = rest.replace(new RegExp(`\\b${escapeRegExp(make)}\\b`, "gi"), " ");
  if (model) rest = rest.replace(new RegExp(`\\b${escapeRegExp(model)}\\b`, "gi"), " ");
  rest = rest.replace(/\s+/g, " ").trim();

  const title = [make, model, rest || undefined, year != null ? String(year) : undefined]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return { title: title || rest || undefined, trim: rest || undefined };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isScrapedSeoTrim(value?: string | null): boolean {
  const t = String(value ?? "");
  return /VIN\s*:/i.test(t) || /Auto history/i.test(t) || /\b[A-HJ-NPR-Z0-9]{17}\b/.test(t);
}

export function extractBidscanVinUrl(href: string): string | undefined {
  const m = href.match(/\/cars\/([A-HJ-NPR-Z0-9]{17})/i);
  if (!m?.[1]) return undefined;
  const vin = normalizeVin(m[1]);
  return vin ? `${BIDSCAN_WEB_BASE}/cars/${vin}` : undefined;
}

export function parseBidscanDetail(html: string, pageUrl: string): NormalizedListing {
  const $ = load(html);
  const json = vehicleJsonLd($);
  const vin =
    normalizeVin(json?.vehicleIdentificationNumber) ||
    labeled($, "VIN") ||
    normalizeVin($('meta[name="vin"]').attr("content")) ||
    normalizeVin(pageUrl.match(/\/cars\/([A-HJ-NPR-Z0-9]{17})/i)?.[1]);
  const lot = String(json?.sku ?? labeled($, "Lot number") ?? $('meta[name="lot"]').attr("content") ?? "").replace(
    /\D/g,
    "",
  );
  const auction = (labeled($, "Auction") || jsonSeller(json) || "").toUpperCase();
  const origin = classifyAuction(auction, html);
  const make = labeled($, "Make") || json?.brand?.name || json?.manufacturer?.name;
  const model = labeled($, "Model") || json?.model;
  const year = parseYear(labeled($, "Year") || json?.modelDate || json?.vehicleModelDate || $("h1").first().text());
  const rawTitle = $("h1").first().text().replace(/\s+/g, " ").trim() || json?.name;
  const named = bidscanListingName({ raw: rawTitle, make, model, year });
  const mileage =
    Number(json?.mileageFromOdometer?.value) ||
    parseKm(labeled($, "Odometer") || $("body").text().match(/Odometer:\s*([\d,]+)/i)?.[1]);
  const price =
    parseMoney(String(json?.offers?.price ?? "")) ||
    parseMoney(labeled($, "Final offer") || labeled($, "Final Bid"));
  const saleDate = parseSaleDate(labeled($, "Sale date"));
  const location = labeled($, "Location") || json?.availableAtOrFrom?.name;
  const primary = labeled($, "Primary Damage") || extraProp(json, "Primary Damage");
  const secondary = labeled($, "Secondary Damage") || extraProp(json, "Secondary Damage");
  const condition = textAfterLabel($, "Condition") || "";
  const titleType =
    labeled($, "Title Type") ||
    labeled($, "Title") ||
    labeled($, "Vehicle title") ||
    extraProp(json, "Title Type");
  const events = buildEvents({
    saleDate,
    price,
    primary,
    secondary,
    condition,
    titleType,
    sourceId: vin ?? (lot ? `bs-${lot}` : undefined),
    provider: origin,
  });
  const photos = collectCarPhotos($, json);
  const sold = /sold/i.test(labeled($, "Status") || "") || json?.offers?.availability?.includes("SoldOut");
  const listing: NormalizedListing = {
    sourceId: vin ?? (lot ? `bs-${lot}` : "unknown"),
    sourceUrl: vin ? `${BIDSCAN_WEB_BASE}/cars/${vin}` : pageUrl,
    title: named.title,
    priceAmount: price,
    priceCurrency: "USD",
    mileage: mileage && mileage > 0 ? mileage : undefined,
    mileageUnit: "mi",
    location: location || USA,
    country: countryFromLocation(location),
    isActive: !sold,
    listingStatus: sold ? "sold" : "active",
    soldAt: sold ? saleDate : undefined,
    accidentCount: damageLooksLikeAccident(primary) ? 1 : undefined,
    events,
    vehicle: vehicleFromParts({
      vin,
      make,
      model,
      trim: named.trim,
      year,
      fuelType: labeled($, "Fuel Type") || json?.fuelType,
      transmission: labeled($, "Transmission") || json?.vehicleTransmission,
      color: labeled($, "Color") || json?.color,
      engineDisplacement: labeled($, "Engine") || json?.vehicleEngine?.name,
      driveType: labeled($, "Drive") || json?.driveWheelConfiguration,
      country: countryFromLocation(location),
    }),
    photos,
    targetProvider: origin,
  };
  return listing;
}

export function classifyAuction(auction: string, html: string): "copart" | "iaa" {
  if (/\biaai\b/i.test(auction)) return "iaa";
  if (/\bcopart\b/i.test(auction)) return "copart";
  const head = html.slice(0, 8_000);
  if (/Auction:\s*iaai/i.test(head) || /"name":\s*"IAAI"/i.test(head)) return "iaa";
  return "copart";
}

function vehicleJsonLd($: CheerioAPI): any | undefined {
  let found: any;
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const data = JSON.parse($(el).text());
      const list = Array.isArray(data) ? data : [data];
      for (const item of list) {
        if (item?.vehicleIdentificationNumber || item?.["@type"]?.includes?.("Vehicle")) {
          found = item;
          return false;
        }
      }
    } catch {
      /* ignore */
    }
  });
  return found;
}

function jsonSeller(json: any): string {
  return json?.offers?.seller?.name ?? "";
}

function extraProp(json: any, name: string): string {
  const props = json?.additionalProperty;
  if (!Array.isArray(props)) return "";
  const hit = props.find((p) => String(p?.name ?? "").toLowerCase() === name.toLowerCase());
  return String(hit?.value ?? "").trim();
}

function labeled($: CheerioAPI, label: string): string {
  const want = label.toLowerCase();
  let found = "";
  $("dt").each((_, el) => {
    if ($(el).text().replace(/\s+/g, " ").trim().toLowerCase() !== want) return;
    found = $(el).next("dd").text().replace(/\s+/g, " ").trim();
    return false;
  });
  return found === "-" ? "" : found;
}

function textAfterLabel($: CheerioAPI, label: string): string {
  const want = label.toLowerCase();
  let found = "";
  $("span, div").each((_, el) => {
    const t = $(el).text().replace(/\s+/g, " ").trim();
    if (t.toLowerCase() !== want) return;
    found = $(el).next().text().replace(/\s+/g, " ").trim();
    return false;
  });
  return found;
}

export function extractBidscanLot(html: string): string {
  const $ = load(html);
  return String(labeled($, "Lot number") || $('meta[name="lot"]').attr("content") || "").replace(/\D/g, "");
}

export function iaaVisPhotoUrl(lot: string, index: number, width = 845): string {
  return `${IAA_VIS_CDN}?imageKeys=${lot}~SID~S0~I${index}&width=${width}`;
}

function collectCarPhotos($: CheerioAPI, json?: any): NormalizedPhoto[] {
  const seen = new Set<string>();
  const photos: NormalizedPhoto[] = [];
  const add = (raw: string) => {
    const src = absolutizePhoto(raw);
    if (!src) return;
    if (PHOTO_SKIP.test(src)) return;
    if (/bidscan\.vin\/images\//i.test(src)) return;
    if (!/copart|iaai|vis\.iaai|lotimage|amazonaws|cloudfront|bidscan|vehimg/i.test(src)) return;
    if (seen.has(src)) return;
    seen.add(src);
    photos.push({ sourceUrl: src, isPrimary: photos.length === 0, sortOrder: photos.length });
  };
  for (const raw of jsonImageUrls(json)) add(raw);
  $("img").each((_, el) => {
    add($(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-original") || "");
  });
  return photos;
}

function jsonImageUrls(json: any): string[] {
  const raw = json?.image;
  if (typeof raw === "string") return [raw];
  if (Array.isArray(raw)) return raw.map((item) => (typeof item === "string" ? item : String(item?.url ?? "")));
  return [];
}

function absolutizePhoto(raw: string): string | undefined {
  const src = raw.trim();
  if (!src || src.startsWith("data:")) return undefined;
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith("//")) return `https:${src}`;
  if (src.startsWith("/")) return `${BIDSCAN_WEB_BASE}${src}`;
  return undefined;
}

function buildEvents(input: {
  saleDate?: Date;
  price?: number;
  primary: string;
  secondary: string;
  condition: string;
  titleType?: string;
  sourceId?: string;
  provider: "copart" | "iaa";
}): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const when = input.saleDate;
  if (input.saleDate && when) {
    events.push({
      eventType: "sale",
      description: input.price ? `Sold for $${input.price.toLocaleString("en-US")} USD` : "Sold",
      occurredAt: when,
      metadata: {
        source: "bidscan",
        field: "sale",
        soldDate: when.toISOString().slice(0, 10),
        priceAmount: input.price,
        priceCurrency: "USD",
        sourceListingId: input.sourceId,
        provider: input.provider,
      },
    });
  }
  const damage = [input.primary, input.secondary].filter(Boolean).join(" / ");
  if (damageLooksLikeAccident(input.primary) || damageLooksLikeAccident(input.secondary)) {
    const flood = /flood|water/i.test(damage);
    events.push({
      eventType: flood ? "flood_damage" : "accident",
      description: damage,
      occurredAt: input.saleDate ?? new Date(),
      metadata: { source: "bidscan", condition: input.condition || undefined },
    });
  }
  const titleText = input.titleType?.trim();
  if (titleText && !/^(n\/a|none|-|unknown)$/i.test(titleText)) {
    // BidScan often stores only a 2-letter state as Title Type ("SC") — keep it, but only
    // mark salvage when the text actually says so (not because "SC" looks special).
    const salvage = textIndicatesSalvage(titleText);
    events.push({
      eventType: "title_status",
      description: `Title type: ${titleText}`,
      occurredAt: input.saleDate ?? new Date(),
      metadata: {
        source: "bidscan",
        field: "title_type",
        value: titleText,
        salvage,
        state: parseTitleState(titleText) || (/^[A-Za-z]{2}$/.test(titleText) ? titleText.toUpperCase() : undefined),
        region: "US",
        usCanada: true,
      },
    });
  }
  return events;
}

function damageLooksLikeAccident(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  return !/^(none|no damage|undisclosed|-|n\/a|unknown)$/i.test(t);
}

function parseSaleDate(raw?: string): Date | undefined {
  if (!raw) return undefined;
  const d = Date.parse(raw);
  return Number.isFinite(d) ? new Date(d) : undefined;
}

function countryFromLocation(location?: string): string {
  if (/canada/i.test(location ?? "")) return CANADA;
  if (/\bUK\b|united kingdom|great britain/i.test(location ?? "")) return UNITED_KINGDOM;
  return USA;
}
