import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import { BULGARIA } from "../geo";
import { findVinInListing, parseYear, vehicleFromParts } from "./kr-common";
import { moneyListing } from "./us-common";
import { asPhotos, fetchHtml, firstRegEvent, num } from "./web-html";

export const MOBILEBG_PARSER_VERSION = "mobilebg-v1.0.0";
const BASE = "https://www.mobile.bg";

const BG_HEADERS = {
  "Accept-Language": "bg-BG,bg;q=0.9,en;q=0.5",
};

export function mobilebgDetailUrl(idOrPath: string): string {
  const raw = idOrPath.trim();
  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `${BASE}${raw}`;
  if (/^\d+$/.test(raw)) return `${BASE}/obiava-${raw}`;
  return `${BASE}/${raw}`;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#039;/g, "'");
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function paramMap(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const match of html.matchAll(
    /class="item[^"]*"[^>]*>\s*<div class="mpLabel">([\s\S]*?)<\/div>\s*<div class="mpInfo">([\s\S]*?)<\/div>/gi,
  )) {
    const label = stripTags(match[1] ?? "").toLowerCase();
    const value = stripTags(match[2] ?? "");
    if (label && value) out[label] = value;
  }
  return out;
}

function paramVal(map: Record<string, string>, ...needles: RegExp[]): string | undefined {
  for (const [label, value] of Object.entries(map)) {
    if (needles.some((re) => re.test(label))) return value;
  }
  return undefined;
}

function parsePrice(html: string): { price?: number; currency: string } {
  const priceBlock =
    html.match(/class="Price"[^>]*>([\s\S]*?)(?:<\/div>|<span)/i)?.[1] ??
    html.match(/class="galleryInfo"[^>]*>[\s\S]*?<b>([\s\S]*?)<\/b>/i)?.[1] ??
    "";
  const text = stripTags(priceBlock);
  const eur = text.match(/([\d\s]+)\s*(?:€|EUR)/i);
  if (eur) return { price: num(eur[1]!.replace(/\s/g, "")), currency: "EUR" };
  const bgn = text.match(/([\d\s]+)\s*лв/i);
  if (bgn) return { price: num(bgn[1]!.replace(/\s/g, "")), currency: "BGN" };
  const any = html.match(/([\d\s]{3,})\s*(?:€|EUR|лв\.?)/i);
  if (any) {
    const currency = /€|EUR/i.test(any[0]!) ? "EUR" : "BGN";
    return { price: num(any[1]!.replace(/\s/g, "")), currency };
  }
  return { currency: "BGN" };
}

function parseTitleParts(title?: string): { make?: string; model?: string } {
  if (!title) return {};
  const cleaned = title.replace(/№\s*:?\s*\d+/i, "").replace(/\s+/g, " ").trim();
  const parts = cleaned.split(/\s+/);
  return { make: parts[0], model: parts.slice(1, 3).join(" ") || undefined };
}

export class MobilebgHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "mobilebg";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const path =
      page <= 1
        ? `${BASE}/obiavi/avtomobili-dzhipove`
        : `${BASE}/obiavi/avtomobili-dzhipove/p-${page}`;
    const fetched = await fetchHtml(path, BG_HEADERS);
    const listings: ListingReference[] = [];
    const seen = new Set<string>();

    for (const match of fetched.text.matchAll(/(?:https?:)?(?:\/\/(?:www\.)?mobile\.bg)?(\/obiava-(\d+)-[^"'\\\s<>]+)/g)) {
      const fullPath = match[1]!;
      const id = match[2]!;
      if (seen.has(id)) continue;
      seen.add(id);
      listings.push({ sourceId: id, url: mobilebgDetailUrl(fullPath) });
    }

    return {
      listings,
      pagination: { currentPage: page, hasMore: listings.length >= 20 },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url, BG_HEADERS);
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const sourceId =
      fetched.url.match(/\/obiava-(\d+)/)?.[1] ??
      fetched.url.match(/(\d{10,})/)?.[1] ??
      "unknown";

    const title = stripTags(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1] ?? "");
    const fromTitle = parseTitleParts(title);
    const params = paramMap(html);

    const mileage =
      num(paramVal(params, /пробег|км|mileage/i)?.replace(/\s/g, "")) ??
      num(html.match(/([\d\s]{2,})\s*км/i)?.[1]?.replace(/\s/g, ""));
    const year =
      parseYear(paramVal(params, /година|производство|year/i)) ??
      parseYear(title);
    const fuel = paramVal(params, /гориво|fuel/i);
    const transmission = paramVal(params, /скорост|кутия|transmission|gear/i);
    const make = paramVal(params, /марка|make|brand/i) ?? fromTitle.make;
    const model = paramVal(params, /модел|model/i) ?? fromTitle.model;
    const color = paramVal(params, /цвят|color/i);
    const bodyType = paramVal(params, /категория|тип|body/i);

    const vin =
      findVinInListing(
        paramVal(params, /vin|шаси|рама|chassis/i),
        html.match(/(?:VIN|Шаси|шаси|Chassis)[\s:]*([A-HJ-NPR-Z0-9]{17})/i)?.[1],
        html,
      ) ?? undefined;

    const { price, currency } = parsePrice(html);
    const photos = [
      ...html.matchAll(
        /src="(https?:\/\/(?:mobistatic\d*\.focus\.bg|static\.mobile\.bg)[^"]+\.(?:jpe?g|webp|png)[^"]*)"/gi,
      ),
    ].map((m) => m[1]!);
    // Prefer big1 gallery sizes when present.
    const preferred = photos.filter((u) => /\/big\d?\//i.test(u));
    const firstReg = firstRegEvent(paramVal(params, /година|производство/i));

    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title: title || undefined,
      price,
      currency,
      mileage,
      mileageUnit: "km",
      location: BULGARIA,
      country: BULGARIA,
      vehicle: vehicleFromParts({
        vin,
        make,
        model,
        year,
        fuelType: fuel,
        transmission,
        bodyType,
        color,
        country: BULGARIA,
      }),
      photos: vin ? asPhotos(preferred.length ? preferred : photos) : [],
      events: firstReg ? [firstReg] : undefined,
    });
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin;
  }

  extractPhotos(listing: NormalizedListing): NormalizedPhoto[] {
    return listing.photos ?? [];
  }
}
