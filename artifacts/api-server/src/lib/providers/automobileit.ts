import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import { ITALY } from "../geo";
import { findVinInListing, parseYear, vehicleFromParts } from "./kr-common";
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

export const AUTOMOBILEIT_PARSER_VERSION = "automobileit-v1.0.3";
const BASE = "https://www.automobile.it";

const IT_HEADERS = {
  "Accept-Language": "it-IT,it;q=0.9,en;q=0.5",
};

export function automobileitDetailUrl(idOrPath: string): string {
  const raw = idOrPath.trim();
  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `${BASE}${raw}`;
  return `${BASE}/${raw}`;
}

function infoMap(rows: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of asArray(rows)) {
    const rec = asRecord(row);
    const title = str(rec?.title);
    const values = asArray(rec?.values)
      .map((v) => str(v))
      .filter((v): v is string => !!v);
    if (title && values.length) out[title.toLowerCase()] = values.join(" ");
  }
  return out;
}

function infoVal(map: Record<string, string>, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const hit = map[key.toLowerCase()];
    if (hit) return hit;
  }
  for (const [k, v] of Object.entries(map)) {
    if (keys.some((key) => k.includes(key.toLowerCase()))) return v;
  }
  return undefined;
}

function parsePrice(raw?: string): number | undefined {
  if (!raw) return undefined;
  const cleaned = raw.replace(/[^\d.,]/g, "").replace(/\./g, "").replace(",", ".");
  return num(cleaned);
}

function photoUrlsFrom(result: Record<string, unknown> | undefined): string[] {
  const urls: string[] = [];
  const push = (u?: string) => {
    if (u && /^https?:\/\//i.test(u)) urls.push(u);
  };

  for (const img of asArray(result?.imageUrls)) {
    push(str(img));
  }
  for (const pic of asArray(result?.pictures)) {
    if (typeof pic === "string") {
      push(pic);
      continue;
    }
    const rec = asRecord(pic);
    const sizes = asRecord(rec?.sizes);
    push(
      str(asRecord(sizes?.XL)?.href) ??
        str(asRecord(sizes?.BIG)?.href) ??
        str(asRecord(sizes?.ORIG)?.href) ??
        str(rec?.hash) ??
        str(rec?.url),
    );
  }
  return [...new Set(urls)];
}

function listResultBag(next: unknown): Record<string, unknown> | undefined {
  return (
    asRecord(deepGet(next, "props.pageProps.result")) ??
    asRecord(deepGet(next, "props.pageProps.apiResults.result")) ??
    asRecord(deepGet(next, "props.pageProps.apiResults"))
  );
}

export class AutomobileitHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "automobileit";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    // Page 1 is plain /usate; page 2+ uses ?p=N and puts results under apiResults.result.
    const url = page <= 1 ? `${BASE}/usate` : `${BASE}/usate?p=${page}`;
    const fetched = await fetchHtml(url, IT_HEADERS);
    const next = extractNextData(fetched.text);
    const resultBag = listResultBag(next);
    const rows = asArray(resultBag?.resultList);
    const pageInfo = asRecord(resultBag?.page);

    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const rec = asRecord(row);
      if (!rec) continue;
      const path = str(rec.url);
      const id = str(rec.id) ?? path?.split("/").pop();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      listings.push({
        sourceId: id,
        url: path ? automobileitDetailUrl(path) : automobileitDetailUrl(id),
      });
    }

    const totalPages = num(pageInfo?.totalPages);
    const current = num(pageInfo?.number) ?? page;
    return {
      listings,
      pagination: {
        currentPage: current,
        hasMore: totalPages != null ? current < totalPages : listings.length >= 15,
        totalPages: totalPages ?? undefined,
        resultTotal: num(pageInfo?.totalElements),
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url, IT_HEADERS);
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const next = extractNextData(html);
    const result = asRecord(deepGet(next, "props.pageProps.result")) ?? {};
    const vehicleInfo = asRecord(deepGet(next, "props.pageProps.vehicleInformation")) ?? {};
    const basic = infoMap(vehicleInfo.basicInfo);
    const aesthetic = infoMap(vehicleInfo.aesthetic);
    const details = asRecord(result.details) ?? {};

    const description = str(result.description) ?? "";
    const vin = findVinInListing(description, html, JSON.stringify(result).slice(0, 40_000));

    const sourceId =
      str(result.id) ??
      fetched.url.split("/").pop()?.split("?")[0] ??
      "unknown";

    const title = str(result.title);
    const make = infoVal(basic, "marca") ?? title?.split(/\s+/)[0];
    const model = infoVal(basic, "modello");
    const mileage =
      num(infoVal(basic, "chilometri")) ??
      num(str(details.formattedKm)) ??
      num(description.match(/([\d.]+)\s*km/i)?.[1]?.replace(/\./g, ""));
    const year =
      parseYear(infoVal(basic, "immatricolazione")) ??
      parseYear(str(details.registration));
    const fuel =
      infoVal(basic, "carburante") ??
      str(details.fuelEmissions)?.split("-")[0]?.trim();
    const transmission = infoVal(basic, "cambio") ?? str(details.shift);
    const bodyType = infoVal(basic, "carrozzeria");
    const engineDisplacement =
      infoVal(basic, "cilindrata") ?? str(details.formattedEngineCapacity);
    const color =
      infoVal(aesthetic, "colore esterno", "colore") ?? infoVal(basic, "colore");

    const price =
      parsePrice(str(result.formattedPrice)) ??
      num(result.price) ??
      parsePrice(str(deepGet(result, "priceTransparency.price")));

    const location =
      str(asRecord(result.location)?.cityName) ??
      str(asRecord(result.location)?.regionName) ??
      str(result.location);
    const photos = asPhotos(photoUrlsFrom(result));
    const firstReg = firstRegEvent(infoVal(basic, "immatricolazione") ?? str(details.registration));

    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title,
      price,
      currency: "EUR",
      mileage,
      mileageUnit: "km",
      location: location ? `${location}, ${ITALY}` : ITALY,
      country: ITALY,
      vehicle: vehicleFromParts({
        vin,
        make,
        model,
        year,
        trim: infoVal(basic, "versione"),
        fuelType: normalizeEuFuel(fuel),
        transmission: normalizeEuTransmission(transmission),
        bodyType: normalizeEuBodyType(bodyType),
        color: normalizeEuColor(color),
        engineDisplacement,
        country: ITALY,
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
