import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import { UNITED_ARAB_EMIRATES } from "../geo";
import { findVinInListing, normalizeKrVin, parseYear, vehicleFromParts } from "./kr-common";
import { isReasonableDate } from "./listing-dates";
import { moneyListing } from "./us-common";
import { asPhotos, fetchHtml, firstRegEvent, num, str } from "./web-html";

export const CARS24AE_PARSER_VERSION = "cars24ae-v1.2.0";
const BASE = "https://www.cars24.ae";
const MEDIA_BASE = "https://media-ae.cars24.com";

type Cars24Image = {
  path?: string;
  standardised?: { path?: string };
  label?: string;
  category?: string;
  order?: number;
};

type Cars24Content = {
  appointmentId?: string;
  make?: string;
  model?: string;
  year?: string | number;
  variant?: string;
  vin?: string;
  transmissionType?: string;
  color?: string;
  fuelType?: string;
  bodyType?: string;
  driveType?: string;
  city?: string;
  listingActive?: boolean;
  booked?: boolean;
  price?: number;
  targetPrice?: number;
  odometerReading?: number;
  publishedAt?: number | string;
  engineSize?: number | string;
  mainImage?: Cars24Image;
  spinMedia?: {
    exteriorImages?: Cars24Image[];
    interiorImages?: Cars24Image[];
    imperfectImages?: Cars24Image[];
  };
  featureImages?: Cars24Image[];
};

export function cars24aeDetailUrl(id: string): string {
  if (id.startsWith("http")) return id;
  if (id.startsWith("/")) return `${BASE}${id}`;
  if (id.startsWith("buy-used-")) return `${BASE}/${id}`;
  return `${BASE}/buy-used-${id}`;
}

function titleCase(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\b([a-z])/g, (m) => m.toUpperCase());
}

/** Keep short marque codes (MG, BMW, GMC) uppercase. */
function prettyMake(value: string): string {
  const t = value.trim();
  if (t.length <= 3) return t.toUpperCase();
  return titleCase(t);
}

/** Extract the SSR vehicle `content` blob embedded in the detail HTML. */
export function extractCars24Content(html: string): Cars24Content | undefined {
  const marker = html.indexOf('"content":{"appointmentId"');
  if (marker < 0) return undefined;
  const start = marker + '"content":'.length;
  let depth = 0;
  let end = start;
  for (; end < html.length && end < start + 400_000; end++) {
    const ch = html[end];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        end++;
        break;
      }
    }
  }
  if (depth !== 0) return undefined;
  try {
    return JSON.parse(html.slice(start, end)) as Cars24Content;
  } catch {
    return undefined;
  }
}

function imagePath(img?: Cars24Image | null): string | undefined {
  const path = str(img?.standardised?.path) ?? str(img?.path);
  if (!path) return undefined;
  // Skip UI chrome / non-car assets.
  if (/\/(?:icon|favicon|consumer-web|js)\//i.test(path)) return undefined;
  if (/\.(?:svg|gif|eot|woff2?|ttf)(?:$|\?)/i.test(path)) return undefined;
  return path.split("?")[0]!.replace(/&amp;/g, "&");
}

function cars24MediaUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) return path.split("#")[0]!.split("?")[0]!;
  return `${MEDIA_BASE}/${path.replace(/^\//, "")}`;
}

