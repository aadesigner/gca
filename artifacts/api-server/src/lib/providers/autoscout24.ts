import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  PaginationInfo,
} from "@workspace/providers";
import { EUROPE } from "../geo";
import { CANADA } from "./us-common";
import { findVinInListing, normalizeKrVin, parseYear, vehicleFromParts } from "./kr-common";
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
  walkFind,
} from "./web-html";

export const AUTOSCOUT24_PARSER_VERSION = "autoscout24-v1.1.0";
export const AUTOTRADERCA_PARSER_VERSION = "autotraderca-v1.0.0";

const AS24_HOST = "https://www.autoscout24.com";
const ATCA_HOST = "https://www.autotrader.ca";

export function autoscout24DetailUrl(id: string): string {
  if (id.startsWith("http")) return id;
  if (id.startsWith("/")) return `${AS24_HOST}${id}`;
  return `${AS24_HOST}/offers/${id}`;
}

export function autotradercaDetailUrl(id: string): string {
  if (id.startsWith("http")) return id;
  if (id.startsWith("/")) return `${ATCA_HOST}${id}`;
  return `${ATCA_HOST}/offers/${id}`;
}

function listingPath(host: string, url: string): string {
  if (url.startsWith("http")) return url;
  return `${host}${url.startsWith("/") ? url : `/${url}`}`;
}

class As24FamilyAdapter implements ProviderAdapter {
  constructor(
    readonly internalName: "autoscout24" | "autotraderca",
    private host: string,
    private country: string,
    private currency: string,
    private listUrl: (page: number) => string,
    private detailFn: (id: string) => string,
  ) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const fetched = await fetchHtml(this.listUrl(page));
    const next = extractNextData(fetched.text);
    const listingsRaw = asArray(deepGet(next, "props.pageProps.listings"));
    const listings: ListingReference[] = [];
    const seen = new Set<string>();

    for (const item of listingsRaw) {
      const rec = asRecord(item);
      if (!rec) continue;
      const urlPath = str(rec.url) ?? str(rec.listingUrl);
      const id = str(rec.id) ?? urlPath?.split("/").pop();
      if (!id || seen.has(id)) continue;
      seen.add(id);
      listings.push({
        sourceId: id,
        url: urlPath ? listingPath(this.host, urlPath) : this.detailFn(id),
      });
    }

