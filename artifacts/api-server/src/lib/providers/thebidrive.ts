import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedEvent,
  NormalizedListing,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import { CANADA, SOUTH_KOREA, UNITED_STATES, withCountry } from "../geo";
import {
  normalizeEuBodyType,
  normalizeEuColor,
  normalizeEuFuel,
  normalizeEuTransmission,
} from "./eu-locale";
import { findVinInListing, normalizeKrVin, parseYear, vehicleFromParts, vinCheckDigitOk } from "./kr-common";
import { moneyListing } from "./us-common";
import {
  asPhotos,
  cleanPhotoUrl,
  fetchHtml,
  firstRegEvent,
  isFirstRegistrationEvent,
  num,
  productionFirstRegEvent,
  str,
} from "./web-html";

export const THEBIDRIVE_PARSER_VERSION = "thebidrive-v1.0.4";
const BASE = "https://thebidrive.com";
const EN = `${BASE}/en`;

const MAKES = [
  "ford",
  "chevrolet",
  "toyota",
  "honda",
  "nissan",
  "hyundai",
  "kia",
  "jeep",
  "dodge",
  "bmw",
  "gmc",
  "mercedes-benz",
  "volkswagen",
  "subaru",
  "ram",
  "mazda",
  "lexus",
  "audi",
  "tesla",
  "chrysler",
  "buick",
  "cadillac",
  "infiniti",
  "acura",
  "land-rover",
  "porsche",
  "volvo",
  "mini",
  "genesis",
  "lincoln",
  "mitsubishi",
  "jaguar",
];

const LIST_HEADERS = {
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  Referer: `${EN}/`,
};

