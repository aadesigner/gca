/**
 * Autovit.ro (OLX Romania) — same Next.js advert shape as Otomoto/Standvirtual.
 *
 * Crawl works from Railway Node (no Cloudflare gate observed).
 * VIN field is usually encrypted behind “Vezi VIN” + reCAPTCHA/login; we only
 * accept plaintext VINs from the labeled field or description (never full-HTML
 * scan — OLX CDN JWTs create false 17-char hits).
 */
import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import { ROMANIA } from "../geo";
import {
  findVinInListing,
  normalizeKrVin,
  parseYear,
  vehicleFromParts,
  vinCheckDigitOk,
  vinLooksLikeNoise,
} from "./kr-common";
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

export const AUTOVIT_PARSER_VERSION = "autovit-v1.0.0";
const BASE = "https://www.autovit.ro";

const RO_HEADERS = {
  "Accept-Language": "ro-RO,ro;q=0.9,en;q=0.5",
  Cookie: "language=en; lang=en; l=en",
};

const TITLE_BRANDS = [
  "Alfa Romeo",
  "Aston Martin",
  "Land Rover",
  "Mercedes-Benz",
  "Mercedes",
  "Volkswagen",
  "Mitsubishi",
  "Hyundai",
  "Renault",
  "Peugeot",
  "Citroen",
  "Citroën",
  "Porsche",
  "Jaguar",
  "Skoda",
  "Škoda",
  "Seat",
  "Cupra",
  "Volvo",
  "Toyota",
  "Honda",
  "Mazda",
  "Nissan",
  "Suzuki",
  "Subaru",
  "Lexus",
  "Audi",
  "BMW",
  "Ford",
  "Opel",
  "Fiat",
  "Kia",
  "Mini",
  "Jeep",
  "Dacia",
  "Tesla",
  "Omoda",
].sort((a, b) => b.length - a.length);

/** Reject OLX encrypted VIN tokens / CDN noise. */
function autovitVin(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (/[+\/=.]/.test(raw) || raw.length > 24) return undefined;
  const vin = normalizeKrVin(raw);
  if (!vin || !vinCheckDigitOk(vin)) return undefined;
  if (vinLooksLikeNoise(vin, raw)) return undefined;
  return vin;
}

export function autovitDetailUrl(id: string): string {
  if (id.startsWith("http")) return id;
  if (id.startsWith("/")) return `${BASE}${id}`;
  const slug = id.endsWith(".html") ? id : `${id}.html`;
  return `${BASE}/autoturisme/anunt/${slug}`;
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

function parseTitleParts(title?: string): { make?: string; model?: string } {
  if (!title) return {};
  const brand = TITLE_BRANDS.find(
    (b) => title.toLowerCase().startsWith(b.toLowerCase() + " ") || title.toLowerCase() === b.toLowerCase(),
  );
  if (!brand) {
    const [make, ...rest] = title.split(/\s+/);
    return { make, model: rest[0] };
  }
  const rest = title.slice(brand.length).trim();
  const model = rest
    .split(/\s+/)
    .filter((w) => !/^\d/.test(w) && !/^(tdi|tsi|dci|crdi|xdrive|mhev|s&s)$/i.test(w))
    .slice(0, 2)
    .join(" ");
  return { make: brand === "Mercedes" ? "Mercedes-Benz" : brand, model: model || rest.split(/\s+/)[0] };
}

export class AutovitHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "autovit";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const yf = Number(this._filters.yearFrom);
    const yt = Number(this._filters.yearTo);
    let url = `${BASE}/autoturisme?search%5Border%5D=created_at_first%3Adesc&page=${Math.max(1, page)}`;
    if (Number.isFinite(yf) && yf > 0) {
      url += `&search%5Bfilter_float_year%3Afrom%5D=${Math.trunc(yf)}`;
    }
    if (Number.isFinite(yt) && yt > 0) {
      url += `&search%5Bfilter_float_year%3Ato%5D=${Math.trunc(yt)}`;
    }

    const fetched = await fetchHtml(url, RO_HEADERS);
    const listings: ListingReference[] = [];
    const seen = new Set<string>();

    for (const match of fetched.text.matchAll(
      /href="(https:\/\/(?:www\.)?autovit\.ro\/autoturisme\/anunt\/[^"?]+)"/g,
    )) {
      const href = match[1]!.split("?")[0]!;
      const id = href.split("/").pop()!.replace(/\.html$/, "");
      if (seen.has(id)) continue;
      seen.add(id);
      listings.push({ sourceId: id, url: href });
    }

    if (!listings.length) {
      for (const match of fetched.text.matchAll(/\/autoturisme\/anunt\/([A-Za-z0-9-]+)\.html/g)) {
        const id = match[1]!;
        if (seen.has(id)) continue;
        seen.add(id);
        listings.push({ sourceId: id, url: autovitDetailUrl(id) });
      }
    }

    return {
      listings,
      pagination: { currentPage: page, hasMore: listings.length >= 20 },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url, RO_HEADERS);
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const next = extractNextData(html);
    const advert = asRecord(deepGet(next, "props.pageProps.advert")) ?? {};
    const dict = asRecord(advert.parametersDict);
    const details = detailsMap(advert.details);
    const fromTitle = parseTitleParts(str(advert.title));
    const description = str(advert.description) ?? "";

    const rawVin = dictVal(dict, "vin") ?? details.vin;
    const vin =
      autovitVin(rawVin) ??
      // Description only — do not scan full HTML (encrypted tokens / JWTs).
      findVinInListing(description, `VIN: ${details.vin && !/[+\/=.]/.test(details.vin) ? details.vin : ""}`);

    const sourceId =
      fetched.url.split("/").pop()?.replace(/\.html.*/, "") ?? str(advert.id) ?? "unknown";
    const title =
      str(advert.title) ??
      html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    const mileage =
      num(dictVal(dict, "mileage")) ??
      num(details.mileage) ??
      num(str(asArray(advert.mainFeatures).find((f) => /\d/.test(String(f)) && /km/i.test(String(f)))));
    const price = num(deepGet(advert, "price.value")) ?? num(asRecord(advert.price)?.value);
    const year =
      parseYear(dictVal(dict, "year")) ??
      parseYear(details.year) ??
      parseYear(dictVal(dict, "first_registration_year")) ??
      parseYear(details.first_registration_year) ??
      parseYear(str(asArray(advert.mainFeatures).find((f) => /(?:19|20)\d{2}/.test(String(f)))));
    const make = details.make ?? dictVal(dict, "make") ?? fromTitle.make;
    const model = details.model ?? dictVal(dict, "model") ?? fromTitle.model;

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
    for (const match of html.matchAll(/https:\/\/[^"'\\\s]+(?:apollo|autovit|olxcdn)[^"'\\\s]+\.(?:jpe?g|webp)/gi)) {
      photoUrls.push(match[0]!);
    }

    const city =
      str(deepGet(advert, "seller.city")) ??
      str(deepGet(advert, "seller.location.city")) ??
      str(deepGet(advert, "location.city.name"));
    const firstReg = firstRegEvent(dictVal(dict, "date_registration") ?? details.date_registration);
    const currency = str(deepGet(advert, "price.currency")) ?? "EUR";

    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title,
      price,
      currency,
      mileage,
      mileageUnit: "km",
      location: city ? `${city}, ${ROMANIA}` : ROMANIA,
      country: ROMANIA,
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
        country: ROMANIA,
      }),
      // Photos when we have a VIN (pipeline VIN-gates history); still capture gallery URLs.
      photos: vin ? asPhotos(photoUrls) : [],
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
