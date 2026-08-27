import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  PaginationInfo,
} from "@workspace/providers";
import { AUSTRIA } from "../geo";
import { findVinInListing, parseYear, vehicleFromParts } from "./kr-common";
import { moneyListing } from "./us-common";
import {
  asArray,
  asPhotos,
  asRecord,
  collectHttpImages,
  deepGet,
  extractNextData,
  fetchHtml,
  firstRegEvent,
  mentionsVinLabel,
  num,
  str,
} from "./web-html";

export const WILLHABEN_PARSER_VERSION = "willhaben-v1.0.0";
const BASE = "https://www.willhaben.at";

export function willhabenDetailUrl(id: string): string {
  if (id.startsWith("http")) return id;
  if (id.startsWith("/")) return `${BASE}${id}`;
  return `${BASE}/iad/${id}`;
}

function attrMap(ad: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const attr of asArray(ad.attributes)) {
    const rec = asRecord(attr);
    const name = str(rec?.name);
    const values = asArray(rec?.values).map((v) => str(v)).filter((v): v is string => !!v);
    if (name && values.length) out[name] = values[0]!;
  }
  return out;
}

function seoUrl(ad: Record<string, unknown>): string | undefined {
  for (const link of asArray(ad.contextLinkList)) {
    const rec = asRecord(link);
    const id = (str(rec?.id) ?? "").toLowerCase();
    const uri = str(rec?.uri) ?? str(rec?.url);
    if (uri && (id.includes("seo") || id.includes("detail") || uri.includes("/iad/"))) {
      return uri.startsWith("http") ? uri : `${BASE}${uri}`;
    }
  }
  return undefined;
}

export class WillhabenHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "willhaben";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const fetched = await fetchHtml(
      `${BASE}/iad/gebrauchtwagen/auto/gebrauchtwagenboerse?sfId=5d1e3c3e-6c0a-4c3e-9c3e-page&page=${page}&rows=30`,
    );
    const next = extractNextData(fetched.text);
    const ads = asArray(
      deepGet(next, "props.pageProps.searchResult.advertSummaryList.advertSummary") ??
        deepGet(next, "props.pageProps.searchResult.advertSummaryList"),
    );
    const listings: ListingReference[] = [];
    const seen = new Set<string>();

    for (const item of ads) {
      const rec = asRecord(item);
      if (!rec) continue;
      const id = str(rec.id) ?? str(rec.advertId);
      if (!id || seen.has(id)) continue;
      const attrs = attrMap(rec);
      const body = attrs.BODY_DYN ?? attrs.DESCRIPTION ?? attrs.BODY ?? "";
      const vin = findVinInListing(body, JSON.stringify(attrs));
      if (!vin && body && !mentionsVinLabel(body)) continue;
      seen.add(id);
      listings.push({
        sourceId: id,
        url: seoUrl(rec) ?? `${BASE}/iad/${id}/`,
        metadata: vin ? { vin, mileage: attrs.MILEAGE, price: attrs.PRICE, title: attrs.HEADING } : undefined,
      });
    }

    if (!listings.length) {
      for (const match of fetched.text.matchAll(/\/iad\/kaufen-und-verkaufen\/d\/auto\/[^"]+-(\d+)\//g)) {
        const id = match[1]!;
        if (seen.has(id)) continue;
        seen.add(id);
        listings.push({ sourceId: id, url: `${BASE}${match[0]}` });
      }
    }

    return { listings, pagination: { currentPage: page, hasMore: listings.length >= 10 } };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url);
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const next = extractNextData(html);
    const ad =
      asRecord(deepGet(next, "props.pageProps.advertDetails")) ??
      asRecord(deepGet(next, "props.pageProps.advertSummary")) ??
      asRecord(deepGet(next, "props.pageProps"));
    const attrs = ad ? attrMap(ad) : {};
    const description = attrs.BODY_DYN ?? attrs.DESCRIPTION ?? str(ad?.description) ?? "";
    const vin =
      findVinInListing(description, JSON.stringify(attrs), html) ??
      (typeof fetched.metadata === "object" ? str(asRecord(fetched.metadata)?.vin) : undefined);
    const sourceId = str(ad?.id) ?? fetched.url.match(/(\d{6,})/)?.[1] ?? "unknown";
    const title = attrs.HEADING ?? str(ad?.heading) ?? str(ad?.title);
    const mileage = num(attrs.MILEAGE);
    const price = num(attrs.PRICE ?? attrs.PRICE_FOR_DISPLAY);
    const year = parseYear(attrs.YEAR_MODEL ?? attrs.CAR_MODEL_YEAR);
    const photos = vin ? asPhotos(collectHttpImages(html, "willhaben", 40)) : [];
    const firstReg = firstRegEvent(attrs.FIRST_REGISTRATION ?? attrs.EZ);
    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title,
      price,
      currency: "EUR",
      mileage,
      mileageUnit: "km",
      location: attrs.LOCATION ?? AUSTRIA,
      country: AUSTRIA,
      vehicle: vehicleFromParts({
        vin,
        make: attrs.CAR_MODEL_MAKE ?? attrs.MAKE,
        model: attrs.CAR_MODEL_MODEL ?? attrs.MODEL,
        year,
        fuelType: attrs.FUEL,
        transmission: attrs.TRANSMISSION,
        country: AUSTRIA,
      }),
      photos,
      events: firstReg ? [firstReg] : undefined,
    });
  }
}
