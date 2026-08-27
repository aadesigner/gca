import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import { CANADA, moneyListing } from "./us-common";
import { findVinInListing, parseYear, vehicleFromParts } from "./kr-common";
import { asPhotos, collectHttpImages, fetchHtml, firstRegEvent, num, str } from "./web-html";
import { withCountry } from "../geo";

export const CARPAGES_PARSER_VERSION = "carpages-v1.1.0";
const BASE = "https://www.carpages.ca";

const MULTI_WORD_MAKES = [
  "mercedes-benz",
  "alfa-romeo",
  "land-rover",
  "rolls-royce",
  "aston-martin",
  "harley-davidson",
  "range-rover",
];

const CARPAGES_MAKES = [
  "toyota",
  "honda",
  "ford",
  "chevrolet",
  "hyundai",
  "kia",
  "nissan",
  "mazda",
  "bmw",
  "mercedes-benz",
  "audi",
  "volkswagen",
  "jeep",
  "gmc",
  "ram",
  "subaru",
  "lexus",
  "dodge",
];

export function carpagesDetailUrl(id: string): string {
  if (id.startsWith("http")) return id;
  if (id.startsWith("/")) return `${BASE}${id}`;
  return `${BASE}/used-cars/${id}`;
}

function titleCase(raw?: string): string | undefined {
  const text = raw?.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text) return undefined;
  return text
    .split(" ")
    .map((w) => (w.length <= 3 && /^(gm| ram|suv)$/i.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

export function parseCarpagesSlug(url: string): {
  province?: string;
  city?: string;
  year?: number;
  make?: string;
  model?: string;
} {
  const match = url.match(
    /\/used-cars\/([a-z0-9-]+)\/([a-z0-9-]+)\/((?:19|20)\d{2})-([a-z0-9-]+)-(\d+)\/?/i,
  );
  if (!match) return {};
  const rest = match[4]!.toLowerCase();
  const multi = MULTI_WORD_MAKES.find((name) => rest === name || rest.startsWith(`${name}-`));
  let makeSlug: string;
  let modelSlug: string | undefined;
  if (multi) {
    makeSlug = multi;
    modelSlug = rest.slice(multi.length).replace(/^-/, "") || undefined;
  } else {
    const cut = rest.indexOf("-");
    makeSlug = cut < 0 ? rest : rest.slice(0, cut);
    modelSlug = cut < 0 ? undefined : rest.slice(cut + 1);
  }
  return {
    province: titleCase(match[1]),
    city: titleCase(match[2]),
    year: Number(match[3]),
    make: titleCase(makeSlug),
    model: titleCase(modelSlug),
  };
}

function meta(html: string, property: string): string | undefined {
  const re = new RegExp(
    `<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']+)["']`,
    "i",
  );
  const alt = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${property}["']`,
    "i",
  );
  return html.match(re)?.[1]?.trim() || html.match(alt)?.[1]?.trim();
}

function parseJsonLd(html: string): {
  name?: string;
  make?: string;
  model?: string;
  year?: number;
  vin?: string;
  mileage?: number;
  price?: number;
} {
  for (const block of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(block[1]!);
      const nodes = Array.isArray(parsed) ? parsed : [parsed, ...((parsed as { "@graph"?: unknown[] })["@graph"] ?? [])];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const rec = node as Record<string, unknown>;
        const type = String(rec["@type"] ?? "");
        if (!/vehicle|car|product/i.test(type) && !rec.brand && !rec.vehicleIdentificationNumber) continue;
        const brand = rec.brand;
        const make =
          typeof brand === "string"
            ? brand
            : brand && typeof brand === "object"
              ? str((brand as Record<string, unknown>).name)
              : undefined;
        const mileageRaw =
          rec.mileageFromOdometer && typeof rec.mileageFromOdometer === "object"
            ? (rec.mileageFromOdometer as Record<string, unknown>).value
            : rec.mileageFromOdometer;
        const offers = rec.offers && typeof rec.offers === "object" ? (rec.offers as Record<string, unknown>) : undefined;
        return {
          name: str(rec.name),
          make,
          model: str(rec.model),
          year: num(rec.modelDate) ?? parseYear(str(rec.modelDate) ?? str(rec.name)),
          vin: str(rec.vehicleIdentificationNumber),
          mileage: num(mileageRaw),
          price: num(offers?.price),
        };
      }
    } catch {
      // ignore malformed ld+json
    }
  }
  return {};
}

