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
import { applyTitleTrimEnrichment, cleanEngineDisplacement, extraSpecEvent } from "./title-enrichment";
import { asPhotos, carpagesInventoryId, extractCarpagesInventoryPhotos, fetchHtml, firstRegEvent, num, str } from "./web-html";
import { withCountry } from "../geo";

export const CARPAGES_PARSER_VERSION = "carpages-v1.2.1";
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
  "volvo",
  "porsche",
  "tesla",
  "acura",
  "infiniti",
  "land-rover",
  "chrysler",
  "buick",
  "cadillac",
  "mini",
  "mitsubishi",
  "lincoln",
  "genesis",
  "jaguar",
  "alfa-romeo",
  "maserati",
  "bentley",
  "rolls-royce",
  "fiat",
  "peugeot",
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
  fuelType?: string;
  transmission?: string;
  engine?: string;
  trim?: string;
  bodyType?: string;
  color?: string;
  driveType?: string;
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
        const engineRaw = rec.vehicleEngine;
        let engine: string | undefined;
        if (typeof engineRaw === "string") engine = engineRaw;
        else if (engineRaw && typeof engineRaw === "object") {
          const eng = engineRaw as Record<string, unknown>;
          engine = str(eng.name) ?? str(eng.engineDisplacement) ?? str(eng.description);
        }
        return {
          name: str(rec.name),
          make,
          model: str(rec.model),
          year: num(rec.modelDate) ?? parseYear(str(rec.modelDate) ?? str(rec.name)),
          vin: str(rec.vehicleIdentificationNumber),
          mileage: num(mileageRaw),
          price: num(offers?.price),
          fuelType: str(rec.fuelType),
          transmission: str(rec.vehicleTransmission),
          engine,
          trim: str(rec.vehicleConfiguration) ?? str(rec.trim),
          bodyType: str(rec.bodyType),
          color: str(rec.color),
          driveType: str(rec.driveWheelConfiguration),
        };
      }
    } catch {
      // ignore malformed ld+json
    }
  }
  return {};
}

/** Visible labeled specs — known fields + leftovers go to extras. */
function pairedSpecs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re =
    /<(?:dt|th|span|div|p|li)[^>]*>\s*(VIN|Stock\s*#?|Mileage|Kilometres|Kilometers|Odometer|Body(?:\s*Style)?|Exterior\s*Colou?r|Interior\s*Colou?r|Transmission|Fuel(?:\s*Type)?|Drivetrain|Engine|Doors|Cylinders|Passengers|Trim|Condition|Year|Make|Model)\s*:?\s*<\/(?:dt|th|span|div|p|li)>\s*<(?:dd|td|span|div|p)[^>]*>\s*([^<]{1,120})/gi;
  for (const m of html.matchAll(re)) {
    const key = m[1]!.replace(/\s+/g, " ").trim().toLowerCase();
    const val = m[2]!.replace(/\s+/g, " ").trim();
    if (val) out[key] = val;
  }
  return out;
}

function cleanTitle(raw?: string): string | undefined {
  const title = raw?.replace(/\s+/g, " ").trim();
  if (!title || /outdated browser/i.test(title)) return undefined;
  return title.replace(/\s*\|\s*Carpages\.ca\s*$/i, "").trim() || undefined;
}

