import { load, type CheerioAPI } from "cheerio";
import type { NormalizedEvent, NormalizedListing, NormalizedPhoto } from "@workspace/providers";
import { UNITED_ARAB_EMIRATES } from "../geo";
import { parseKm, parseMoney, parseYear, vehicleFromParts } from "./kr-common";
import { CANADA, USA, normalizeVin } from "./us-common";

export const BIDCARS_PARSER_VERSION = "bidcars-v1.0.0";
export const BIDCARS_WEB_BASE = "https://bid.cars";

const UK = "United Kingdom";
const GERMANY = "Germany";
const SPAIN = "Spain";
const FINLAND = "Finland";
const IRELAND = "Ireland";

const US_STATES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA",
  "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC", "SD", "TN", "TX", "UT", "VT",
  "VA", "WA", "WV", "WI", "WY", "DC",
]);
const CA_PROVINCES = new Set(["AB", "BC", "MB", "NB", "NL", "NS", "NT", "NU", "ON", "PE", "QC", "SK", "YT"]);

const PHOTO_HOST = /mercury\.bid\.cars|pluto\.bid\.cars|vis\.iaai\.com/i;
const PHOTO_SKIP = /logo|favicon|sprite|icon-|placeholder|apple-pay|google-pay|mastercard|visa/i;
const HIDDEN_PRICE = /hidden|\*{3,}|—|n\/a|not\s*available/i;

export function bidcarsDetailUrl(lotOrUrl: string): string {
  if (lotOrUrl.startsWith("http")) return lotOrUrl;
  const cleaned = lotOrUrl.replace(/^\/+/, "");
  if (cleaned.startsWith("en/lot/") || cleaned.startsWith("lot/")) {
    return `${BIDCARS_WEB_BASE}/${cleaned.startsWith("en/") ? cleaned : `en/${cleaned}`}`;
  }
  return `${BIDCARS_WEB_BASE}/en/lot/${cleaned}`;
}

