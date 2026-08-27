import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import { POLAND } from "../geo";
import { findVinInListing, normalizeKrVin, parseYear, vehicleFromParts, vinCheckDigitOk } from "./kr-common";
import {
  normalizePlBody,
  normalizePlColor,
  normalizePlFuel,
  normalizePlTransmission,
} from "./pl-locale";
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

export const OTOMOTO_PARSER_VERSION = "otomoto-v1.2.0";
const BASE = "https://www.otomoto.pl";

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
].sort((a, b) => b.length - a.length);

export function otomotoDetailUrl(id: string): string {
  if (id.startsWith("http")) return id;
  if (id.startsWith("/")) return `${BASE}${id}`;
  return `${BASE}/osobowe/oferta/${id}.html`;
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
    .filter((w) => !/^\d/.test(w) && !/^(tdi|tsi|dci|crdi|xdrive)$/i.test(w))
    .slice(0, 2)
    .join(" ");
  return { make: brand === "Mercedes" ? "Mercedes-Benz" : brand, model: model || rest.split(/\s+/)[0] };
}

const EN_HEADERS = {
  "Accept-Language": "en-US,en;q=0.9,pl;q=0.3",
  Cookie: "language=en; lang=en; otoweb_language=en",
};

export class OtomotoHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "otomoto";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const fetched = await fetchHtml(
      `${BASE}/osobowe?search%5Border%5D=created_at_first%3Adesc&page=${page}`,
      EN_HEADERS,
    );
    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const match of fetched.text.matchAll(/href="(https:\/\/(?:www\.)?otomoto\.pl\/osobowe\/oferta\/[^"?]+)"/g)) {
      const url = match[1]!.split("?")[0]!;
      const id = url.split("/").pop()!.replace(/\.html$/, "");
      if (seen.has(id)) continue;
      seen.add(id);
      listings.push({ sourceId: id, url });
    }
    if (!listings.length) {
      for (const match of fetched.text.matchAll(/\/osobowe\/oferta\/([A-Za-z0-9-]+)\.html/g)) {
        const id = match[1]!;
        if (seen.has(id)) continue;
        seen.add(id);
        listings.push({ sourceId: id, url: otomotoDetailUrl(id) });
      }
    }
    return { listings, pagination: { currentPage: page, hasMore: listings.length >= 20 } };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url, EN_HEADERS);
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
    const rawVin = dictVal(dict, "vin");
    const vin =
      (rawVin && normalizeKrVin(rawVin) && vinCheckDigitOk(normalizeKrVin(rawVin)!)
        ? normalizeKrVin(rawVin)
        : undefined) ?? findVinInListing(description, `VIN: ${details.vin ?? ""}`);

    const sourceId = fetched.url.split("/").pop()?.replace(/\.html.*/, "") ?? str(advert.id) ?? "unknown";
    const title =
      str(advert.title) ??
      html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    const mileage =
      num(dictVal(dict, "mileage")) ?? num(details.mileage) ?? num((asArray(advert.mainFeatures)[1] as string) ?? "");
    const price = num(deepGet(advert, "price.value")) ?? num(asRecord(advert.price)?.value);
    const year = parseYear(dictVal(dict, "year") ?? details.year) ?? parseYear(str(asArray(advert.mainFeatures)[0]));
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

    const photos = vin ? asPhotos(photoUrls) : [];
    const firstReg = firstRegEvent(dictVal(dict, "date_registration") ?? details.date_registration);
    const city = str(deepGet(advert, "seller.city")) ?? str(deepGet(advert, "seller.location.city"));

    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title,
      price,
      currency: str(deepGet(advert, "price.currency")) ?? "PLN",
      mileage,
      mileageUnit: "km",
      location: city ? `${city}, ${POLAND}` : POLAND,
      country: POLAND,
      vehicle: vehicleFromParts({
        vin,
        make,
        model,
        year,
        fuelType: normalizePlFuel(details.fuel_type ?? dictVal(dict, "fuel_type")),
        transmission: normalizePlTransmission(
          details.gearbox ?? dictVal(dict, "gearbox") ?? dictVal(dict, "transmission"),
        ),
        bodyType: normalizePlBody(details.body_type ?? dictVal(dict, "body_type")),
        color: normalizePlColor(details.color),
        engineDisplacement: dictVal(dict, "engine_capacity"),
        country: POLAND,
      }),
      photos,
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