export class CarpagesHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "carpages";
  private exhaustedMakes = new Set<string>();
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    const push = (url: string) => {
      const clean = url.split("?")[0]!.replace(/\/$/, "");
      const path = clean.replace(`${BASE}/`, "").replace(/^\//, "");
      if (!path || path.includes("used-cars/search")) return;
      if (!/\/used-cars\/[^/]+\/[^/]+\/\d{4}-/i.test(clean)) return;
      // Stable inventory id — slug/city changes must not create a second listing.
      const sourceId = carpagesInventoryId(path) ?? carpagesInventoryId(clean) ?? path;
      if (seen.has(sourceId)) return;
      seen.add(sourceId);
      listings.push({ sourceId, url: clean.startsWith("http") ? clean : `${BASE}/${path}` });
    };

    if (page === 1) {
      const rss = await fetchHtml(`${BASE}/rss/recently_listed/`);
      for (const match of rss.text.matchAll(/https:\/\/www\.carpages\.ca\/used-cars\/[^<\s"]+/g)) {
        push(match[0]!);
      }
    }

    const make = CARPAGES_MAKES[(page - 1) % CARPAGES_MAKES.length]!;
    const makePage = Math.floor((page - 1) / CARPAGES_MAKES.length) + 1;
    const before = listings.length;
    const fetched = await fetchHtml(`${BASE}/used-cars/${make}/?page=${makePage}`);
    for (const match of fetched.text.matchAll(/\/used-cars\/[a-z0-9-]+\/[a-z0-9-]+\/\d{4}-[a-z0-9-]+-\d+\/?/g)) {
      push(`${BASE}${match[0]}`);
    }
    const makeHits = listings.length - before;
    if (makeHits < 5) this.exhaustedMakes.add(make);
    else this.exhaustedMakes.delete(make);

    return {
      listings,
      pagination: {
        currentPage: page,
        hasMore: this.exhaustedMakes.size < CARPAGES_MAKES.length && makePage <= 400,
      },
    };
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
    const pathId = fetched.url.replace(BASE + "/", "").replace(/\/$/, "").split("?")[0] || "unknown";
    const slug = parseCarpagesSlug(fetched.url);
    const ld = parseJsonLd(html);
    const specs = pairedSpecs(html);

    const title =
      cleanTitle(meta(html, "og:title")) ??
      cleanTitle(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]) ??
      ld.name ??
      [slug.year, slug.make, slug.model].filter(Boolean).join(" ");

    const vin = ld.vin ?? specs.vin ?? findVinInListing(html);
    const km =
      html.match(/twitter:data2"[^>]+content="([\d,]+)\s*KM/i) ??
      html.match(/([\d,]+)\s*KM/i);
    const price =
      ld.price ??
      num(meta(html, "twitter:data1")?.replace(/[^\d.]/g, "")) ??
      num(html.match(/\$\s*([\d,]+)/)?.[1]);

    const year = ld.year ?? num(specs.year) ?? slug.year ?? parseYear(title);
    const make = ld.make ?? specs.make ?? slug.make;
    const model = ld.model ?? specs.model ?? slug.model;
    const fuelType = ld.fuelType ?? specs["fuel type"] ?? specs.fuel;
    const transmission = ld.transmission ?? specs.transmission;
    const bodyType = ld.bodyType ?? specs["body style"] ?? specs.body;
    const color =
      ld.color ??
      specs["exterior colour"] ??
      specs["exterior color"] ??
      html.match(/Used\s+([A-Za-z]+)\s+\d{4}/)?.[1];
    const driveType = ld.driveType ?? specs.drivetrain;
    const engine = cleanEngineDisplacement(ld.engine ?? specs.engine);
    const enriched = applyTitleTrimEnrichment(title, {
      year,
      make,
      model,
      trim: ld.trim ?? specs.trim,
      engineDisplacement: engine,
    });
    const location = withCountry([slug.city, slug.province].filter(Boolean).join(", "), CANADA);

    const inventoryId = carpagesInventoryId(pathId) ?? carpagesInventoryId(fetched.url);
    const sourceId = inventoryId ?? pathId;
    // Keep inventory-id photo filter — do not broaden collectors.
    const photos = vin && inventoryId
      ? asPhotos(extractCarpagesInventoryPhotos(html, inventoryId, 40), 40)
      : [];
    const firstReg = firstRegEvent(year);
    const knownSpecKeys = new Set([
      "vin",
      "year",
      "make",
      "model",
      "trim",
      "engine",
      "fuel",
      "fuel type",
      "transmission",
      "body",
      "body style",
      "drivetrain",
      "exterior colour",
      "exterior color",
      "condition",
      "stock #",
      "stock",
      "mileage",
      "kilometres",
      "kilometers",
      "odometer",
    ]);
    const events = [
      firstReg,
      extraSpecEvent("carpages", "condition", "Condition", specs.condition),
      extraSpecEvent("carpages", "stock_number", "Stock #", specs["stock #"] ?? specs.stock),
      ...Object.entries(specs)
        .filter(([key]) => !knownSpecKeys.has(key))
        .map(([key, val]) =>
          extraSpecEvent("carpages", key.replace(/\s+/g, "_"), key.replace(/\b\w/g, (c) => c.toUpperCase()), val),
        ),
    ].filter((e): e is NonNullable<typeof e> => Boolean(e));

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
        model: enriched.model,
        trim: enriched.trim,
        year,
        fuelType,
        transmission,
        bodyType,
        driveType,
        color,
        engineDisplacement: enriched.engineDisplacement,
        country: CANADA,
      }),
      photos,
      events: events.length ? events : undefined,
    });
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin;
  }

  extractPhotos(listing: NormalizedListing): NormalizedPhoto[] {
    return listing.photos ?? [];
  }
}