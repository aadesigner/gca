import { load, type CheerioAPI } from "cheerio";
import type { NormalizedEvent, NormalizedListing, NormalizedPhoto } from "@workspace/providers";
import { findVinInListing, normalizeKrVin, parseKm, parseMoney, parseYear, vehicleFromParts } from "./kr-common";
import { photoIdentityKey } from "./web-html";
import { expandIaaiSpinPhotos, extractIaaiSpinStockId } from "./iaai-spin";
import { CANADA, SOUTH_KOREA, UNITED_STATES, canonicalCountry } from "../geo";
import {
  isUsOrCanadaContext,
  parseTitleState,
  textIndicatesSalvage,
} from "../salvage-title";

export const IMPORT_MOTOR_PARSER_VERSION = "import-motor-v1.6.0";
export const IMPORT_MOTOR_WEB_BASE = "https://import-motor.com";

const FULL_HISTORY_TITLES =
  /owner change|insurance processing|car inspection completed|maintenance\/repair history|recall|change registration/i;

const PHOTO_HOST_OK =
  /(?:^|\.)(?:cars2?\.import-motor\.com|ci\.encar\.com|img\.encar\.com|encar\.com|cs\.copart\.com|copart\.com|vis\.iaai\.com|mediaretriever\.iaai\.com|iaai\.com|auctioninsider|cloudfront\.net)/i;

const PHOTO_PATH_OK = /import-motor\.com\/(?:encar|copart|iaa)\//i;

const PHOTO_NOISE =
  /logo|favicon|langs\/|flag|\/images\/360\.png|sprite|icon|avatar|placeholder|emoji|badge\.svg|\/svg\//i;

const EXCLUDED_RELATED_CONTAINERS =
  '[class*="similar"],[class*="related"],[class*="recommend"],[class*="other-lot"],[class*="also-like"],[class*="more-cars"],[class*="other-cars"]';

export type ImportMotorOrigin = "encar" | "autowini" | "iaa" | "copart";

const KR_ORIGINS: ReadonlySet<ImportMotorOrigin> = new Set(["encar", "autowini"]);

export function isKoreanImportMotorOrigin(origin: string | undefined | null): boolean {
  return Boolean(origin && KR_ORIGINS.has(origin as ImportMotorOrigin));
}

/** Cheap origin guess from list-card HTML near a VIN (undefined = must fetch detail). */
export function guessImportMotorOriginFromSnippet(snippet: string): ImportMotorOrigin | undefined {
  const blob = snippet.slice(0, 8_000);
  if (/cs\.copart\.com|\bcopart\.com\b|USA auction\s*C\b/i.test(blob)) return "copart";
  if (/vis\.iaai\.com|mediaretriever\.iaai\.com|\biaai\.com\b|USA auction\s*I\b|\biaa\b/i.test(blob)) {
    return "iaa";
  }
  if (/autowini/i.test(blob)) return "autowini";
  if (/korean market|ci\.encar\.com|cars2?\.import-motor\.com\/encar|\bencar\.com\b|엔카/i.test(blob)) {
    return "encar";
  }
  return undefined;
}

export function normalizeImportMotorOrigins(raw: unknown): ImportMotorOrigin[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ImportMotorOrigin[] = [];
  for (const v of raw) {
    const s = String(v).trim().toLowerCase();
    if (s === "korean" || s === "korea" || s === "kr") {
      out.push("encar", "autowini");
      continue;
    }
    if (s === "encar" || s === "autowini" || s === "iaa" || s === "copart") {
      out.push(s);
    }
  }
  return out.length ? [...new Set(out)] : undefined;
}

export function originAllowed(
  origin: string | undefined | null,
  allowed: ImportMotorOrigin[] | undefined,
): boolean {
  if (!allowed?.length) return true;
  if (!origin) return true; // unknown → fetch/parse to decide
  return allowed.includes(origin as ImportMotorOrigin);
}

export function extractImportMotorVinUrl(href: string): string | undefined {
  const m = href.match(/\/v\/([A-HJ-NPR-Z0-9]{17})(?:\/[\w-]+)?/i);
  if (!m?.[1]) return undefined;
  const vin = normalizeKrVin(m[1]);
  return vin ? `${IMPORT_MOTOR_WEB_BASE}/v/${vin}` : undefined;
}

/**
 * Related-car cards pollute Buy now / photos / origin (Encar thumbs on a Copart VIN).
 * Drop them before any label extraction.
 */
