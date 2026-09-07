import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import { withCountry } from "../geo";
import { findVinInListing, normalizeKrVin, parseYear, vehicleFromParts } from "./kr-common";
import { CANADA, moneyListing } from "./us-common";
import { asPhotos, carpagesInventoryId, extractCarpagesInventoryPhotos, fetchHtml, firstRegEvent, num, str } from "./web-html";

export const ONTARIOCARS_PARSER_VERSION = "ontariocars-v1.0.1";
const BASE = "https://www.ontariocars.ca";

/**
 * Plain /inventory/?dsp_page=N dies around ~10k (ES window). Shard by make +
 * truck/commercial categories so discovery stays inside that window.
 */
const DISCOVER_MAKES = [
  "Toyota",
  "Honda",
  "Ford",
  "Chevrolet",
  "Hyundai",
  "Kia",
  "Nissan",
  "Mazda",
  "BMW",
  "Mercedes-Benz",
  "Audi",
  "Volkswagen",
  "Jeep",
  "GMC",
  "Ram",
  "Dodge",
  "Subaru",
  "Lexus",
  "Chrysler",
  "Mitsubishi",
  "Buick",
  "Cadillac",
  "Volvo",
  "Porsche",
  "Tesla",
  "Acura",
  "Infiniti",
  "Lincoln",
  "Mini",
  "Land Rover",
];

/** Extra shards so pickups / commercial trucks are covered even when make lists are car-heavy. */
const DISCOVER_CATEGORIES = [
  "Pickup Truck",
  "Commercial",
  "Commercial Van",
  "Box Truck",
  "Dump Truck",
  "Straight Truck",
  "Service Truck",
  "Bucket Truck",
  "Cab And Chassis",
  "Minivan / Van",
];

const LISTING_RE = /\/inventory\/((?:19|20)\d{2}-[a-z0-9-]+\/\d{5,})\/?/gi;

export function ontariocarsDetailUrl(idOrUrl: string): string {
  const raw = idOrUrl.trim();
  if (raw.startsWith("http")) return raw.split("?")[0]!.replace(/\/$/, "");
  if (raw.startsWith("/")) return `${BASE}${raw.split("?")[0]!.replace(/\/$/, "")}`;
  if (raw.includes("/")) return `${BASE}/inventory/${raw.replace(/^inventory\//i, "").replace(/\/$/, "")}`;
  // Numeric id alone redirects to the search index — require slug/id path.
  return `${BASE}/inventory/${raw}`;
}

function sourceIdFromUrl(url: string): string {
  const m = url.match(/\/inventory\/((?:19|20)\d{2}-[a-z0-9-]+\/\d{5,})\/?/i);
  if (m?.[1]) return m[1];
  return url.replace(BASE + "/", "").replace(/^\/+/, "").replace(/\/$/, "").split("?")[0] || "unknown";
}