export function extractBidcarsLotUrl(href: string): string | undefined {
  const m = href.match(/\/(?:en|pl|ru|ua)\/lot\/(\d+-\d+)(?:\/([^"'?#\s]+))?/i);
  if (!m?.[1]) return undefined;
  const lot = m[1];
  const slug = m[2] ? decodeURIComponent(m[2]).replace(/\/+$/, "") : "";
  return slug ? `${BIDCARS_WEB_BASE}/en/lot/${lot}/${slug}` : `${BIDCARS_WEB_BASE}/en/lot/${lot}`;
}

export function extractBidcarsLotId(url: string): string | undefined {
  return url.match(/\/lot\/(\d+-\d+)/i)?.[1];
}

export function extractBidcarsLotRefs(html: string): Array<{ sourceId: string; url: string }> {
  const seen = new Set<string>();
  const listings: Array<{ sourceId: string; url: string }> = [];
  for (const m of html.matchAll(/\/(?:en|pl|ru|ua)\/lot\/(\d+-\d+)(?:\/([^"'?#\s]+))?/gi)) {
    const url = extractBidcarsLotUrl(m[0]!);
    const sourceId = m[1];
    if (!url || !sourceId || seen.has(sourceId)) continue;
    seen.add(sourceId);
    listings.push({ sourceId, url });
  }
  return listings;
}

export function parseBidcarsDetail(html: string, pageUrl: string): NormalizedListing {
  const $ = load(html);
  const json = vehicleJsonLd($);
  const lotId = extractBidcarsLotId(pageUrl) || extractBidcarsLotId(ogUrl($) ?? "") || option($, "Lot");
  const vin =
    normalizeVin($("h1.vin_lot, h1.copy-vin, span.vin-drop").first().text()) ||
    normalizeVin(json?.vehicleIdentificationNumber) ||
    normalizeVin(option($, "VIN")) ||
    normalizeVin(pageUrl.match(/([A-HJ-NPR-Z0-9]{17})(?:\/?$|[?#])/i)?.[1]);
  const rawTitle =
    $("h2.title_lot").first().text().replace(/\s+/g, " ").trim() ||
    json?.name ||
    ($('meta[property="og:title"]').attr("content") ?? "").replace(/\s*\|\s*.*$/, "").trim();
  const title = cleanTitle(rawTitle, vin);
  const make = option($, "Make") || json?.brand?.name || json?.manufacturer?.name || titleMake(title);
  const model = option($, "Model") || json?.model || titleModel(title, make);
  const trim = emptyDash(option($, "Series") || option($, "Trim")) || titleTrim(title);
  const year = parseYear(option($, "Year") || json?.modelDate || json?.vehicleModelDate || title);
  const location = locationOf($) || json?.availableAtOrFrom?.name;
  const country = countryFromLocation(location, html);
  const odometerRaw = option($, "Odometer") || String(json?.mileageFromOdometer?.value ?? "");
  const mileage = parseKm(odometerRaw);
  const mileageUnit = /km|kilomet/i.test(odometerRaw) && !/\bmi\b/i.test(odometerRaw) ? "km" : "mi";
  const priceInfo = parseBidPrice(
    salesPrice($, lotId) ||
      $("#bidding-info .price.current_bid, .lot-price-info .price.current_bid, span.status.price")
        .first()
        .text() ||
      option($, "Final bid") ||
      option($, "Current bid"),
  );
  const saleDate = parseSaleDate(salesDate($, lotId) || auctionDateText($));
  const auctionHouse = classifyAuctionHouse(lotId, html);
  const status = listingStatus($, html, priceInfo.amount);
  const sold = status === "sold";
  const primary = emptyDash(option($, "Primary damage") || option($, "Primary Damage"));
  const secondary = emptyDash(option($, "Secondary damage") || option($, "Secondary Damage"));
  const photos = collectPhotos($);
  const currency = priceInfo.currency ?? currencyForCountry(country);
  const events = buildEvents({
    saleDate,
    price: priceInfo.amount,
    currency,
    primary,
    secondary,
    lotId,
    auctionHouse,
    sold,
  });

  return {
    sourceId: lotId || vin || "unknown",
    sourceUrl: extractBidcarsLotUrl(pageUrl) ?? pageUrl,
    title: title || [make, model, trim, year].filter(Boolean).join(" "),
    priceAmount: priceInfo.amount,
    priceCurrency: currency,
    mileage: mileage != null && mileage >= 0 ? mileage : undefined,
    mileageUnit,
    location: location || country,
    country,
    isActive: status === "active",
    listingStatus: status,
    soldAt: sold ? saleDate : undefined,
    accidentCount: damageLooksLikeAccident(primary) ? 1 : undefined,
    events,
    vehicle: vehicleFromParts({
      vin,
      make,
      model,
      trim,
      year,
      fuelType: option($, "Fuel Type") || option($, "Fuel") || json?.fuelType,
      transmission: option($, "Transmission") || json?.vehicleTransmission,
      bodyType: option($, "Body Style") || option($, "Body"),
      driveType: option($, "Drive Type") || option($, "Drive Line Type") || json?.driveWheelConfiguration,
      engineDisplacement: option($, "Engine") || json?.vehicleEngine?.name || json?.vehicleEngine?.engineType,
      color: option($, "Exterior color") || option($, "Exterior") || json?.color,
      country,
    }),
    photos,
  };
}

export function classifyAuctionHouse(lotId: string | undefined, html: string): "copart" | "iaa" {
  if (/\biaai?\b/i.test(html) && !/\bcopart\b/i.test(html.slice(0, 4_000))) return "iaa";
  if (/Data fetched from the platform\s+IAA/i.test(html) || /\bauction["']?\s*[:=]\s*["']iaa/i.test(html)) {
    return "iaa";
  }
  if (lotId?.startsWith("0-")) return "iaa";
  return "copart";
}

export function iaaLotNumber(lotId?: string): string | undefined {
  if (!lotId?.startsWith("0-")) return undefined;
  return lotId.slice(2).replace(/\D/g, "") || undefined;
}

function vehicleJsonLd($: CheerioAPI): any | undefined {
  let found: any;
  $('script[type="application/ld+json"]').each((_, el) => {
    if (found) return;
    try {
      const data = JSON.parse($(el).text());
      const list = Array.isArray(data) ? data : [data];
      for (const item of list) {
        if (item?.vehicleIdentificationNumber || String(item?.["@type"] ?? "").includes("Vehicle")) {
          found = item;
          return;
        }
      }
    } catch {
      /* ignore */
    }
  });
  return found;
}

function ogUrl($: CheerioAPI): string | undefined {
  return $('meta[property="og:url"]').attr("content")?.trim();
}

function option($: CheerioAPI, label: string): string | undefined {
  const want = label.toLowerCase();
  let found = "";
  $("div.option").each((_, el) => {
    const node = $(el);
    const labelText = node.clone().children().remove().end().text().replace(/\s+/g, " ").trim().toLowerCase();
    const full = node.text().replace(/\s+/g, " ").trim().toLowerCase();
    if (labelText !== want && !full.startsWith(want)) return;
    found = node.find("span.right-info").first().text().replace(/\s+/g, " ").trim();
    return false;
  });
  return emptyDash(found);
}

function locationOf($: CheerioAPI): string | undefined {
  const li = $("ul.lot-info li.location").first().text().replace(/\s+/g, " ").trim();
  if (li) return li.replace(/^Location:\s*/i, "").trim() || undefined;
  return option($, "Location");
}

function auctionDateText($: CheerioAPI): string | undefined {
  const frame = $("div.time-frame").first().text().replace(/\s+/g, " ").trim();
  const m = frame.match(/(\w+,\s+\w+\s+\d{1,2},\s+\d{4})/);
  return m?.[1] || emptyDash(option($, "Auction date") || option($, "Sale date"));
}

function salesDate($: CheerioAPI, lotId?: string): string | undefined {
  const row = salesRow($, lotId);
  if (!row) return undefined;
  const cells = row.find("td");
  for (let i = 0; i < cells.length; i++) {
    const text = cells.eq(i).text().replace(/\s+/g, " ").trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(text) || /^\w+,\s+\w+\s+\d{1,2},\s+\d{4}/.test(text)) return text;
  }
  return undefined;
}

function salesPrice($: CheerioAPI, lotId?: string): string | undefined {
  const row = salesRow($, lotId);
  if (!row) return undefined;
  const priced = row.find("span.status.price, span.price").first().text().trim();
  if (priced) return priced;
  return row.find("td").toArray().map((el) => $(el).text()).find((t) => /[$£€]|USD|GBP|EUR|AED|CAD/.test(t));
}

function salesRow($: CheerioAPI, lotId?: string) {
  const rows = $("table.sales-history-table tr").toArray().slice(1);
  if (rows.length === 0) return undefined;
  if (lotId) {
    const match = rows.find((el) => $(el).text().includes(lotId));
    if (match) return $(match);
  }
  return $(rows[rows.length - 1]!);
}

function listingStatus($: CheerioAPI, html: string, price?: number): "active" | "sold" | "inactive" {
  const blob = `${$("table.sales-history-table").text()}\n${$("#archieved-message, #archived-message, .item-time").text()}\n${html.slice(0, 12_000)}`;
  if (/\bnot[\s_-]*sold\b/i.test(blob)) return "inactive";
  const live = $("div.box.live_auction_sec span.indicator");
  if (live.hasClass("green")) return "active";
  if (/\bsold\b/i.test(blob) || price) return "sold";
  if (/archived|finished|auction ended/i.test(blob) || $("#archieved-message, #archived-message").length) {
    return "sold";
  }
  return "active";
}

function collectPhotos($: CheerioAPI): NormalizedPhoto[] {
  const seen = new Set<string>();
  const photos: NormalizedPhoto[] = [];
  const add = (raw?: string | null) => {
    const src = absolutizePhoto(raw);
    if (!src || PHOTO_SKIP.test(src) || !PHOTO_HOST.test(src) || seen.has(src)) return;
    seen.add(src);
    photos.push({ sourceUrl: src, isPrimary: photos.length === 0, sortOrder: photos.length });
  };
  $("div.f-carousel__slide").each((_, el) => add($(el).attr("data-src")));
  $("img").each((_, el) => {
    add($(el).attr("src") || $(el).attr("data-src") || $(el).attr("data-original"));
  });
  return photos.slice(0, 40);
}

function absolutizePhoto(raw?: string | null): string | undefined {
  const src = String(raw ?? "").trim();
  if (!src || src.startsWith("data:")) return undefined;
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith("//")) return `https:${src}`;
  return undefined;
}

function parseBidPrice(raw?: string): { amount?: number; currency?: string } {
  const text = String(raw ?? "").replace(/\s+/g, " ").trim();
  if (!text || HIDDEN_PRICE.test(text)) return {};
  const amount = parseMoney(text);
  if (!amount) return {};
  if (/€|EUR/i.test(text)) return { amount, currency: "EUR" };
  if (/£|GBP/i.test(text)) return { amount, currency: "GBP" };
  if (/AED/i.test(text)) return { amount, currency: "AED" };
  if (/CAD/i.test(text)) return { amount, currency: "CAD" };
  if (/\$|USD/i.test(text)) return { amount, currency: "USD" };
  return { amount };
}

function currencyForCountry(country: string): string {
  if (country === UK) return "GBP";
  if (country === GERMANY || country === SPAIN || country === FINLAND || country === IRELAND) return "EUR";
  if (country === UNITED_ARAB_EMIRATES) return "AED";
  if (country === CANADA) return "CAD";
  return "USD";
}

export function countryFromLocation(location?: string, html = ""): string {
  const blob = `${location ?? ""}\n${html.slice(0, 20_000)}`;
  if (/united arab emirates|\bUAE\b|copartmea|abu dhabi|sharjah|\bdubai\b/i.test(blob)) {
    return UNITED_ARAB_EMIRATES;
  }
  if (/united kingdom|\bUK\b|great britain|copart\.co\.uk|england|scotland|wales/i.test(blob)) return UK;
  if (/germany|deutschland|copart\.de/i.test(blob)) return GERMANY;
  if (/spain|españa|copart\.es/i.test(blob)) return SPAIN;
  if (/finland|suomi|copart\.fi/i.test(blob)) return FINLAND;
  if (/ireland|copart\.ie/i.test(blob)) return IRELAND;
  if (/canada|copart\.ca/i.test(blob)) return CANADA;
  const code = (location ?? "").match(/\(([A-Z]{2})\)/)?.[1];
  if (code === "CA") return USA;
  if (code && CA_PROVINCES.has(code) && !US_STATES.has(code)) return CANADA;
  if (code && US_STATES.has(code)) return USA;
  return USA;
}

function cleanTitle(raw: string, vin?: string): string {
  let title = raw.replace(/\s+/g, " ").trim();
  if (vin) title = title.replace(new RegExp(vin, "ig"), "");
  title = title.replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, "");
  title = title.replace(/\s*\|\s*Bid.*$/i, "");
  return title.replace(/\s{2,}/g, " ").replace(/[,\s]+$/g, "").trim();
}

function titleMake(title?: string): string | undefined {
  const parts = String(title ?? "").split(",")[0]?.trim().split(/\s+/) ?? [];
  if (parts.length >= 2 && /^(19|20)\d{2}$/.test(parts[0]!)) {
    if (/mercedes/i.test(parts[1]!) && parts[2]) return `${parts[1]} ${parts[2]}`;
    return parts[1];
  }
  return undefined;
}

function titleModel(title?: string, make?: string): string | undefined {
  const head = String(title ?? "").split(",")[0]?.trim() ?? "";
  const year = head.match(/^(19|20)\d{2}\s+/)?.[0];
  if (!year) return undefined;
  let rest = head.slice(year.length).trim();
  if (make) rest = rest.replace(new RegExp(`^${escapeRegExp(make)}\\s+`, "i"), "");
  return rest.trim() || undefined;
}

function titleTrim(title?: string): string | undefined {
  const t = String(title ?? "");
  if (!t.includes(",")) return undefined;
  return t.split(",").slice(1).join(",").trim() || undefined;
}

function emptyDash(value?: string | null): string | undefined {
  const t = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!t || t === "-" || /^n\/a$/i.test(t)) return undefined;
  return t;
}

function parseSaleDate(raw?: string): Date | undefined {
  if (!raw) return undefined;
  const iso = raw.match(/(\d{4}-\d{2}-\d{2})/)?.[1];
  if (iso) return new Date(`${iso}T12:00:00Z`);
  const named = raw.match(/(\w+),\s+(\w+)\s+(\d{1,2}),\s+(\d{4})/);
  if (named) {
    const d = Date.parse(`${named[2]} ${named[3]}, ${named[4]} UTC`);
    return Number.isFinite(d) ? new Date(d) : undefined;
  }
  const d = Date.parse(raw);
  return Number.isFinite(d) ? new Date(d) : undefined;
}

function damageLooksLikeAccident(raw?: string): boolean {
  const t = String(raw ?? "").trim();
  if (!t) return false;
  return !/^(none|no damage|undisclosed|-|n\/a|unknown)$/i.test(t);
}

function buildEvents(input: {
  saleDate?: Date;
  price?: number;
  currency: string;
  primary?: string;
  secondary?: string;
  lotId?: string;
  auctionHouse: "copart" | "iaa";
  sold: boolean;
}): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  if (input.sold && input.saleDate) {
    events.push({
      eventType: "sale",
      description: input.price
        ? `Sold for ${input.price.toLocaleString("en-US")} ${input.currency}`
        : "Sold",
      occurredAt: input.saleDate,
      metadata: {
        source: "bidcars",
        field: "sale",
        soldDate: input.saleDate.toISOString().slice(0, 10),
        priceAmount: input.price,
        priceCurrency: input.currency,
        sourceListingId: input.lotId,
        provider: "bidcars",
        auctionHouse: input.auctionHouse,
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
      metadata: { source: "bidcars", auctionHouse: input.auctionHouse },
    });
  }
  return events;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
