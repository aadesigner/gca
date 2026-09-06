import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import { PORTUGAL } from "../geo";
import { findVinInListing, normalizeKrVin, parseYear, vehicleFromParts, vinCheckDigitOk, vinLooksLikeNoise } from "./kr-common";
import {
  normalizeEuBodyType,
  normalizeEuColor,
  normalizeEuFuel,
  normalizeEuTransmission,
} from "./eu-locale";
import { moneyListing } from "./us-common";
import {
  asArray,
  asPhotos,
  asRecord,
  deepGet,
  extractNextData,
  fetchHtml,
  firstRegEvent,
  num,
  str,
} from "./web-html";

export const STANDVIRTUAL_PARSER_VERSION = "standvirtual-v1.0.3";
const BASE = "https://www.standvirtual.com";

const PT_HEADERS = {
  "Accept-Language": "pt-PT,pt;q=0.9,en;q=0.5",
  Cookie: "language=en; lang=en",
};

function standvirtualVin(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (/[+\/=.]/.test(raw) || raw.length > 24) return undefined;
  const vin = normalizeKrVin(raw);
  if (!vin || !vinCheckDigitOk(vin)) return undefined;
  if (vinLooksLikeNoise(vin, raw)) return undefined;
  return vin;
}

export function standvirtualDetailUrl(id: string): string {
  if (id.startsWith("http")) return id;
  if (id.startsWith("/")) return `${BASE}${id}`;
  const slug = id.endsWith(".html") ? id : `${id}.html`;
  return `${BASE}/carros/anuncio/${slug}`;
}

function dictVal(dict: Record<string, unknown> | undefined, key: string): string | undefined {
  const rec = asRecord(dict?.[key]);
  const first = asRecord(asArray(rec?.values)[0]);
  return str(first?.label) ?? str(first?.value);
}

function detailsMap(details: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of asArray(details)) {
    const rec = asRecord(row);
    const key = str(rec?.key);
    const value = str(rec?.value);
    if (key && value) out[key] = value;
  }
  return out;
}

function extractUrql(html: string): unknown {
  const match =
    html.match(/window\.__URQL_DATA__\s*=\s*(\{[\s\S]*?\});?\s*<\/script>/i) ||
    html.match(/<script[^>]*>window\.__URQL_DATA__\s*=\s*(\{[\s\S]*?\})\s*<\/script>/i);
  if (!match?.[1]) return undefined;
  try {
    return JSON.parse(match[1]);
  } catch {
    return undefined;
  }
}

export class StandvirtualHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "standvirtual";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const fetched = await fetchHtml(
      `${BASE}/carros?search%5Border%5D=created_at_first%3Adesc&page=${Math.max(1, page)}`,
      PT_HEADERS,
    );
    const listings: ListingReference[] = [];
    const seen = new Set<string>();

    for (const match of fetched.text.matchAll(
      /href="(https:\/\/(?:www\.)?standvirtual\.com\/carros\/anuncio\/[^"?]+)"/g,
    )) {
      const url = match[1]!.split("?")[0]!;
      const id = url.split("/").pop()!.replace(/\.html$/, "");
      if (seen.has(id)) continue;
      seen.add(id);
      listings.push({ sourceId: id, url });
    }

    if (!listings.length) {
      for (const match of fetched.text.matchAll(/\/carros\/anuncio\/([A-Za-z0-9-]+)/g)) {
        const id = match[1]!.replace(/\.html$/, "");
        if (seen.has(id)) continue;
        seen.add(id);
        listings.push({ sourceId: id, url: standvirtualDetailUrl(id) });
      }
    }

    return {
      listings,
      pagination: { currentPage: page, hasMore: listings.length >= 20 },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url, PT_HEADERS);
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const next = extractNextData(html);
    const urql = extractUrql(html);
    const advert =
      asRecord(deepGet(next, "props.pageProps.advert")) ??
      asRecord(deepGet(urql, "advert")) ??
      {};

    const dict = asRecord(advert.parametersDict);
    const details = detailsMap(advert.details);
    const description = str(advert.description) ?? "";
    const rawVin = dictVal(dict, "vin") ?? details.vin;
    const vin =
      standvirtualVin(rawVin) ??
      findVinInListing(description) ??
      // Avoid scanning full HTML — OLX CDN JWTs create false 17-char VIN hits.
      undefined;

    const sourceId =
      fetched.url.split("/").pop()?.replace(/\.html.*/, "") ??
      str(advert.id) ??
      "unknown";
    const title =
      str(advert.title) ??
      html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    const mileage =
      num(dictVal(dict, "mileage")) ??
      num(details.mileage) ??
      num(details.Milhagem) ??
      num(str(asArray(advert.mainFeatures).find((f) => /\d/.test(String(f)) && /km/i.test(String(f)))));
    const price = num(deepGet(advert, "price.value")) ?? num(asRecord(advert.price)?.value);
    const year =
      parseYear(dictVal(dict, "first_registration_year")) ??
      parseYear(details.first_registration_year) ??
      parseYear(dictVal(dict, "year")) ??
      parseYear(details.year) ??
      parseYear(str(asArray(advert.mainFeatures).find((f) => /(?:19|20)\d{2}/.test(String(f)))));
    const make = details.make ?? dictVal(dict, "make");
    const model = details.model ?? dictVal(dict, "model");

    const imageBag = asRecord(advert.images);
    const photoUrls = asArray(imageBag?.photos)
      .map((img) => {
        const raw = str(asRecord(img)?.url) ?? str(asRecord(img)?.id) ?? str(img);
        if (!raw) return undefined;
        return raw.startsWith("//") ? `https:${raw}` : raw;
      })
      .filter((u): u is string => !!u && /^https?:\/\//.test(u));
    const og = html.match(/property="og:image"[^>]+content="([^"]+)"/i)?.[1];
    if (og) photoUrls.unshift(og);
    for (const match of html.matchAll(/https:\/\/[^"'\\\s]+(?:apollo|standvirtual|olxcdn)[^"'\\\s]+\.(?:jpe?g|webp)/gi)) {
      photoUrls.push(match[0]!);
    }

    const city =
      str(deepGet(advert, "seller.city")) ??
      str(deepGet(advert, "seller.location.city"));
    const firstReg = firstRegEvent(dictVal(dict, "date_registration") ?? details.date_registration);

    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title,
      price,
      currency: str(deepGet(advert, "price.currency")) ?? "EUR",
      mileage,
      mileageUnit: "km",
      location: city ? `${city}, ${PORTUGAL}` : PORTUGAL,
      country: PORTUGAL,
      vehicle: vehicleFromParts({
        vin,
        make,
        model,
        year,
        fuelType: normalizeEuFuel(details.fuel_type ?? dictVal(dict, "fuel_type")),
        transmission: normalizeEuTransmission(
          details.gearbox ?? dictVal(dict, "gearbox") ?? dictVal(dict, "transmission"),
        ),
        bodyType: normalizeEuBodyType(details.body_type ?? dictVal(dict, "body_type")),
        color: normalizeEuColor(details.color ?? dictVal(dict, "color")),
        engineDisplacement: dictVal(dict, "engine_capacity"),
        country: PORTUGAL,
      }),
      // Photos kept even without VIN (pipeline still gates history on VIN).
      photos: asPhotos(photoUrls),
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