function stripRelatedCars($: CheerioAPI, pageVin?: string): void {
  $(EXCLUDED_RELATED_CONTAINERS).remove();
  if (!pageVin) return;
  const vinUpper = pageVin.toUpperCase();
  $("article").each((_, el) => {
    const hrefs = $(el)
      .find('a[href*="/v/"]')
      .toArray()
      .map((a) => $(a).attr("href") || "");
    const other = hrefs.some((href) => {
      const m = href.match(/\/v\/([A-HJ-NPR-Z0-9]{17})/i);
      return Boolean(m?.[1] && m[1].toUpperCase() !== vinUpper);
    });
    if (other) $(el).remove();
  });
}

export function parseImportMotorDetail(html: string, pageUrl: string): NormalizedListing {
  const $ = load(html);
  const vinFromUrl = pageUrl.match(/\/v\/([A-HJ-NPR-Z0-9]{17})/i)?.[1]?.toUpperCase();
  // Resolve VIN before stripping so we can drop other-VIN article cards.
  const vinEarly =
    normalizeKrVin(vinFromUrl) ||
    normalizeKrVin($("h1").first().text().match(/\b([A-HJ-NPR-Z0-9]{17})\b/i)?.[1]);
  stripRelatedCars($, vinEarly);

  const vin =
    vinEarly ||
    labeled($, "Vin") ||
    textMatch($, /\bVin:\s*([A-HJ-NPR-Z0-9]{17})\b/i) ||
    findVinInListing($.root().text(), $.root().html() ?? html);
  const lot = labeled($, "Lot number") || textMatch($, /\bLot(?: number)?:\s*(\d{5,})\b/i);
  const platform =
    labeled($, "Auction platform") ||
    labeled($, "Platform") ||
    labeled($, "Auction Platform");
  const title =
    $("h1").first().text().replace(/\s+/g, " ").trim() ||
    $("title").first().text().replace(/\s+/g, " ").trim();
  const year = parseYear(labeled($, "Year of production") || labeled($, "Year of Production") || title);
  const odometerRaw = labeled($, "Odometer") || "";
  // Prefer labeled odometer; never treat bare status titles (e.g. "404") as mileage.
  const odoSource = odometerRaw || $("h1").parent().text();
  const parsedOdo = parseOdometerReading(odoSource, { allowBare: Boolean(odometerRaw) });
  const mileage = parsedOdo?.value;
  // Dual strings like "173 986 miles / 280 003 km" — unit follows the value we took (miles first).
  const mileageUnit = parsedOdo?.unit ?? "km";
  const krw = parseMoney(labeled($, "Price in Original Currency"));
  const buyNow =
    parseMoney(labeled($, "Buy now")) ||
    parseMoney(labeled($, "Buy Now"));
  const finalPrice =
    parseMoney(labeled($, "Final price")) ||
    parseMoney(labeled($, "Final Price"));
  const bidPrice =
    parseMoney(labeled($, "Current bid")) ||
    parseMoney(labeled($, "Sale price")) ||
    parseMoney(labeled($, "Sold for"));
  const location = labeled($, "Location") || labeled($, "Buyer location");
  const bodyText = $.root().text();
  const soldBanner =
    /this car was sold at auction|this car was sold\b/i.test(bodyText) ||
    /\bsold\b/i.test($("h1").parent().text()) ||
    Boolean(finalPrice && /sold|archived/i.test(platform + " " + ($("span").first().text() || "")));
  // Hero Sold/Archived chips sit next to the h1.
  const heroSold = /\bsold\b/i.test(
    $("h1")
      .closest("section")
      .find("span")
      .toArray()
      .map((el) => $(el).text())
      .join(" "),
  );
  const isSold = soldBanner || heroSold || Boolean(finalPrice && !buyNow);
  // Sold cars: Final price is authoritative. Never prefer related-card Buy now.
  const usd = isSold
    ? (finalPrice ?? bidPrice ?? buyNow)
    : (buyNow ?? finalPrice ?? bidPrice);
  const primaryDamage =
    labeled($, "Primary damage") ||
    labeled($, "Primary Damage") ||
    labeled($, "PRIMARY DAMAGE");
  // Import Motor UI label is often "Second damage" (not "Secondary").
  const secondaryDamage =
    labeled($, "Secondary damage") ||
    labeled($, "Secondary Damage") ||
    labeled($, "Second damage") ||
    labeled($, "Second Damage") ||
    labeled($, "SECOND DAMAGE") ||
    labeled($, "SECONDARY DAMAGE");
  const keys = labeled($, "Keys available") || labeled($, "Keys");
  const steering =
    labeled($, "Steering") ||
    labeled($, "Handle") ||
    labeled($, "Hand") ||
    labeled($, "Drive side") ||
    labeled($, "Steering type");
  const saleDateRaw = labeled($, "Sale date") || labeled($, "Sale Date");
  const saleAt = parseSaleDate(saleDateRaw);
  const events = extractTimelineEvents($);
  appendDamageEvents(events, { primaryDamage, secondaryDamage, keys, steering, saleAt });
  // Buy now is listing price state, not a timeline history event.
  // Origin must be known before we stamp event/sale metadata (never "import_motor").
  const origin = classifyOrigin({ html: $.root().html() ?? html, platform, events, location });
  if (finalPrice && isSold) {
    events.push({
      eventType: "sale",
      description: `Final price: $${finalPrice}`,
      occurredAt: saleAt ?? new Date(),
      metadata: {
        source: origin,
        field: "final_price",
        value: finalPrice,
        priceAmount: finalPrice,
        priceCurrency: "USD",
        amount: finalPrice,
        currency: "USD",
      },
    });
  }
  stampEventSource(events, origin);
  const vehicleTitle =
    labeled($, "Vehicle title") ||
    labeled($, "Vehicle Title") ||
    labeled($, "Title code") ||
    labeled($, "Title Code") ||
    labeled($, "Title type") ||
    labeled($, "Title Type");
  const detailedTitle = labeled($, "Detailed title") || labeled($, "Detailed Title");
  const titleStatus = labeled($, "Title status") || labeled($, "Title Status");
  const countryGuess =
    origin === "iaa" || origin === "copart"
      ? UNITED_STATES
      : isUsOrCanadaContext({ location, origin })
        ? /\bCanada\b/i.test(location ?? "")
          ? CANADA
          : UNITED_STATES
        : SOUTH_KOREA;
  appendTitleEvents(events, {
    vehicleTitle,
    detailedTitle,
    titleStatus,
    saleAt,
    country: countryGuess,
    location,
    origin,
  });
  const sourceId = `im-${lot || vin || "unknown"}`;
  const photos = vin ? collectPhotos($, $.root().html() ?? html, vin) : [];
  const listing: NormalizedListing = {
    sourceId,
    sourceUrl: extractImportMotorVinUrl(pageUrl) ?? pageUrl,
    title,
    priceAmount: origin === "encar" || origin === "autowini" ? krw ?? usd : usd ?? krw,
    priceCurrency: krw && (origin === "encar" || origin === "autowini") ? "KRW" : usd ? "USD" : krw ? "KRW" : undefined,
    mileage,
    mileageUnit,
    location,
    country: countryGuess ?? (origin === "iaa" || origin === "copart" ? UNITED_STATES : SOUTH_KOREA),
    isActive: !isSold && !/not on sale|removed/i.test(platform),
    listingStatus: isSold ? "sold" : buyNow || /sale/i.test(platform) ? "active" : undefined,
    soldAt: isSold ? saleAt ?? new Date() : undefined,
    sourceListedAt: saleAt,
    accidentCount: countEvents(events, "accident"),
    ownerChangeCount: countEvents(events, "owner_change"),
    events,
    vehicle: vehicleFromParts({
      vin,
      make: labeled($, "Brand"),
      model: labeled($, "Model"),
      trim: labeled($, "Badge") || labeled($, "Generation"),
      year,
      fuelType: labeled($, "Fuel"),
      transmission: labeled($, "Transmission"),
      color: labeled($, "Color"),
      engineDisplacement: labeled($, "Displacement") || labeled($, "Engine"),
      bodyType: labeled($, "Body") || labeled($, "Body style") || labeled($, "Body Style"),
      driveType: labeled($, "Drive") || labeled($, "Drive type"),
      country: countryGuess ?? (origin === "iaa" || origin === "copart" ? UNITED_STATES : SOUTH_KOREA),
    }),
    photos,
    targetProvider: origin,
  };
  return listing;
}