/** Prefer exterior gallery + main shot; fill with interior / features up to 40. */
export function collectCars24Photos(content: Cars24Content): NormalizedPhoto[] {
  const urls: string[] = [];
  const seen = new Set<string>();
  const push = (img?: Cars24Image | null) => {
    const path = imagePath(img);
    if (!path) return;
    const url = cars24MediaUrl(path);
    const key = url.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(url);
  };

  push(content.mainImage);
  const exterior = [...(content.spinMedia?.exteriorImages ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  for (const img of exterior) push(img);
  const interior = [...(content.spinMedia?.interiorImages ?? [])].sort(
    (a, b) => (a.order ?? 0) - (b.order ?? 0),
  );
  for (const img of interior) push(img);
  for (const img of content.featureImages ?? []) push(img);
  for (const img of content.spinMedia?.imperfectImages ?? []) push(img);

  return asPhotos(urls, 40);
}

function cars24Price(content: Cars24Content | undefined, html: string): number | undefined {
  const fromContent = num(content?.price) ?? num(content?.targetPrice);
  if (fromContent != null && fromContent >= 1000) return Math.round(fromContent);

  // Case-sensitive: /i previously matched base64 fragments like "aEd7…" → price 7.
  const m = html.match(/\bAED\s+([\d,]+)/);
  const fromHtml = m ? num(m[1]) : undefined;
  if (fromHtml != null && fromHtml >= 1000) return Math.round(fromHtml);

  const jsonPrice = html.match(/"price"\s*:\s*(\d{4,})/);
  return jsonPrice ? num(jsonPrice[1]) : undefined;
}

function cars24ListedAt(content: Cars24Content | undefined): Date | undefined {
  const raw = content?.publishedAt;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    const d = new Date(raw > 1e12 ? raw : raw * 1000);
    return isReasonableDate(d) ? d : undefined;
  }
  if (typeof raw === "string" && /^\d+$/.test(raw.trim())) {
    const n = Number(raw.trim());
    const d = new Date(n > 1e12 ? n : n * 1000);
    return isReasonableDate(d) ? d : undefined;
  }
  return undefined;
}

export function parseCars24Listing(fetched: FetchedListing): NormalizedListing {
  const html = fetched.html ?? "";
  const content = extractCars24Content(html);
  const sourceId =
    fetched.url.replace(BASE + "/", "").replace(/\/+$/, "").split("?")[0] ||
    (content?.appointmentId ? `buy-used-${content.appointmentId}` : "unknown");

  const make = str(content?.make) ? prettyMake(String(content!.make)) : undefined;
  const model = str(content?.model) ? titleCase(String(content!.model)) : undefined;
  const trim = str(content?.variant) ? titleCase(String(content!.variant)) : undefined;
  const year =
    parseYear(content?.year != null ? String(content.year) : undefined) ??
    parseYear(html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " "));
  const h1 = html
    .match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?.replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const title =
    h1 ||
    [year, make?.toUpperCase(), model?.toUpperCase(), trim?.toUpperCase()].filter(Boolean).join(" ") ||
    sourceId;

  const vin =
    normalizeKrVin(content?.vin) ??
    findVinInListing(html);

  const price = cars24Price(content, html);
  const mileage = num(content?.odometerReading) ?? (() => {
    const km = html.match(/([\d,]+)\s*(?:km|kms|kilometers)/i);
    return km ? num(km[1]) : undefined;
  })();

  const photos = vin ? collectCars24Photos(content ?? {}) : [];
  const listedAt = cars24ListedAt(content);
  const location = content?.city
    ? `${titleCase(content.city)}, ${UNITED_ARAB_EMIRATES}`
    : UNITED_ARAB_EMIRATES;
  const active = content?.listingActive !== false;
  const firstReg = firstRegEvent(content?.year != null ? String(content.year) : undefined);

  const listing = moneyListing({
    sourceId,
    sourceUrl: fetched.url.startsWith("http") ? fetched.url : cars24aeDetailUrl(sourceId),
    title,
    price,
    currency: "AED",
    mileage,
    mileageUnit: "km",
    location,
    country: UNITED_ARAB_EMIRATES,
    sold: !active,
    vehicle: vehicleFromParts({
      vin,
      make,
      model,
      trim,
      year,
      fuelType: str(content?.fuelType),
      transmission: str(content?.transmissionType),
      bodyType: str(content?.bodyType) ? titleCase(String(content!.bodyType)) : undefined,
      driveType: str(content?.driveType),
      engineDisplacement:
        content?.engineSize != null ? String(content.engineSize) : undefined,
      color: str(content?.color),
      country: UNITED_ARAB_EMIRATES,
    }),
    photos,
    events: firstReg ? [firstReg] : undefined,
  });

  if (listedAt) {
    listing.sourceListedAt = listedAt;
    listing.sourceModifiedAt = listedAt;
  }
  return listing;
}

export class Cars24aeHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "cars24ae";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const fetched = await fetchHtml(`${BASE}/buy-used-cars-dubai/?page=${page}`);
    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    const patterns = [
      /href="(https:\/\/www\.cars24\.ae\/buy-used-[^"]+)"/g,
      /href="(\/buy-used-[^"]+)"/g,
    ];
    for (const re of patterns) {
      for (const match of fetched.text.matchAll(re)) {
        const href = match[1]!.split("?")[0]!.replace(/\/+$/, "");
        const url = href.startsWith("http") ? href : `${BASE}${href}`;
        const id = url.replace(BASE + "/", "").replace(/\/+$/, "");
        if (!id || seen.has(id) || /buy-used-cars-/i.test(id)) continue;
        seen.add(id);
        listings.push({ sourceId: id, url: `${url}/` });
      }
    }
    return { listings, pagination: { currentPage: page, hasMore: listings.length >= 12 } };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url);
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    return parseCars24Listing(fetched);
  }
}
