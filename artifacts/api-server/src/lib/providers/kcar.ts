import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  PaginationInfo,
} from "@workspace/providers";
import { SOUTH_KOREA } from "../geo";
import { findVinInListing, parseKm, parseYear, vehicleFromParts } from "./kr-common";
import { moneyListing } from "./us-common";
import {
  asArray,
  asPhotos,
  asRecord,
  collectHttpImages,
  fetchHtml,
  firstRegEvent,
  num,
  str,
  walkFind,
} from "./web-html";

export const KCAR_PARSER_VERSION = "kcar-v1.0.0";
const BASE = "https://www.kcar.com";
const API = "https://api.kcar.com";

export function kcarDetailUrl(id: string): string {
  if (id.startsWith("http")) return id;
  return `${BASE}/bc/detail?carid=${encodeURIComponent(id)}`;
}

async function fetchJson(url: string): Promise<unknown> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Accept: "application/json",
        Referer: `${BASE}/`,
      },
      signal: AbortSignal.timeout(12_000),
    });
    const text = await res.text();
    try {
      return JSON.parse(text);
    } catch {
      return undefined;
    }
  } catch {
    return undefined;
  }
}

export class KcarHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "kcar";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    const push = (id: string) => {
      if (!id || seen.has(id)) return;
      seen.add(id);
      listings.push({ sourceId: id, url: kcarDetailUrl(id) });
    };

    const html = await fetchHtml(`${BASE}/bc/search?page=${page}`);
    for (const match of html.text.matchAll(/carid[=:]["']?([A-Za-z0-9]+)/gi)) {
      push(match[1]!);
    }
    for (const match of html.text.matchAll(/\/bc\/detail\?carid=([A-Za-z0-9]+)/g)) {
      push(match[1]!);
    }

    if (!listings.length) {
      const json = await fetchJson(`${API}/car/base/selectCarList?pageNo=${page}&pageSize=20`);
      const rows = asArray(
        walkFind(json, (_k, v) => (Array.isArray(v) && v.length && asRecord(v[0])?.carid ? v : undefined)),
      );
      for (const row of rows) {
        const rec = asRecord(row);
        const id = str(rec?.carid) ?? str(rec?.carId) ?? str(rec?.i_s_car_id);
        if (id) push(id);
      }
    }

    return { listings, pagination: { currentPage: page, hasMore: listings.length >= 8 } };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const id = url.match(/carid=([^&]+)/)?.[1] ?? url;
    const json = await fetchJson(`${API}/car/detail/selectCarDetail?i_s_car_id=${encodeURIComponent(id)}`);
    const fetched = await fetchHtml(kcarDetailUrl(id));
    return {
      url: fetched.finalUrl,
      html: fetched.text,
      json,
      statusCode: fetched.status,
      headers: {},
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const json = fetched.json;
    const rec =
      asRecord(walkFind(json, (key, value) => (key.toLowerCase().includes("car") && asRecord(value)?.carid ? value : undefined))) ??
      asRecord(json);
    const sourceId = str(rec?.carid) ?? fetched.url.match(/carid=([^&]+)/)?.[1] ?? "unknown";
    const title = str(rec?.carNm) ?? str(rec?.carName) ?? str(rec?.modelNm);
    const vin = findVinInListing(
      str(rec?.cnumber),
      str(rec?.vin),
      str(rec?.chaNo),
      JSON.stringify(rec ?? {}),
      html,
    );
    const mileage = num(rec?.mileage) ?? num(rec?.km) ?? parseKm(str(rec?.mileage));
    const price = num(rec?.nprice) ?? num(rec?.price);
    const photos = vin
      ? asPhotos(
          asArray(rec?.photoList)
            .map((p) => str(asRecord(p)?.url) ?? str(p))
            .filter((u): u is string => !!u)
            .concat(collectHttpImages(html, "kcar", 20)),
        )
      : [];
    const firstReg = firstRegEvent(rec?.frstRegYmd ?? rec?.year);
    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title,
      price: price && price < 1_000_000 ? price * 10_000 : price,
      currency: "KRW",
      mileage,
      mileageUnit: "km",
      location: SOUTH_KOREA,
      country: SOUTH_KOREA,
      vehicle: vehicleFromParts({
        vin,
        make: str(rec?.makerNm),
        model: str(rec?.modelNm) ?? title,
        year: num(rec?.year) ?? parseYear(str(rec?.year)),
        fuelType: str(rec?.fuelNm),
        transmission: str(rec?.gearboxNm),
        country: SOUTH_KOREA,
      }),
      photos,
      events: firstReg ? [firstReg] : undefined,
    });
  }
}