export function classifyOrigin(input: {
  html: string;
  platform: string;
  events: NormalizedEvent[];
  location?: string;
}): ImportMotorOrigin {
  const blob = `${input.platform}\n${input.location ?? ""}\n${input.html.slice(0, 80_000)}`;
  const loc = input.location ?? "";
  // US/CA yards must never map to Encar/Autowini (related-card CDN noise used to do that).
  const usCanadaLoc =
    /\bUSA\b|United States|\bCanada\b/i.test(loc) ||
    /,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|IA|ID|IL|IN|KS|KY|LA|MA|MD|ME|MI|MN|MO|MS|MT|NC|ND|NE|NH|NJ|NM|NV|NY|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VA|VT|WA|WI|WV|WY)\b/i.test(
      loc,
    ) ||
    /\b(Oh|Ny|Wa|Tx|Pa|Mo|Fl|Ga|Il|Ca|Nj|Nc|Va|Mi|Az|Co|Mn|Wi|Tn|In|Md|Ma)\s*-\s*/i.test(loc);

  // Import Motor shorthand: "USA auction C" = Copart, "USA auction I" = IAA.
  if (/\busa\s+auction\s*c\b/i.test(input.platform) || /\bauction\s+platform\s*c\b/i.test(blob)) {
    return "copart";
  }
  if (/\busa\s+auction\s*i\b/i.test(input.platform) || /\bauction\s+platform\s*i\b/i.test(blob)) {
    return "iaa";
  }
  const usaAuction =
    /usa auction/i.test(input.platform) ||
    usCanadaLoc ||
    /cars2?\.import-motor\.com\/(?:copart|iaa)\//i.test(input.html);
  const iaa = /\biaai(?:\.com)?\b|\biaa\b/i.test(input.platform) || /cars2?\.import-motor\.com\/iaa/i.test(blob);
  const copart = /\bcopart(?:\.com)?\b/i.test(input.platform) || /cars2?\.import-motor\.com\/copart|cs\.copart\.com/i.test(blob);
  // US auction pages often embed Encar thumbs in related cards — never let that force KR origin.
  if (iaa) return "iaa";
  if (copart) return "copart";
  if (usaAuction || usCanadaLoc) {
    // Prefer copart when photo CDN path says so even without platform label.
    if (/cars2?\.import-motor\.com\/copart/i.test(input.html)) return "copart";
    if (/cars2?\.import-motor\.com\/iaa/i.test(input.html)) return "iaa";
    // Ambiguous USA/Canada auction pages — Copart is the common IM feed.
    return "copart";
  }

  const korean =
    /korean market/i.test(blob) ||
    (/ci\.encar\.com|cars2?\.import-motor\.com\/encar/i.test(blob) && !usCanadaLoc);
  const fullHistory =
    input.events.some((e) => e.eventType === "owner_change" || e.eventType === "accident" || e.eventType === "inspection") ||
    FULL_HISTORY_TITLES.test(blob);
  if (korean) return fullHistory ? "encar" : "autowini";
  if (/korea|대한민국|서울|경기|encar|엔카/i.test(blob)) return "encar";
  return "copart";
}