    if (!listings.length) {
      for (const match of fetched.text.matchAll(/href="(\/offers\/[^"]+)"/g)) {
        const path = match[1]!;
        const id = path.split("/").pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        listings.push({ sourceId: id, url: listingPath(this.host, path) });
      }
    }

    const pages = num(deepGet(next, "props.pageProps.numberOfPages")) ?? num(deepGet(next, "props.pageProps.pagination.totalPages"));
    const fullPage = listings.length >= 15;
    return {
      listings,
      pagination: {
        currentPage: page,
        totalPages: pages,
        hasMore: fullPage || (!!pages && page < pages),
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url);
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const next = extractNextData(html);
    const details =
      asRecord(deepGet(next, "props.pageProps.listingDetails")) ??
      asRecord(deepGet(next, "props.pageProps.listing")) ??
      asRecord(deepGet(next, "props.pageProps"));
    const vehicle = asRecord(details?.vehicle) ?? asRecord(deepGet(details, "vehicle")) ?? {};
    const description = [
      str(details?.description),
      str(deepGet(details, "listingDescription")),
      str(deepGet(details, "htmlDescription")),
    ]
      .filter(Boolean)
      .join("\n");

    const vin =
      findVinInListing(description, JSON.stringify(vehicle), JSON.stringify(details ?? {})) ??
      normalizeKrVin(
        str(walkFind(details ?? vehicle, (key, value) => {
          if (!/(^vin$|vinNumber|chassis)/i.test(key)) return undefined;
          return str(value);
        })),
      );

    const sourceId =
      str(details?.id) ??
      fetched.url.split("/").pop()?.split("?")[0] ??
      "unknown";

    const title =
      str(details?.title) ??
      ([str(deepGet(vehicle, "make.name") ?? vehicle.make), str(deepGet(vehicle, "model.name") ?? vehicle.model), str(vehicle.trim)]
        .filter(Boolean)
        .join(" ") || undefined);

    const mileage =
      num(vehicle.mileageInKm) ??
      num(vehicle.mileage) ??
      num(deepGet(vehicle, "mileage.absolute")) ??
      num(deepGet(details, "vehicle.mileageInKm"));

    const price =
      num(deepGet(details, "prices.public.priceInEUR.absolute")) ??
      num(deepGet(details, "prices.public.amount")) ??
      num(deepGet(details, "price.amount")) ??
      num(details?.price);

    const year =
      parseYear(str(vehicle.firstRegistrationDate) ?? str(vehicle.registrationDate) ?? str(vehicle.modelYear)) ??
      num(vehicle.modelYear);

    const location = [
      str(deepGet(details, "seller.address.city")),
      str(deepGet(details, "seller.address.countryCode")),
    ]
      .filter(Boolean)
      .join(", ");

    const listingCountry =
      str(deepGet(details, "seller.address.country")) ??
      str(deepGet(details, "vehicle.countryVersion")) ??
      this.country;

    const imageUrls: string[] = [];
    const pushImg = (raw?: string) => {
      if (!raw || !/^https?:\/\//i.test(raw)) return;
      const url = raw.replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
      if (!/autoscout24|autotrader|listing-images|prod\.pictures/i.test(url) && !/\.(jpe?g|webp|png)(\?|$)/i.test(url)) return;
      imageUrls.push(url);
    };
    const imageBags = [details?.images, details?.gallery, deepGet(details, "media.images"), deepGet(details, "images.images")];
    for (const bag of imageBags) {
      const items = Array.isArray(bag) ? bag : asArray(asRecord(bag)?.images ?? asRecord(bag)?.photos ?? asRecord(bag)?.items);
      for (const img of items) {
        if (typeof img === "string") {
          pushImg(img);
          continue;
        }
        const rec = asRecord(img);
        const formats = asRecord(rec?.formats) ?? asRecord(rec?.imageFormats);
        const jpg = asRecord(formats?.jpg) ?? asRecord(formats?.webp);
        pushImg(str(jpg?.["1280x960"]) ?? str(jpg?.size1280x960) ?? str(rec?.url) ?? str(rec?.imageUrl));
      }
    }
    const seenObj = new Set<unknown>();
    const stack: unknown[] = [details];
    while (stack.length) {
      const cur = stack.pop();
      if (!cur || typeof cur !== "object" || seenObj.has(cur)) continue;
      seenObj.add(cur);
      if (Array.isArray(cur)) {
        for (const item of cur) stack.push(item);
        continue;
      }
      for (const value of Object.values(cur as Record<string, unknown>)) {
        if (typeof value === "string" && /listing-images|\.jpe?g|\.webp/i.test(value)) pushImg(value);
        else if (value && typeof value === "object") stack.push(value);
      }
    }
    const unescaped = html.replace(/\\u002F/gi, "/").replace(/\\\//g, "/");
    for (const match of unescaped.matchAll(/https:\/\/prod\.pictures\.autoscout24\.net\/listing-images\/[^"'\\\s]+/gi)) {
      pushImg(match[0]);
    }
    const preferred = imageUrls.filter((u) => /1280x960|1920x1080/.test(u));
    const photos = asPhotos(preferred.length ? preferred : imageUrls);
    const firstReg = firstRegEvent(vehicle.firstRegistrationDate ?? vehicle.registrationDate);

    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title,
      price,
      currency: this.currency,
      mileage,
      mileageUnit: "km",
      location: location || listingCountry,
      country: listingCountry,
      vehicle: vehicleFromParts({
        vin,
        make: str(deepGet(vehicle, "make.name") ?? vehicle.make),
        model: str(deepGet(vehicle, "model.name") ?? vehicle.model),
        trim: str(vehicle.trim ?? deepGet(vehicle, "modelVersion")),
        year,
        fuelType: str(deepGet(vehicle, "fuelCategory.formatted") ?? vehicle.fuel),
        transmission: str(deepGet(vehicle, "transmissionType.formatted") ?? vehicle.transmission),
        bodyType: str(deepGet(vehicle, "bodyType.formatted") ?? vehicle.bodyType),
        color: str(deepGet(vehicle, "bodyColor.formatted") ?? vehicle.color),
        country: listingCountry,
      }),
      photos,
      events: firstReg ? [firstReg] : undefined,
    });
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin;
  }

  extractPhotos(listing: NormalizedListing) {
    return listing.photos ?? [];
  }
}

export class Autoscout24HistoricalAdapter extends As24FamilyAdapter {
  constructor(_baseUrl?: string, _filters: Record<string, unknown> = {}) {
    super(
      "autoscout24",
      AS24_HOST,
      EUROPE,
      "EUR",
      (page) => `${AS24_HOST}/lst?atype=C&cy=D%2CA%2CB%2CE%2CF%2CI%2CL%2CNL&sort=age&desc=1&ustate=N%2CU&page=${page}`,
      autoscout24DetailUrl,
    );
  }
}

export class AutotradercaHistoricalAdapter extends As24FamilyAdapter {
  constructor(_baseUrl?: string, _filters: Record<string, unknown> = {}) {
    super(
      "autotraderca",
      ATCA_HOST,
      CANADA,
      "CAD",
      (page) => `${ATCA_HOST}/cars?sort=age&desc=1&atype=C&page=${page}`,
      autotradercaDetailUrl,
    );
  }
}
