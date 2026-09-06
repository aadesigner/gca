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

export const SUBITO_PARSER_VERSION = "subito-v1.0.0";
const BASE = "https://www.subito.it";

const IT_HEADERS = {
  "Accept-Language": "it-IT,it;q=0.9,en;q=0.5",
};

export function subitoDetailUrl(idOrUrl: string): string {
  const raw = idOrUrl.trim();
  if (raw.startsWith("http")) return raw;
  if (raw.startsWith("/")) return `${BASE}${raw}`;
  return `${BASE}/auto/${raw}`;
}

function featureVal(features: Record<string, unknown> | undefined, ...keys: string[]): string | undefined {
  if (!features) return undefined;
  for (const key of keys) {
    const rec = asRecord(features[key]);
    const first = asRecord(asArray(rec?.values)[0]);
    const value = str(first?.value) ?? str(first?.key);
    if (value) return value;
  }
  return undefined;
}

function featurePack(
  features: Record<string, unknown> | undefined,
  uri: string,
  label: string,
): string | undefined {
  const rec = asRecord(features?.[uri]);
  for (const row of asArray(rec?.values)) {
    const item = asRecord(row);
    if (str(item?.label)?.toLowerCase() === label.toLowerCase()) return str(item?.value);
  }
  return undefined;
}

function sourceIdFrom(item: Record<string, unknown>, url?: string): string {
  const urn = str(item.urn) ?? "";
  const urnDigits = urn.match(/:(\d+)$/)?.[1];
  if (urnDigits) return urnDigits;
  const fromUrl = (url ?? str(asRecord(item.urls)?.default) ?? "").match(/-(\d+)\.htm/i)?.[1];
  if (fromUrl) return fromUrl;
  return str(item.id) ?? "unknown";
}

function parsePrice(raw?: string): number | undefined {
  if (!raw) return undefined;
  return num(raw.replace(/[^\d]/g, ""));
}

function parseMileage(raw?: string): number | undefined {
  if (!raw) return undefined;
  const scalar = raw.match(/([\d.]+)/)?.[1]?.replace(/\./g, "");
  return num(scalar);
}

function imageUrls(item: Record<string, unknown>): string[] {
  return asArray(item.images)
    .map((img) => {
      const base = str(asRecord(img)?.cdnBaseUrl) ?? str(asRecord(img)?.url);
      if (!base) return undefined;
      if (/\?rule=/.test(base)) return base;
      return `${base}?rule=gallery-desktop-1x-auto`;
    })
    .filter((u): u is string => !!u && /^https?:\/\//i.test(u));
}

export class SubitoHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "subito";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const fetched = await fetchHtml(
      `${BASE}/annunci-italia/vendita/auto/?o=${Math.max(1, page)}`,
      IT_HEADERS,
    );
    const next = extractNextData(fetched.text);
    const items = asRecord(deepGet(next, "props.pageProps.initialState.items"));
    const rows = asArray(items?.originalList).filter((row) => {
      const rec = asRecord(row);
      if (!rec) return false;
      const kind = str(rec.kind) ?? str(rec.type) ?? "";
      // Subito sometimes omits kind or uses AdItem / Item variants.
      if (!kind) return !!str(asRecord(rec.urls)?.default) || !!str(rec.urn);
      return /aditem|item/i.test(kind) && !/banner|adserver|placeholder/i.test(kind);
    });

    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const rec = asRecord(row);
      if (!rec) continue;
      const url = str(asRecord(rec.urls)?.default);
      const id = sourceIdFrom(rec, url);
      if (!id || id === "unknown" || seen.has(id)) continue;
      seen.add(id);
      listings.push({
        sourceId: id,
        url: url ? subitoDetailUrl(url) : subitoDetailUrl(id),
        metadata: {
          subject: str(rec.subject),
          features: rec.features,
          images: imageUrls(rec),
          body: str(rec.body),
        },
      });
    }

    const totalPages = num(items?.totalPages);
    return {
      listings,
      pagination: {
        currentPage: page,
        hasMore: totalPages != null ? page < totalPages : listings.length >= 20,
        totalPages: totalPages ?? undefined,
        resultTotal: num(items?.total),
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
    const fromNext =
      asRecord(deepGet(next, "props.pageProps.ad")) ??
      asRecord(deepGet(next, "props.pageProps.initialState.item")) ??
      asRecord(deepGet(next, "props.pageProps.initialState.ad"));
    const meta = asRecord(fetched.metadata);

    const featureBag =
      asRecord(fromNext?.features) ??
      asRecord(meta?.features) ??
      undefined;
    const subject =
      str(fromNext?.subject) ??
      str(meta?.subject) ??
      html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
        ?.replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const body = str(fromNext?.body) ?? str(meta?.body) ?? "";

    const mileage =
      parseMileage(featureVal(featureBag, "/mileage_scalar", "/mileage", "/km")) ??
      parseMileage(html.match(/([\d.]+)\s*Km/i)?.[1]);
    const year =
      parseYear(featureVal(featureBag, "/year", "/register_date")) ??
      parseYear(html.match(/Immatricolazione[^0-9]{0,20}((?:19|20)\d{2})/i)?.[1]);
    const fuel = featureVal(featureBag, "/fuel");
    const transmission = featureVal(featureBag, "/gearbox");
    const bodyType = featureVal(featureBag, "/car_type", "/vehicles");
    const color = featureVal(featureBag, "/color");
    const make =
      featurePack(featureBag, "/car", "Marca") ??
      featurePack(featureBag, "/vehicles", "Marca") ??
      subject?.split(/\s+/)[0];
    const model =
      featurePack(featureBag, "/car", "Modello") ??
      featurePack(featureBag, "/vehicles", "Modello");
    const price =
      parsePrice(featureVal(featureBag, "/price")) ??
      parsePrice(html.match(/([\d.]+)\s*€/)?.[1]);

    const vin = findVinInListing(body, subject, html);
    const sourceId =
      fetched.url.match(/-(\d+)\.htm/i)?.[1] ??
      str(fromNext?.urn)?.match(/:(\d+)$/)?.[1] ??
      "unknown";

    const metaImages = asArray(meta?.images).map((u) => str(u)).filter((u): u is string => !!u);
    const photos = asPhotos([
      ...imageUrls(fromNext ?? {}),
      ...metaImages,
      ...[...html.matchAll(/https:\/\/images\.sbito\.it[^"'\\\s]+/gi)].map((m) =>
        m[0]!.replace(/rule=gallery-thumbnail[^&"']+/i, "rule=gallery-desktop-1x-auto"),
      ),
    ]);

    const firstReg = firstRegEvent(featureVal(featureBag, "/register_date"));
    const city =
      str(deepGet(fromNext, "geo.city.shortName")) ??
      str(deepGet(fromNext, "geo.town.value")) ??
      str(deepGet(fromNext, "geo.region.value"));

    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title: subject,
      price,
      currency: "EUR",
      mileage,
      mileageUnit: "km",
      location: city ? `${city}, ${ITALY}` : ITALY,
      country: ITALY,
      vehicle: vehicleFromParts({
        vin,
        make,
        model,
        year,
        fuelType: fuel,
        transmission,
        bodyType,
        color,
        country: ITALY,
      }),
      photos: vin ? photos : [],
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