/** Prefer exact label rows; ignore concatenated "Vin: … Copy" noise blocks. */
function labeled($: CheerioAPI, label: string): string {
  const want = label.toLowerCase();
  let found = "";
  $("div").each((_, el) => {
    const kids = $(el).children("div");
    if (kids.length < 2) return;
    const head = kids.first().text().replace(/\s+/g, " ").trim();
    const headNorm = head.toLowerCase().replace(/:$/, "");
    if (headNorm !== want) return;
    const value = kids.eq(1).text().replace(/\s+/g, " ").trim();
    if (!value) return;
    // Reject values that look like another label dump.
    if (/^(vin|lot number|brand|model)\b/i.test(value) && value.length > 40) return;
    found = value;
    return false;
  });
  return found;
}

function textMatch($: CheerioAPI, re: RegExp): string | undefined {
  const m = $.root().text().match(re);
  return m?.[1]?.trim();
}

function collectPhotos($: CheerioAPI, html: string, vin: string): NormalizedPhoto[] {
  const vinUpper = vin.toUpperCase();
  const bestByKey = new Map<string, { url: string; score: number }>();

  // Drop "similar / related / more cars" blocks so their <img> tags never enter the gallery.
  $(EXCLUDED_RELATED_CONTAINERS).remove();
  $("article").each((_, el) => {
    const href = $(el).find('a[href*="/v/"]').first().attr("href") || "";
    const m = href.match(/\/v\/([A-HJ-NPR-Z0-9]{17})/i);
    if (m?.[1] && m[1].toUpperCase() !== vinUpper) $(el).remove();
  });

  const scoreUrl = (url: string, fromDom: boolean): number => {
    let score = fromDom ? 100 : 0;
    if (/cars2\.import-motor\.com/i.test(url)) score += 20;
    if (/cars\.import-motor\.com/i.test(url)) score += 10;
    const shot = url.match(/-(\d+)\.(jpe?g|webp|png)(?:\?|$)/i);
    if (shot) score += Math.max(0, 50 - Number(shot[1])); // prefer -1, -2, …
    return score;
  };

  const add = (raw: string | undefined | null, alt?: string | null, fromDom = false) => {
    if (!raw) return;
    const url = raw.trim().replace(/&amp;/g, "&").split("#")[0]!.split("?")[0]!;
    if (!/^https?:\/\//i.test(url)) return;
    if (PHOTO_NOISE.test(url)) return;
    let host = "";
    try {
      host = new URL(url).host;
    } catch {
      return;
    }
    const hostOk = PHOTO_HOST_OK.test(host) || PHOTO_PATH_OK.test(url);
    if (!hostOk) return;

    const urlUpper = url.toUpperCase();
    const altUpper = (alt ?? "").toUpperCase();
    // Reject any URL that embeds a *different* VIN (related Camrys etc.).
    for (const m of urlUpper.matchAll(/\/([A-HJ-NPR-Z0-9]{17})(?=[-/.]|$)/g)) {
      if (m[1] !== vinUpper) return;
    }
    const hasThisVin = urlUpper.includes(vinUpper) || altUpper.includes(vinUpper);
    const isCars2 = /cars2?\.import-motor\.com/i.test(host) || PHOTO_PATH_OK.test(url);
    const isLooseCdn = /(?:^|\.)(?:cs\.copart\.com|ci\.encar\.com|vis\.iaai\.com|iaai\.com)/i.test(host);

    // cars2 paths must include this VIN — that is the authoritative gallery.
    if (isCars2 && !urlUpper.includes(vinUpper)) return;
    // Third-party CDNs without VIN/alt match are usually related-car thumbs; skip.
    if (isLooseCdn && !hasThisVin) return;

    const key = photoIdentityKey(url);
    const score = scoreUrl(url, fromDom);
    const prev = bestByKey.get(key);
    if (!prev || score > prev.score) bestByKey.set(key, { url, score });
  };

  $("img").each((_, el) => {
    const $el = $(el);
    if ($el.closest(EXCLUDED_RELATED_CONTAINERS).length > 0) return;
    const alt = $el.attr("alt");
    add($el.attr("src"), alt, true);
    add($el.attr("data-src"), alt, true);
    add($el.attr("data-lazy-src"), alt, true);
    add($el.attr("data-original"), alt, true);
    const srcset = $el.attr("srcset") || $el.attr("data-srcset");
    if (srcset) {
      const parts = srcset.split(",").map((p) => p.trim().split(/\s+/)[0]).filter(Boolean) as string[];
      for (const p of parts) add(p, alt, true);
    }
  });

  // Script/JSON media: only keep shots for the dominant lot already seen in <img>,
  // otherwise every historical re-list of the same VIN floods -1.webp duplicates.
  const lotCounts = new Map<string, number>();
  for (const { url } of bestByKey.values()) {
    const lot = url.match(/\/(\d{6,})\/[A-HJ-NPR-Z0-9]{17}-\d+\./i)?.[1];
    if (lot) lotCounts.set(lot, (lotCounts.get(lot) ?? 0) + 1);
  }
  let dominantLot: string | undefined;
  let dominantN = 0;
  for (const [lot, n] of lotCounts) {
    if (n > dominantN) {
      dominantLot = lot;
      dominantN = n;
    }
  }

  const vinUrlRe = new RegExp(`https?:\\/\\/[^\\s"'<>]*${vinUpper}[^\\s"'<>]*`, "gi");
  for (const m of html.matchAll(vinUrlRe)) {
    const raw = m[0]!.replace(/\\+$/, "");
    if (dominantLot && !raw.includes(`/${dominantLot}/`)) continue;
    add(raw, null, false);
  }

  const ordered = [...bestByKey.values()]
    .sort((a, b) => b.score - a.score)
    .map((x) => x.url);

  // Stable gallery order by shot index when present.
  ordered.sort((a, b) => {
    const na = Number(a.match(/-(\d+)\.(jpe?g|webp|png)$/i)?.[1] ?? 999);
    const nb = Number(b.match(/-(\d+)\.(jpe?g|webp|png)$/i)?.[1] ?? 999);
    return na - nb;
  });

  return ordered.slice(0, 40).map((sourceUrl, index) => ({
    sourceUrl,
    isPrimary: index === 0,
    sortOrder: index,
    group: "gallery" as const,
  }));
}

/**
 * When Import Motor embeds an IAAI 360 viewer, attach exterior_3d + interior_3d
 * frame lists (swipe sequences) onto the listing photos.
 */
export async function attachImportMotorSpinPhotos(
  listing: NormalizedListing,
  html: string,
): Promise<NormalizedListing> {
  const lot =
    listing.sourceId?.replace(/^im-/i, "") ||
    html.match(/\/(?:iaai|copart)\/[^"'<\s]+\/(\d{6,})\//i)?.[1];
  const stockId = extractIaaiSpinStockId(html, lot && /^\d{6,}$/.test(lot) ? lot : undefined);
  if (!stockId) return listing;

  const spin = await expandIaaiSpinPhotos(stockId);
  if (!spin.length) return listing;

  const gallery = (listing.photos ?? []).map((p) => ({
    ...p,
    group: p.group ?? ("gallery" as const),
  }));
  return { ...listing, photos: [...gallery, ...spin] };
}

function extractTimelineEvents($: CheerioAPI): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  $("ol.relative > li, ol.relative.border-s > li").each((_, li) => {
    const title = rowValue($, $(li), "Title");
    if (!title) return;
    const occurredAt = parseLooseDate($(li).find("time").first().text()) ?? new Date();
    const type = eventTypeFromTitle(title);
    events.push({
      eventType: type,
      description: [title, rowValue($, $(li), "Sub-Title")].filter(Boolean).join(" — "),
      occurredAt,
      metadata: { title },
    });
  });
  return events;
}

function stampEventSource(events: NormalizedEvent[], origin: ImportMotorOrigin): void {
  for (const event of events) {
    const meta =
      event.metadata && typeof event.metadata === "object"
        ? (event.metadata as Record<string, unknown>)
        : {};
    event.metadata = { ...meta, source: origin };
  }
}

function appendDamageEvents(
  events: NormalizedEvent[],
  input: {
    primaryDamage?: string;
    secondaryDamage?: string;
    keys?: string;
    steering?: string;
    saleAt?: Date;
  },
): void {
  const when = input.saleAt ?? new Date();
  if (input.primaryDamage) {
    events.push({
      eventType: /flood|water/i.test(input.primaryDamage) ? "flood_damage" : "accident",
      description: `Primary damage: ${input.primaryDamage}`,
      occurredAt: when,
      metadata: { field: "primary_damage", value: input.primaryDamage },
    });
  }
  if (input.secondaryDamage) {
    // Offset 1s so same-day primary+secondary never collide on older unique indexes.
    const secondaryAt = new Date(when.getTime() + 1000);
    events.push({
      eventType: /flood|water/i.test(input.secondaryDamage) ? "flood_damage" : "accident",
      description: `Secondary damage: ${input.secondaryDamage}`,
      occurredAt: secondaryAt,
      metadata: { field: "secondary_damage", value: input.secondaryDamage },
    });
  }
  if (input.keys) {
    events.push({
      eventType: "other",
      description: `Keys available: ${input.keys}`,
      occurredAt: when,
      metadata: { field: "keys", value: input.keys },
    });
  }
  if (input.steering) {
    events.push({
      eventType: "other",
      description: `Steering: ${input.steering}`,
      occurredAt: when,
      metadata: { field: "steeringType", value: input.steering },
    });
  }
}

/** US/Canada auction title → salvage yes/no event (skipped for KR / Encar / Autowini). */
function appendTitleEvents(
  events: NormalizedEvent[],
  input: {
    vehicleTitle?: string;
    detailedTitle?: string;
    titleStatus?: string;
    saleAt?: Date;
    country?: string;
    location?: string;
    origin?: string;
  },
): void {
  const usCa =
    isUsOrCanadaContext({
      country: input.country,
      location: input.location,
      origin: input.origin,
    }) || Boolean(input.vehicleTitle || input.detailedTitle);
  if (!usCa) return;
  // Korean Encar/Autowini history must never get US title branding.
  if (input.origin === "encar" || input.origin === "autowini") return;

  const when = input.saleAt ?? new Date();
  const region =
    /\bCanada\b/i.test(input.location ?? "") || canonicalCountry(input.country) === CANADA ? "CA" : "US";

  const pushTitle = (field: string, label: string, value?: string) => {
    const text = value?.trim();
    if (!text) return;
    const salvage = textIndicatesSalvage(text);
    events.push({
      eventType: "title_status",
      description: `${label}: ${text}`,
      occurredAt: when,
      metadata: {
        source: input.origin || "copart",
        field,
        value: text,
        salvage,
        state: parseTitleState(text),
        region,
        usCanada: true,
      },
    });
  };

  pushTitle("vehicle_title", "Vehicle title", input.vehicleTitle);
  pushTitle("detailed_title", "Detailed title", input.detailedTitle);
  if (input.titleStatus && /title|salvage|clean|clear|junk|rebuilt/i.test(input.titleStatus)) {
    pushTitle("title_status", "Title status", input.titleStatus);
  }
}

function rowValue($: CheerioAPI, $ctx: any, label: string): string {
  let found = "";
  $ctx.find("th").each((_: number, th: any) => {
    if ($(th).text().replace(/\s+/g, " ").trim().toLowerCase() !== label.toLowerCase()) return;
    found = $(th).closest("tr").find("td").first().text().replace(/\s+/g, " ").trim();
    return false;
  });
  return found;
}

function eventTypeFromTitle(title: string): NormalizedEvent["eventType"] {
  if (/owner change/i.test(title)) return "owner_change";
  if (/insurance processing|damage to my car|accident/i.test(title)) return "accident";
  if (/inspection/i.test(title)) return "inspection";
  if (/new car delivery/i.test(title)) return "delivery";
  return "other";
}

function parseOdometerReading(
  raw: string,
  opts?: { allowBare?: boolean },
): { value: number; unit: "mi" | "km" } | undefined {
  if (!raw?.trim()) return undefined;
  // Prefer the first explicit unit on the page (IM: "173 986 miles / 280 003 km / Actual").
  const miles = raw.match(/([\d\s.,]+)\s*miles?\b/i);
  if (miles) {
    const value = parseKm(miles[1]!);
    if (value != null) return { value, unit: "mi" };
  }
  const km = raw.match(/([\d\s.,]+)\s*km\b/i);
  if (km) {
    const value = parseKm(km[1]!);
    if (value != null) return { value, unit: "km" };
  }
  if (opts?.allowBare) {
    const bare = raw.trim();
    if (/^\d{1,3}([.,\s]\d{3})+\d*$/.test(bare) || (/^\d{4,7}$/.test(bare) && Number(bare) > 500)) {
      const value = parseKm(bare);
      if (value != null) return { value, unit: "km" };
    }
  }
  return undefined;
}

/** @deprecated use parseOdometerReading — kept for call-site clarity in tests */
function parseOdometer(raw: string): number | undefined {
  return parseOdometerReading(raw)?.value;
}

function parseSaleDate(raw: string): Date | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  // 20.08.2026 16:00 or 20.08.2026
  const m = t.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) {
    const dd = Number(m[1]);
    const mm = Number(m[2]) - 1;
    const yyyy = Number(m[3]);
    const hh = Number(m[4] ?? 0);
    const min = Number(m[5] ?? 0);
    const d = new Date(Date.UTC(yyyy, mm, dd, hh, min));
    return Number.isFinite(d.getTime()) ? d : undefined;
  }
  return parseLooseDate(t);
}

function parseLooseDate(raw: string): Date | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const months: Record<string, number> = {
    january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
    july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
  };
  const m = t.match(/^([A-Za-z]+)\s+(\d{2})$/);
  if (m) {
    const month = months[m[1]!.toLowerCase()];
    const year = Number(m[2]!) > 50 ? 1900 + Number(m[2]!) : 2000 + Number(m[2]!);
    if (month != null) return new Date(Date.UTC(year, month, 1));
  }
  const d = Date.parse(t);
  return Number.isFinite(d) ? new Date(d) : undefined;
}

function countEvents(events: NormalizedEvent[], type: NormalizedEvent["eventType"]): number | undefined {
  const n = events.filter((e) => e.eventType === type).length;
  return n > 0 ? n : undefined;
}
