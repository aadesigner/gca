/**
 * Mobile.de provider — Germany's largest automotive marketplace (~1.9M listings).
 *
 * Uses the consumer BFF JSON API:
 *   SRP: GET /consumer/api/search/srp?url=<suchen URL>
 *   VIP: GET /consumer/api/search/vip?url=<details URL>
 * Requires header: x-mobile-client: de.mobile.consumer-webapp
 *
 * VIN extraction: dealer descriptions often contain "VIN" or "Fahrgestell-Nr." labels.
 * Photos: galleryImages array in VIP response, hosted on img.classistatic.de.
 *
 * ⚠ Pagination capped at 50 pages (~1300 listings) per search.
 *   Year sharding in the worker handles the full catalog.
 *
 * Parser version: mobilede-v1.0.0
 */
import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import { GERMANY, EUROPE } from "../geo";
import { findVinInListing, parseYear, vehicleFromParts, vinCheckDigitOk } from "./kr-common";
import { moneyListing } from "./us-common";
import { num, str } from "./web-html";
import { logger } from "../logger";

export const MOBILEDE_PARSER_VERSION = "mobilede-v1.0.0";
const BFF_HOST = "https://www.mobile.de";
const SRP_PATH = "/consumer/api/search/srp";
const VIP_PATH = "/consumer/api/search/vip";
const SUCHEN_BASE = "https://suchen.mobile.de/fahrzeuge";

const BFF_HEADERS: Record<string, string> = {
  "x-mobile-client": "de.mobile.consumer-webapp",
  Accept: "application/json",
  "Accept-Language": "en-US,en;q=0.9,de;q=0.3",
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
};

/** Images below this width are thumbnails/icons — skip them. */
const MIN_IMAGE_WIDTH = 300;

/** SRP search URL builder. Sorted by creation_date descending (newest first). */
function buildSearchUrl(page: number, filters: Record<string, unknown> = {}): string {
  const params = new URLSearchParams({
    dam: "0",
    sfmr: "false",
    vc: "Car",
    "sortOption.sortBy": "creation_date",
    "sortOption.sortOrder": "DESCENDING",
  });
  if (page > 1) params.set("pageNumber", String(page));
  const yearFrom = filters.yearFrom as number | undefined;
  const yearTo = filters.yearTo as number | undefined;
  if (yearFrom != null) params.set("fr", `${yearFrom}:01`);
  if (yearTo != null) params.set("fr", (params.get("fr") || "") ? `${yearFrom || 1900}:01` : `::${yearTo}:12`);
  // mobile.de uses ms.minFirstRegistrationDate / ms.maxFirstRegistrationDate in the classic URL
  if (yearFrom != null) params.set("ms.minFirstRegistrationDate", `${yearFrom}-01`);
  if (yearTo != null) params.set("ms.maxFirstRegistrationDate", `${yearTo}-12`);
  return `${SUCHEN_BASE}/search.html?${params.toString()}`;
}

export function mobiledeDetailUrl(id: string): string {
  if (id.startsWith("http")) return id;
  return `${SUCHEN_BASE}/details.html?id=${id}`;
}

/** Fetch from the BFF API with the required client header. */
async function bffFetch(path: string, query: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams(query).toString();
  const url = `${BFF_HOST}${path}?${qs}`;
  const res = await fetch(url, {
    headers: BFF_HEADERS,
    redirect: "follow",
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`mobile.de ${res.status}: ${text.slice(0, 200)}`), {
      statusCode: res.status,
    });
  }
  return res.json();
}

// ----- SRP item parsing helpers -----

function parseAttr(attr: Record<string, string> | undefined, key: string): string | undefined {
  if (!attr) return undefined;
  const v = attr[key];
  return v?.trim() || undefined;
}

function parseMileageKm(raw?: string): number | undefined {
  if (!raw) return undefined;
  const n = Number(raw.replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parsePowerKw(raw?: string): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/(\d+)\s*kW/);
  return m ? `${m[1]} kW` : undefined;
}

function parseDisplacement(raw?: string): string | undefined {
  if (!raw) return undefined;
  const m = raw.match(/([\d,.]+)\s*cc/i);
  return m ? `${m[1].replace(",", ".")} cc` : undefined;
}

/** Resolve the highest-resolution image URL from a classistatic srcSet or src. */
function bestImageUrl(img: { src?: string; srcSet?: string } | string | undefined): string | undefined {
  if (!img) return undefined;
  if (typeof img === "string") return img;
  const srcSet = img.srcSet || "";
  // srcSet format: "url 360w, url 1024w, url 1600w"
  let best = "";
  let bestW = 0;
  for (const entry of srcSet.split(",")) {
    const parts = entry.trim().split(/\s+/);
    const url = parts[0] || "";
    const w = Number((parts[1] || "").replace("w", "")) || 0;
    if (w > bestW && url.startsWith("http")) {
      best = url;
      bestW = w;
    }
  }
  if (best && bestW >= MIN_IMAGE_WIDTH) return best;
  return img.src || undefined;
}