export function thebidriveDetailUrl(idOrUrl: string): string {
  const raw = idOrUrl.trim();
  if (raw.startsWith("http")) return raw.split("?")[0]!.replace(/\/$/, "");
  if (raw.startsWith("/")) {
    if (raw.startsWith("/en/")) return `${BASE}${raw}`.replace(/\/$/, "");
    return `${EN}${raw}`.replace(/\/$/, "");
  }
  if (/^(lot|listing)\//i.test(raw)) return `${EN}/${raw}`.replace(/\/$/, "");
  return `${EN}/listing/${raw}`.replace(/\/$/, "");
}

function sourceIdFromUrl(url: string): string {
  const m = url.match(/\/(lot|listing)\/([a-f0-9-]{36})(?:\/([a-z0-9-]+))?/i);
  if (!m) return url.replace(BASE, "").replace(/^\/en\//, "").replace(/^\//, "").split("?")[0] || "unknown";
  const kind = m[1]!.toLowerCase();
  const id = m[2]!;
  const slug = m[3] || "";
  return slug ? `${kind}/${id}/${slug}` : `${kind}/${id}`;
}

function isAuctionPath(path: string): boolean {
  return /(?:^|\/)lot\//i.test(path);
}

function vinFromSlug(slug?: string): string | undefined {
  if (!slug) return undefined;
  const tail = slug.split("-").pop();
  const vin = normalizeKrVin(tail);
  return vin && vin.length === 17 && vinCheckDigitOk(vin) ? vin : undefined;
}

function parseLdCar(html: string): Record<string, unknown> | undefined {
  for (const block of html.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    try {
      const parsed = JSON.parse(block[1]!);
      const nodes = Array.isArray(parsed)
        ? parsed
        : [parsed, ...((parsed as { "@graph"?: unknown[] })["@graph"] ?? [])];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const rec = node as Record<string, unknown>;
        const type = String(rec["@type"] ?? "");
        if (/^(Car|Vehicle|Product)$/i.test(type) || rec.vehicleIdentificationNumber) return rec;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

function visibleSpecs(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of html.matchAll(
    /<div[^>]*class="[^"]*text-muted[^"]*"[^>]*>([^<]{2,40})<\/div>\s*<div[^>]*class="[^"]*font-medium[^"]*"[^>]*>([^<]{1,120})<\/div>/gi,
  )) {
    const key = m[1]!.replace(/\s+/g, " ").trim();
    const val = m[2]!
      .replace(/&#x27;/g, "'")
      .replace(/&amp;/g, "&")
      .replace(/\s+/g, " ")
      .trim();
    if (key && val && !/^n\/?a$/i.test(val) && val !== "—") out[key] = val;
  }
  return out;
}

function cleanVin(raw?: string | null): string | undefined {
  if (!raw || /\*/.test(raw)) return undefined;
  const vin = normalizeKrVin(raw);
  if (!vin || vin.length !== 17) return undefined;
  return vinCheckDigitOk(vin) ? vin : vin;
}

function inferCountry(html: string, cdnUrls: string[]): string {
  const blob = `${html.slice(0, 8000)} ${cdnUrls.slice(0, 3).join(" ")}`.toLowerCase();
  if (/\/encar\/|autowini|kbcha|korea/.test(blob)) return SOUTH_KOREA;
  if (/\/copart\/|\/iaai\/|salvage|united states|\busa\b/.test(blob)) return UNITED_STATES;
  if (/canada|\/carpages\//.test(blob)) return CANADA;
  return UNITED_STATES;
}

function mileageOf(ld: Record<string, unknown> | undefined, specs: Record<string, string>): number | undefined {
  const odo = ld?.mileageFromOdometer;
  if (odo && typeof odo === "object") {
    const n = num((odo as Record<string, unknown>).value);
    if (n != null) return n;
  }
  return num(specs.Mileage ?? specs.Odometer);
}

function mileageUnitOf(ld: Record<string, unknown> | undefined, specs: Record<string, string>): "km" | "mi" {
  const odo = ld?.mileageFromOdometer;
  if (odo && typeof odo === "object") {
    const unit = String((odo as Record<string, unknown>).unitCode ?? "").toUpperCase();
    if (unit === "SMI" || unit === "MI") return "mi";
  }
  if (/\bmi\b/i.test(specs.Mileage ?? specs.Odometer ?? "")) return "mi";
  return "km";
}

function priceOf(ld: Record<string, unknown> | undefined, html: string): { price?: number; currency: string } {
  const offers = ld?.offers && typeof ld.offers === "object" ? (ld.offers as Record<string, unknown>) : undefined;
  const price = num(offers?.price) ?? num(html.match(/"price"\s*:\s*(\d+)/)?.[1]);
  const currency = str(offers?.priceCurrency)?.toUpperCase() ?? "USD";
  return { price, currency };
}

function isSold(ld: Record<string, unknown> | undefined, specs: Record<string, string>, html: string): boolean {
  const offers = ld?.offers && typeof ld.offers === "object" ? (ld.offers as Record<string, unknown>) : undefined;
  const availability = String(offers?.availability ?? "");
  if (/SoldOut|OutOfStock/i.test(availability)) return true;
  const status = specs.Status ?? specs["Run status"] ?? "";
  if (/^sold$/i.test(status) || /withdrawn|ended/i.test(status)) return true;
  if (/\"status\"\s*:\s*\"sold\"/i.test(html.slice(0, 50_000))) return true;
  return false;
}

/** Drop Similar / related cards so their CDN thumbs never enter the gallery scan. */
export function stripThebidriveRelatedHtml(html: string): string {
  const cut = html.search(
    /<!--\s*Similar\s+Lots\s*-->|Similar\s+Lots|Similar\s+Cars|Suggested\s+(?:Cars|Lots|Vehicles)|You\s+may\s+also|Related\s+(?:Lots|Cars|Vehicles)/i,
  );
  return cut > 0 ? html.slice(0, cut) : html;
}

function galleryKeys(urls: string[]): Set<string> {
  const keys = new Set<string>();
  for (const u of urls) {
    const ic = u.match(/\/catalog\/(IC\d+)\//i)?.[1];
    if (ic) keys.add(`ic:${ic.toUpperCase()}`);
    const ci = u.match(/\/car\/(CI\d+)\//i)?.[1];
    if (ci) keys.add(`ci:${ci.toUpperCase()}`);
    const encar = u.match(/ci\.encar\.com\/carpicture\/[^/]+\/(pic\d+)\/(\d+)_/i);
    if (encar) keys.add(`encar:${encar[1]!.toLowerCase()}/${encar[2]}`);
    // Lot auction CDN: cdn.thebidrive.com/lots/{uuid}/ or similar
    const lot = u.match(/cdn\.thebidrive\.com\/(?:lots?|auctions?)\/([a-f0-9-]{36})\//i);
    if (lot) keys.add(`lot:${lot[1]!.toLowerCase()}`);
    // Vendor numeric folders: cdn.thebidrive.com/encar/{id}/… (unkeyed Similar thumbs).
    const bd = u.match(/cdn\.thebidrive\.com\/(encar|copart|iaa|iaai|carpages)\/(\d{4,})\//i);
    if (bd) keys.add(`bd:${bd[1]!.toLowerCase()}:${bd[2]}`);
    const iaaiKeys = u.match(/[?&]imageKeys=([^&]+)/i)?.[1];
    if (iaaiKeys && /vis\.iaai\.com/i.test(u)) {
      // Stock id is the segment before ~SID~ — scope the whole lot, not one frame.
      const stock = decodeURIComponent(iaaiKeys).split("~")[0]?.trim();
      if (stock) keys.add(`iaai:${stock.toLowerCase()}`);
    }
  }
  return keys;
}

function urlMatchesGalleryKeys(url: string, keys: Set<string>): boolean {
  if (keys.size === 0) return false;
  const ic = url.match(/\/catalog\/(IC\d+)\//i)?.[1];
  if (ic && keys.has(`ic:${ic.toUpperCase()}`)) return true;
  const ci = url.match(/\/car\/(CI\d+)\//i)?.[1];
  if (ci && keys.has(`ci:${ci.toUpperCase()}`)) return true;
  const encar = url.match(/ci\.encar\.com\/carpicture\/[^/]+\/(pic\d+)\/(\d+)_/i);
  if (encar && keys.has(`encar:${encar[1]!.toLowerCase()}/${encar[2]}`)) return true;
  const lot = url.match(/cdn\.thebidrive\.com\/(?:lots?|auctions?)\/([a-f0-9-]{36})\//i);
  if (lot && keys.has(`lot:${lot[1]!.toLowerCase()}`)) return true;
  const bd = url.match(/cdn\.thebidrive\.com\/(encar|copart|iaa|iaai|carpages)\/(\d{4,})\//i);
  if (bd && keys.has(`bd:${bd[1]!.toLowerCase()}:${bd[2]}`)) return true;
  const iaaiKeys = url.match(/[?&]imageKeys=([^&]+)/i)?.[1];
  if (iaaiKeys && /vis\.iaai\.com/i.test(url)) {
    const stock = decodeURIComponent(iaaiKeys).split("~")[0]?.trim();
    if (stock && keys.has(`iaai:${stock.toLowerCase()}`)) return true;
  }
  return false;
}

/** Exported for tests — LD/og seeds + same-catalog CDN only (never Similar thumbs). */
export function galleryUrls(html: string, ld: Record<string, unknown> | undefined, _sourceId?: string): string[] {
  const scoped = stripThebidriveRelatedHtml(html);
  const fromLd: string[] = [];
  const image = ld?.image;
  if (typeof image === "string") fromLd.push(image);
  else if (Array.isArray(image)) {
    for (const item of image) {
      if (typeof item === "string") fromLd.push(item);
      else if (item && typeof item === "object") {
        const u = str((item as Record<string, unknown>).url) ?? str((item as Record<string, unknown>).contentUrl);
        if (u) fromLd.push(u);
      }
    }
  }

  const og =
    scoped.match(/property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] ??
    scoped.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i)?.[1];
  const seeds = [...fromLd, ...(og ? [og] : [])]
    .map((u) => cleanPhotoUrl(u))
    .filter((u) => /^https?:\/\//i.test(u));

  // Detail pages preload "Similar" thumbs under the same vendor CDN
  // (cdn.thebidrive.com/autowini/catalog/OTHER_IC/… or /encar/OTHER_ID/…).
  // Only keep folders that appear on THIS vehicle's LD/og seeds, then expand.
  const keys = galleryKeys(seeds);
  if (keys.size === 0) return [...new Set(seeds)];

  const pageImgs = [
    ...scoped.matchAll(
      /https:\/\/(?:cdn\.thebidrive\.com|imagebox\.autowini\.com|ci\.encar\.com|vis\.iaai\.com)\/[^"'\\\s>]+/gi,
    ),
  ]
    .map((m) => cleanPhotoUrl(m[0]!))
    .filter((u) => /\.(?:webp|jpg|jpeg|png|avif)(\?|$)/i.test(u) || /vis\.iaai\.com\/resizer/i.test(u));

  const matched = pageImgs.filter((u) => urlMatchesGalleryKeys(u, keys));
  return [...new Set([...seeds, ...matched])];
}

function buildEvents(input: {
  year?: number;
  sold: boolean;
  price?: number;
  currency: string;
  specs: Record<string, string>;
  engineStart?: string;
}): NormalizedEvent[] {
  const events: NormalizedEvent[] = [];
  const firstReg =
    firstRegEvent(input.specs["First registration"] ?? input.specs["Registration"]) ??
    productionFirstRegEvent(input.year);
  if (firstReg) events.push(firstReg);

  const damage =
    input.specs["Primary damage"] ??
    input.specs.Damage ??
    input.specs["Secondary damage"];
  if (damage) {
    events.push({
      eventType: "accident",
      description: `Damage: ${damage}`,
      occurredAt: new Date(),
      metadata: { source: "thebidrive", kind: "damage", value: damage },
    });
  }

  if (input.engineStart && /won'?t start|does not start|no start/i.test(input.engineStart)) {
    events.push({
      eventType: "other",
      description: `Engine start: ${input.engineStart}`,
      occurredAt: new Date(),
      metadata: { source: "thebidrive", kind: "engineStart", value: input.engineStart },
    });
  }

  if (input.sold && input.price != null) {
    events.push({
      eventType: "sale",
      description: `Sold for ${input.currency} ${input.price}`,
      occurredAt: new Date(),
      metadata: {
        source: "thebidrive",
        priceAmount: input.price,
        priceCurrency: input.currency,
        amount: input.price,
        currency: input.currency,
      },
    });
  }

  return events;
}

type DiscoverChannel = "auctions" | "marketplaces" | "auction-make" | "sitemap";

function discoverShards(filters: Record<string, unknown>): Array<{ channel: DiscoverChannel; value?: string }> {
  const channels = Array.isArray(filters.channels)
    ? (filters.channels as unknown[]).map((c) => String(c).toLowerCase())
    : ["auctions", "marketplaces", "auction-make", "sitemap"];
  const shards: Array<{ channel: DiscoverChannel; value?: string }> = [];
  if (channels.includes("auctions")) shards.push({ channel: "auctions" });
  if (channels.includes("marketplaces")) shards.push({ channel: "marketplaces" });
  if (channels.includes("auction-make") || channels.includes("makes")) {
    for (const make of MAKES) shards.push({ channel: "auction-make", value: make });
  }
  if (channels.includes("sitemap")) {
    for (let i = 0; i < 178; i++) shards.push({ channel: "sitemap", value: String(i) });
  }
  return shards.length ? shards : [{ channel: "auctions" }, { channel: "marketplaces" }];
}

function listUrl(shard: { channel: DiscoverChannel; value?: string }, page: number): string {
  if (shard.channel === "auctions") {
    return page <= 1 ? `${EN}/auctions` : `${EN}/auctions?page=${page}`;
  }
  if (shard.channel === "marketplaces") {
    return page <= 1 ? `${EN}/marketplaces` : `${EN}/marketplaces?page=${page}`;
  }
  if (shard.channel === "auction-make") {
    const make = shard.value || "ford";
    return page <= 1 ? `${EN}/auctions/${make}` : `${EN}/auctions/${make}?page=${page}`;
  }
  return `${BASE}/listings/sitemap/${shard.value || "0"}.xml`;
}

function extractRefs(html: string, isXml = false): ListingReference[] {
  const listings: ListingReference[] = [];
  const seen = new Set<string>();
  const re = isXml
    ? /https:\/\/thebidrive\.com\/(?:en\/)?(lot|listing)\/([a-f0-9-]{36})\/([a-z0-9-]+)/gi
    : /\/(?:en\/)?(lot|listing)\/([a-f0-9-]{36})\/([a-z0-9-]+)/gi;

  for (const m of html.matchAll(re)) {
    const kind = m[1]!.toLowerCase();
    const id = m[2]!;
    const slug = m[3]!;
    const sourceId = `${kind}/${id}/${slug}`;
    if (seen.has(sourceId)) continue;
    seen.add(sourceId);
    listings.push({
      sourceId,
      url: `${EN}/${kind}/${id}/${slug}`,
    });
  }
  return listings;
}

export class ThebidriveHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "thebidrive";
  private exhaustedShards = new Set<string>();
  constructor(
    private _baseUrl?: string,
    private filters: Record<string, unknown> = {},
  ) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const shards = discoverShards(this.filters);
    const shard = shards[(page - 1) % shards.length]!;
    const shardPage = Math.floor((page - 1) / shards.length) + 1;
    const url = listUrl(shard, shardPage);
    const shardKey = `${shard.channel}:${shard.value ?? ""}`;

    const fetched = await fetchHtml(url, LIST_HEADERS);
    const isXml = shard.channel === "sitemap" || /<\/urlset>|<\/sitemapindex>/i.test(fetched.text);
    let listings = extractRefs(fetched.text, isXml);

    // Sitemap shards repeat locale variants — keep English (or unlocalized) only.
    if (isXml) {
      listings = listings.filter((l) => /\/en\/(lot|listing)\//i.test(l.url) || !/\/(ru|be|uk|pl)\//i.test(l.url));
      // Prefer /en/ when both exist
      const byId = new Map<string, ListingReference>();
      for (const l of listings) {
        const key = l.sourceId.replace(/^(lot|listing)\//, "");
        const prev = byId.get(key);
        if (!prev || /\/en\//i.test(l.url)) byId.set(key, l);
      }
      listings = [...byId.values()];
    }

    const thin = listings.length < (isXml ? 50 : 8);
    if (thin) this.exhaustedShards.add(shardKey);
    else this.exhaustedShards.delete(shardKey);

    return {
      listings,
      pagination: {
        currentPage: page,
        hasMore: this.exhaustedShards.size < shards.length && shardPage <= 500,
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(thebidriveDetailUrl(url), LIST_HEADERS);
    return {
      url: fetched.finalUrl,
      html: fetched.text,
      statusCode: fetched.status,
      headers: {},
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const sourceId = sourceIdFromUrl(fetched.url);
    const auction = isAuctionPath(sourceId);
    const ld = parseLdCar(html);
    const specs = visibleSpecs(html);

    const brand = ld?.brand;
    const makeFromLd =
      typeof brand === "string"
        ? brand
        : brand && typeof brand === "object"
          ? str((brand as Record<string, unknown>).name)
          : undefined;

    const slug = sourceId.split("/").slice(2).join("/") || undefined;
    const vin =
      cleanVin(str(ld?.vehicleIdentificationNumber)) ??
      cleanVin(specs.VIN) ??
      vinFromSlug(slug) ??
      cleanVin(findVinInListing(html) ?? undefined);

    const year =
      parseYear(str(ld?.vehicleModelDate)) ??
      parseYear(specs.Year) ??
      parseYear(slug);
    const make = makeFromLd ?? str(specs.Make);
    const model = str(ld?.model) ?? str(specs.Model);
    const title =
      str(ld?.name) ??
      [year, make, model].filter(Boolean).join(" ") ??
      `Bidrive ${sourceId}`;

    const { price, currency } = priceOf(ld, html);
    const mileage = mileageOf(ld, specs);
    const mileageUnit = mileageUnitOf(ld, specs);
    const sold = isSold(ld, specs, html);

    const photos = vin ? asPhotos(galleryUrls(html, ld, sourceId), 40) : [];
    const country = inferCountry(html, photos.map((p) => p.sourceUrl));
    const location = withCountry(specs.Location ?? (auction ? "Auction" : "Marketplace"), country);

    const events = buildEvents({
      year,
      sold,
      price,
      currency,
      specs,
      engineStart: specs["Engine start"],
    }).filter((e) => e.eventType !== "delivery" || isFirstRegistrationEvent(e));

    // Ensure production-year first-reg when nothing else
    if (!events.some((e) => isFirstRegistrationEvent(e))) {
      const fallback = productionFirstRegEvent(year);
      if (fallback) events.push(fallback);
    }

    return moneyListing({
      sourceId,
      sourceUrl: thebidriveDetailUrl(sourceId),
      title,
      price,
      currency,
      mileage,
      mileageUnit,
      location,
      country,
      sold,
      events: events.length ? events : undefined,
      vehicle: vehicleFromParts({
        vin,
        make,
        model,
        year,
        trim: specs.Trim,
        fuelType: normalizeEuFuel(specs.Fuel),
        transmission: normalizeEuTransmission(specs.Transmission),
        bodyType: normalizeEuBodyType(specs.Body),
        color: normalizeEuColor(specs.Color),
        driveType: specs.Drivetrain,
        engineDisplacement: specs.Engine && !/^n\/?a$/i.test(specs.Engine) ? specs.Engine : undefined,
        country,
      }),
      photos,
    });
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin;
  }

  extractPhotos(listing: NormalizedListing): NormalizedPhoto[] {
    return listing.photos ?? [];
  }
}