function parseSlug(path: string): { year?: number; make?: string; model?: string; id?: string } {
  const m = path.match(/^((?:19|20)\d{2})-([a-z0-9-]+)\/(\d{5,})$/i);
  if (!m) return {};
  const year = Number(m[1]);
  const rest = m[2]!.toLowerCase();
  const multi = ["mercedes-benz", "land-rover", "alfa-romeo", "rolls-royce", "aston-martin"].find(
    (name) => rest === name || rest.startsWith(`${name}-`),
  );
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
  const titleCase = (s?: string) =>
    s
      ?.split("-")
      .filter(Boolean)
      .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
      .join(" ");
  return { year, make: titleCase(makeSlug), model: titleCase(modelSlug), id: m[3] };
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

function dataAttr(html: string, name: string): string | undefined {
  const re = new RegExp(`data-${name}=["']([^"']+)["']`, "i");
  return html.match(re)?.[1]?.trim();
}

function pairedSpecs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re =
    /<(?:dt|th|span|div|p)[^>]*>\s*(VIN|Stock\s*#?|Mileage|Kilometres|Kilometers|Odometer|Body(?:\s*Style)?|Exterior\s*Colou?r|Interior\s*Colou?r|Transmission|Fuel(?:\s*Type)?|Drivetrain|Engine|Doors|Trim|Condition|Year|Make|Model)\s*:?\s*<\/(?:dt|th|span|div|p)>\s*<(?:dd|td|span|div|p)[^>]*>\s*([^<]{1,120})/gi;
  for (const m of html.matchAll(re)) {
    const key = m[1]!.replace(/\s+/g, " ").trim().toLowerCase();
    const val = m[2]!.replace(/\s+/g, " ").trim();
    if (val) out[key] = val;
  }
  return out;
}

function parseOgTitle(og?: string): {
  year?: number;
  make?: string;
  model?: string;
  price?: number;
  mileage?: number;
  city?: string;
  bodyType?: string;
} {
  if (!og) return {};
  // Used 2018 Mitsubishi Outlander PHEV in Waterloo, Ontario. Selling for $19,995 with only 79,888 KM. View this Used SUV / Crossover ...
  const head = og.match(
    /(?:Used|New)\s+((?:19|20)\d{2})\s+(.+?)\s+in\s+([^,]+),\s*Ontario/i,
  );
  const price = num(og.match(/\$\s*([\d,]+)/)?.[1]);
  const mileage = num(og.match(/([\d,]+)\s*KM/i)?.[1]);
  const body = og.match(/Used\s+([^.(]+?)\s+and contact/i)?.[1]?.trim();
  let make: string | undefined;
  let model: string | undefined;
  if (head?.[2]) {
    const parts = head[2].trim().split(/\s+/);
    make = parts[0];
    model = parts.slice(1).join(" ") || undefined;
  }
  return {
    year: head?.[1] ? Number(head[1]) : undefined,
    make,
    model,
    price,
    mileage,
    city: head?.[3]?.trim(),
    bodyType: body,
  };
}

function buildListUrl(shard: { kind: "make" | "category"; value: string }, shardPage: number): string {
  const params = new URLSearchParams();
  if (shard.kind === "make") params.set("dsp_make", shard.value);
  else params.set("category", shard.value);
  if (shardPage > 1) params.set("dsp_page", String(shardPage));
  return `${BASE}/inventory/?${params.toString()}`;
}

function shardsFromFilters(filters: Record<string, unknown>): { kind: "make" | "category"; value: string }[] {
  const makes = Array.isArray(filters.makes)
    ? filters.makes.map((m) => str(m)).filter(Boolean) as string[]
    : DISCOVER_MAKES;
  const categories = Array.isArray(filters.categories)
    ? filters.categories.map((c) => str(c)).filter(Boolean) as string[]
    : DISCOVER_CATEGORIES;
  return [
    ...makes.map((value) => ({ kind: "make" as const, value })),
    ...categories.map((value) => ({ kind: "category" as const, value })),
  ];
}

export class OntariocarsHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "ontariocars";
  constructor(
    private _baseUrl?: string,
    private filters: Record<string, unknown> = {},
  ) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const shards = shardsFromFilters(this.filters);
    const shard = shards[(page - 1) % shards.length]!;
    const shardPage = Math.floor((page - 1) / shards.length) + 1;
    const listUrl = buildListUrl(shard, shardPage);

    const fetched = await fetchHtml(listUrl, {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-CA,en;q=0.9",
      Referer: `${BASE}/inventory/`,
    });

    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const match of fetched.text.matchAll(LISTING_RE)) {
      const path = match[1]!;
      if (seen.has(path)) continue;
      seen.add(path);
      listings.push({
        sourceId: path,
        url: `${BASE}/inventory/${path}`,
      });
    }

    return {
      listings,
      pagination: {
        currentPage: page,
        // Soft stop when a shard page is empty/thin (past ES window or exhausted).
        hasMore: listings.length >= 10,
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url, {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-CA,en;q=0.9",
      Referer: `${BASE}/inventory/`,
    });
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const sourceId = sourceIdFromUrl(fetched.url);
    const slug = parseSlug(sourceId);
    const specs = pairedSpecs(html);
    const og = parseOgTitle(meta(html, "og:title") ?? meta(html, "og:description"));

    const vinRaw =
      dataAttr(html, "vin") ??
      specs.vin ??
      html.match(/data-field-name=["']vin["'][^>]*value=["']([^"']+)["']/i)?.[1] ??
      findVinInListing(html);
    const vin = normalizeKrVin(vinRaw);

    const price =
      num(dataAttr(html, "price-pre-tax")) ??
      num(
        (() => {
          try {
            const raw = dataAttr(html, "price-tax-details");
            if (!raw) return undefined;
            const j = JSON.parse(raw.replace(/&quot;/g, '"').replace(/&amp;/g, "&")) as Record<string, unknown>;
            return j.price ?? j.lowest_pretax ?? j.paymentPrice;
          } catch {
            return undefined;
          }
        })(),
      ) ??
      og.price ??
      num(html.match(/\$\s*([\d,]+)/)?.[1]);

    const mileage =
      num(specs.mileage?.replace(/[^\d]/g, "")) ??
      num(specs.kilometres?.replace(/[^\d]/g, "")) ??
      num(specs.kilometers?.replace(/[^\d]/g, "")) ??
      og.mileage ??
      num(html.match(/([\d,]+)\s*KM/i)?.[1]);

    const year =
      num(dataAttr(html, "year")) ??
      num(specs.year) ??
      slug.year ??
      og.year ??
      parseYear(meta(html, "og:title"));

    const modelAttr = dataAttr(html, "model"); // e.g. "Mitsubishi + Outlander PHEV"
    let make = specs.make ?? slug.make ?? og.make;
    let model = specs.model ?? slug.model ?? og.model;
    if (modelAttr?.includes("+")) {
      const [mMake, ...rest] = modelAttr.split("+").map((s) => s.trim());
      make = make || mMake;
      model = model || rest.join(" ").trim() || undefined;
    }

    const bodyType = specs["body style"] ?? specs.body ?? og.bodyType;
    const color = specs["exterior colour"] ?? specs["exterior color"];
    const transmission = specs.transmission;
    const fuelType = specs["fuel type"] ?? specs.fuel;
    const location = withCountry([og.city, "Ontario"].filter(Boolean).join(", "), CANADA);

    const title =
      meta(html, "og:title")
        ?.replace(/\s*\|\s*OntarioCars\.ca.*$/i, "")
        .replace(/\s+/g, " ")
        .trim() ??
      [year, make, model].filter(Boolean).join(" ");

    // Carpages CDN embeds related-vehicle thumbs on the same page — keep only this inventory id.
    const inventoryId = carpagesInventoryId(sourceId) ?? slug.id;
    const photos = vin && inventoryId
      ? asPhotos(extractCarpagesInventoryPhotos(html, inventoryId, 40), 40)
      : [];

    const firstReg = firstRegEvent(year);

    return moneyListing({
      sourceId,
      sourceUrl: ontariocarsDetailUrl(sourceId),
      title,
      price,
      currency: "CAD",
      mileage,
      mileageUnit: "km",
      location,
      country: CANADA,
      vehicle: vehicleFromParts({
        vin,
        make,
        model,
        year,
        trim: specs.trim,
        bodyType,
        color,
        transmission,
        fuelType,
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