function cleanTitle(raw?: string): string | undefined {
  const title = raw?.replace(/\s+/g, " ").trim();
  if (!title || /outdated browser/i.test(title)) return undefined;
  return title.replace(/\s*\|\s*Carpages\.ca\s*$/i, "").trim() || undefined;
}

export class CarpagesHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "carpages";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    const push = (url: string) => {
      const clean = url.split("?")[0]!.replace(/\/$/, "");
      const id = clean.replace(`${BASE}/`, "").replace(/^\//, "");
      if (!id || seen.has(id) || id.includes("used-cars/search")) return;
      if (!/\/used-cars\/[^/]+\/[^/]+\/\d{4}-/i.test(clean)) return;
      seen.add(id);
      listings.push({ sourceId: id, url: clean.startsWith("http") ? clean : `${BASE}/${id}` });
    };

    if (page === 1) {
      const rss = await fetchHtml(`${BASE}/rss/recently_listed/`);
      for (const match of rss.text.matchAll(/https:\/\/www\.carpages\.ca\/used-cars\/[^<\s"]+/g)) {
        push(match[0]!);
      }
    }

    const make = CARPAGES_MAKES[(page - 1) % CARPAGES_MAKES.length]!;
    const makePage = Math.floor((page - 1) / CARPAGES_MAKES.length) + 1;
    const fetched = await fetchHtml(`${BASE}/used-cars/${make}/?page=${makePage}`);
    for (const match of fetched.text.matchAll(/\/used-cars\/[a-z0-9-]+\/[a-z0-9-]+\/\d{4}-[a-z0-9-]+-\d+\/?/g)) {
      push(`${BASE}${match[0]}`);
    }

    return { listings, pagination: { currentPage: page, hasMore: listings.length >= 5 } };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url, {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-CA,en;q=0.9",
    });
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const sourceId = fetched.url.replace(BASE + "/", "").replace(/\/$/, "").split("?")[0] || "unknown";
    const slug = parseCarpagesSlug(fetched.url);
    const ld = parseJsonLd(html);

    const title =
      cleanTitle(meta(html, "og:title")) ??
      cleanTitle(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) ??
      ld.name ??
      [slug.year, slug.make, slug.model].filter(Boolean).join(" ");

    const vin = ld.vin ?? findVinInListing(html);
    const km =
      html.match(/twitter:data2"[^>]+content="([\d,]+)\s*KM/i) ??
      html.match(/([\d,]+)\s*KM/i);
    const price =
      ld.price ??
      num(meta(html, "twitter:data1")?.replace(/[^\d.]/g, "")) ??
      num(html.match(/\$\s*([\d,]+)/)?.[1]);

    const year = ld.year ?? slug.year ?? parseYear(title);
    const make = ld.make ?? slug.make;
    const model = ld.model ?? slug.model;
    const location = withCountry([slug.city, slug.province].filter(Boolean).join(", "), CANADA);

    const photos = vin
      ? asPhotos(
          collectHttpImages(html, "carpages", 40).concat(
            [...html.matchAll(/https:\/\/images\.carpages\.ca\/inventory\/[^"'>\s]+/gi)].map((m) => m[0]!),
          ),
        )
      : [];
    const firstReg = firstRegEvent(year);

    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title,
      price,
      currency: "CAD",
      mileage: ld.mileage ?? (km ? num(km[1]) : undefined),
      mileageUnit: "km",
      location,
      country: CANADA,
      vehicle: vehicleFromParts({
        vin,
        make,
        model,
        year,
        color: html.match(/Used\s+([A-Za-z]+)\s+\d{4}/)?.[1],
        country: CANADA,
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