/** Extract VIN from description text — German dealers use "VIN", "Fahrgestell", "FIN". */
function extractMobiledeVin(
  desc?: string,
  jsonStr?: string,
): string | undefined {
  if (!desc && !jsonStr) return undefined;
  const combined = [desc || "", jsonStr || ""].join(" ");
  return findVinInListing(combined, jsonStr || "");
}

/** Map German fuel names to canonical. */
function normalizeFuel(raw?: string): string | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (/benzin|petrol|gasoline/i.test(lower)) return "Gasoline";
  if (/diesel/i.test(lower)) return "Diesel";
  if (/elektro|electric/i.test(lower)) return "Electric";
  if (/hybrid/i.test(lower)) return "Hybrid";
  if (/lpg|autogas/i.test(lower)) return "LPG";
  if (/cng|erdgas/i.test(lower)) return "CNG";
  if (/wasserstoff|hydrogen/i.test(lower)) return "Hydrogen";
  return raw;
}

function normalizeTransmission(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (/automat/i.test(raw)) return "Automatic";
  if (/manuell|manual|schalt/i.test(raw)) return "Manual";
  return raw;
}

function normalizeBodyType(raw?: string): string | undefined {
  if (!raw) return undefined;
  const mapping: Record<string, string> = {
    Limousine: "Sedan",
    Kombi: "Wagon",
    SUV: "SUV",
    "Geländewagen": "SUV",
    Cabrio: "Convertible",
    Coupé: "Coupe",
    Coupe: "Coupe",
    Van: "Van",
    Kleinwagen: "Hatchback",
    Kompaktwagen: "Hatchback",
    Transporter: "Van",
    EstateCar: "Wagon",
    Roadster: "Roadster",
    SmallCar: "Hatchback",
    Pickup: "Pickup",
  };
  for (const [key, val] of Object.entries(mapping)) {
    if (raw.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return raw;
}

function normalizeColor(raw?: string): string | undefined {
  if (!raw) return undefined;
  const mapping: Record<string, string> = {
    Schwarz: "Black", Weiß: "White", Grau: "Grey", Silber: "Silver",
    Blau: "Blue", Rot: "Red", Grün: "Green", Gelb: "Yellow",
    Orange: "Orange", Braun: "Brown", Beige: "Beige", Gold: "Gold",
    Black: "Black", White: "White", Grey: "Grey", Silver: "Silver",
    Blue: "Blue", Red: "Red", Green: "Green",
  };
  for (const [key, val] of Object.entries(mapping)) {
    if (raw.toLowerCase().includes(key.toLowerCase())) return val;
  }
  return raw;
}

// ---- Similar Ads guard ----
// The VIP response has a `similarAdsInfo` key. We must NEVER extract data from it.
// Our parser only reads from `ad.htmlDescription`, `ad.attributes`, `ad.galleryImages`.

interface SrpItem {
  id: number;
  title?: string;
  shortTitle?: string;
  subTitle?: string;
  make?: string;
  model?: string;
  price?: { grossAmount?: number; grossCurrency?: string; gross?: string };
  attr?: Record<string, string>;
  previewImage?: { src?: string; srcSet?: string };
  numImages?: number;
  relativeUrl?: string;
  category?: string;
}

interface VipAd {
  id?: number;
  title?: string;
  shortTitle?: string;
  subTitle?: string;
  makeKey?: string;
  modelKey?: string;
  price?: { grossAmount?: number; grossCurrency?: string };
  attributes?: Array<{ label?: string; tag?: string; value?: string | string[] }>;
  htmlDescription?: string;
  galleryImages?: Array<{ src?: string; srcSet?: string; thumbnailSrc?: string }>;
  ogImage?: { src?: string; srcSet?: string };
  features?: string[];
  contactInfo?: { location?: string; country?: string; name?: string };
  category?: string;
  make?: string;
  model?: string;
  // ⚠ similarAdsInfo exists but must NEVER be parsed
}

export class MobiledeHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "mobilede";

  constructor(
    private _baseUrl?: string,
    private _filters: Record<string, unknown> = {},
  ) {}

  async discoverListings(
    page: number,
  ): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const searchUrl = buildSearchUrl(page, this._filters);
    const data = (await bffFetch(SRP_PATH, { url: searchUrl })) as {
      searchResults?: {
        items?: SrpItem[];
        numResultsTotal?: number;
        numPages?: number;
        hasNextPage?: boolean;
        page?: number;
      };
    };

    const sr = data.searchResults;
    if (!sr?.items?.length) {
      return {
        listings: [],
        pagination: {
          currentPage: page,
          totalPages: sr?.numPages,
          hasMore: false,
          resultTotal: sr?.numResultsTotal,
        },
      };
    }

    const listings: ListingReference[] = [];
    const seen = new Set<string>();

    for (const item of sr.items) {
      if (item.id == null) continue;
      const id = String(item.id);
      if (!id || id === "0" || id === "undefined" || seen.has(id)) continue;
      seen.add(id);

      listings.push({
        sourceId: id,
        url: mobiledeDetailUrl(id),
        metadata: {
          make: item.make,
          model: item.model,
          title: item.title,
          mileage: parseMileageKm(item.attr?.ml),
          price: item.price?.grossAmount,
          currency: item.price?.grossCurrency || "EUR",
        },
      });
    }

    return {
      listings,
      pagination: {
        currentPage: page,
        totalPages: sr.numPages,
        hasMore: sr.hasNextPage ?? listings.length >= 20,
        resultTotal: sr.numResultsTotal,
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    // Extract ad ID from URL
    let detailUrl = url;
    if (!detailUrl.includes("suchen.mobile.de")) {
      const idMatch = url.match(/(?:id=|details\.html\?id=|\/details\/)(\d+)/);
      const id = idMatch?.[1] || url;
      detailUrl = mobiledeDetailUrl(id);
    }

    const data = await bffFetch(VIP_PATH, { url: detailUrl });
    return {
      url: detailUrl,
      json: data,
      statusCode: 200,
      headers: {},
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const root = fetched.json as { ad?: VipAd } | undefined;
    const ad = root?.ad;
    if (!ad) {
      return {
        sourceId: "unknown",
        sourceUrl: fetched.url,
      };
    }

    const sourceId = String(ad.id ?? fetched.url.match(/id=(\d+)/)?.[1] ?? "unknown");
    const title = ad.title || [ad.shortTitle, ad.subTitle].filter(Boolean).join(" ");
    const make = ad.makeKey || ad.make;
    const model = ad.modelKey || ad.model;

    // Parse structured attributes (ONLY from main ad, never similarAdsInfo)
    const attrMap = new Map<string, string>();
    for (const attr of ad.attributes || []) {
      const tag = attr.tag;
      const val = Array.isArray(attr.value) ? attr.value[0] : attr.value;
      if (tag && val) attrMap.set(tag, val);
    }

    const mileage = parseMileageKm(attrMap.get("mileage"));
    const year = parseYear(attrMap.get("firstRegistration"));
    const fuel = normalizeFuel(attrMap.get("fuel"));
    const transmission = normalizeTransmission(attrMap.get("transmission"));
    const color = normalizeColor(attrMap.get("color") || attrMap.get("manufacturerColorName"));
    const displacement = parseDisplacement(attrMap.get("cubicCapacity"));
    const bodyType = normalizeBodyType(ad.category);

    // Description — extract VIN from main ad description ONLY
    const desc = ad.htmlDescription || "";
    const descText = desc.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    const vin = extractMobiledeVin(descText, JSON.stringify(ad.attributes || []));

    // Price
    const price = ad.price?.grossAmount;
    const currency = ad.price?.grossCurrency || "EUR";

    // Location
    const location = ad.contactInfo?.location;
    const country = ad.contactInfo?.country || GERMANY;

    // Photos — ONLY from ad.galleryImages, never from similarAdsInfo
    const photos: NormalizedPhoto[] = [];
    if (ad.galleryImages) {
      for (let i = 0; i < ad.galleryImages.length; i++) {
        const img = ad.galleryImages[i];
        if (!img) continue;
        const url = bestImageUrl(img);
        if (!url) continue;
        // Only classistatic.de images are actual car photos
        if (!/classistatic\.de/i.test(url)) continue;
        photos.push({
          sourceUrl: url,
          isPrimary: i === 0,
          sortOrder: i,
        });
      }
    }
    // Fallback: ogImage if no gallery
    if (photos.length === 0 && ad.ogImage) {
      const ogUrl = bestImageUrl(ad.ogImage);
      if (ogUrl && /classistatic\.de/i.test(ogUrl)) {
        photos.push({ sourceUrl: ogUrl, isPrimary: true, sortOrder: 0 });
      }
    }

    // First registration event
    const firstReg = attrMap.get("firstRegistration");
    const events: NormalizedListing["events"] = [];
    if (firstReg) {
      const m = firstReg.match(/(\d{2})\/(\d{4})/);
      if (m) {
        const regDate = new Date(Number(m[2]), Number(m[1]) - 1, 1);
        if (!Number.isNaN(regDate.getTime())) {
          events.push({
            eventType: "delivery",
            description: `First registration ${firstReg}`,
            occurredAt: regDate,
          });
        }
      }
    }

    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title,
      price,
      currency,
      mileage,
      mileageUnit: "km",
      location: location || GERMANY,
      country: country || GERMANY,
      vehicle: vehicleFromParts({
        vin,
        make,
        model,
        year,
        fuelType: fuel,
        transmission,
        bodyType,
        color,
        engineDisplacement: displacement,
        country: country || GERMANY,
      }),
      photos,
      events: events.length > 0 ? events : undefined,
    });
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin;
  }

  extractPhotos(listing: NormalizedListing): NormalizedPhoto[] {
    return listing.photos || [];
  }
}
