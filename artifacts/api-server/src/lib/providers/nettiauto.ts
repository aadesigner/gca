import { load } from "cheerio";
import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  PaginationInfo,
} from "@workspace/providers";
import { FINLAND } from "../geo";
import {
  normalizeEuBodyType,
  normalizeEuColor,
  normalizeEuFuel,
  normalizeEuTransmission,
} from "./eu-locale";
import {
  findVinInListing,
  normalizeKrVin,
  parseYear,
  vehicleFromParts,
} from "./kr-common";
import { moneyListing } from "./us-common";
import { asPhotos, fetchHtml, num, str } from "./web-html";

export const NETTIAUTO_PARSER_VERSION = "nettiauto-v1.1.1";
const BASE = "https://www.nettiauto.com";
const SEARCH = `${BASE}/vaihtoautot`;

/** Known example VIN in Nettiauto search placeholders — never persist. */
const NETTIAUTO_PLACEHOLDER_VINS = new Set(["2GNFLFEK1F6224271"]);

export function nettiautoDetailUrl(pathOrId: string): string {
  if (pathOrId.startsWith("http")) return pathOrId;
  if (pathOrId.startsWith("/")) return `${BASE}${pathOrId}`;
  if (/^\d+$/.test(pathOrId)) return `${BASE}/id/${pathOrId}`;
  return `${BASE}/${pathOrId}`;
}

function normalizeDrive(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  const t = raw.trim().toLowerCase();
  if (/front|fwd|etu/.test(t)) return "FWD";
  if (/rear|rwd|taka/.test(t)) return "RWD";
  if (/4(?:wd|x4)|awd|neliveto|all[\s-]?wheel/.test(t)) return "AWD";
  return raw.trim();
}

/**
 * Nettiauto `productName` is often "220 CDI Avantgarde *hyvät varusteet* *korko 3,99%*".
 * Keep the real trim; drop marketing / finance asterisks.
 */
export function cleanNettiautoTrim(raw?: string | null): string | undefined {
  if (!raw?.trim()) return undefined;
  let t = raw
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\+/g, "")
    .trim();
  // Drop *marketing blob* segments (Finnish dealer fluff).
  t = t.replace(/\*[^*]*\*/g, " ");
  // Anything after financing / interest / offer keywords.
  t = t.replace(
    /\b(?:rahoitus|korko|tarjous|hyv[aä]t\s+varusteet|kohtuu\s+kilometrit|kulut)\b[\s\S]*$/i,
    " ",
  );
  t = t.replace(/\s{2,}/g, " ").replace(/[.*\s,;:+-]+$/g, "").trim();
  if (!t || t.length < 2) return undefined;
  // Cap absurdly long leftovers.
  if (t.length > 80) t = t.slice(0, 80).replace(/\s+\S*$/, "").trim();
  return t || undefined;
}

/** Liter displacement only — never interest rates like 3,99%. */
export function parseEngineFromName(name?: string | null): string | undefined {
  if (!name) return undefined;
  const cleaned = name.replace(/\d+[,.]\d+\s*%/g, " ");
  const m =
    cleaned.match(/\b(\d)[,.](\d{1,2})\s*(?:l|ltr|litre|liter)\b/i) ||
    cleaned.match(/\b(\d)[,.](\d)\s*(?:tdi|tsi|tfsi|cdi|dci|hdi|gdi|crdi|mhev|phev|bensin|diesel)\b/i) ||
    cleaned.match(/(?<![%\d])\b(\d)[,.](\d)\s*(?=[A-Za-z]|\b)/);
  if (!m) return undefined;
  const whole = Number(m[1]);
  const frac = m[2]!;
  const liters = Number(`${whole}.${frac}`);
  // Reject finance-looking leftovers and nonsense.
  if (!Number.isFinite(liters) || liters < 0.6 || liters > 8.0) return undefined;
  if (frac.length > 1 && Number(frac) > 9) return undefined;
  return String(Math.round(liters * 1000));
}

/** Prefer "E 220" over bare series letter when productName starts with engine code. */
export function enrichNettiautoModel(model?: string | null, trim?: string | null): string | undefined {
  const m = model?.trim();
  if (!m) return undefined;
  if (!/^[A-Z]$/i.test(m) || !trim) return m;
  const code = trim.match(/^(\d{2,3}(?:\.\d)?(?:\s*[A-Z]{1,4})?)/i)?.[1]?.replace(/\s+/g, " ").trim();
  if (!code) return m;
  return `${m.toUpperCase()} ${code}`;
}

type LdCar = {
  name?: string;
  make?: string;
  model?: string;
  year?: number;
  vin?: string;
  mileage?: number;
  price?: number;
  currency?: string;
  color?: string;
  images?: string[];
  location?: string;
  fuelType?: string;
  transmission?: string;
  bodyType?: string;
  driveType?: string;
  trim?: string;
  engineDisplacement?: string;
  registrationNumber?: string;
};

function parseLdCar(html: string): LdCar | undefined {
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
        const type = String(Array.isArray(rec["@type"]) ? rec["@type"].join(" ") : rec["@type"] ?? "");
        if (!/car|vehicle|product/i.test(type) && !rec.vehicleIdentificationNumber) continue;

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
        const offers =
          rec.offers && typeof rec.offers === "object"
            ? (rec.offers as Record<string, unknown>)
            : undefined;
        const seller =
          offers?.seller && typeof offers.seller === "object"
            ? (offers.seller as Record<string, unknown>)
            : undefined;
        const address =
          seller?.address && typeof seller.address === "object"
            ? (seller.address as Record<string, unknown>)
            : undefined;
        const images = Array.isArray(rec.image)
          ? rec.image.map((u) => String(u)).filter((u) => /^https?:\/\//i.test(u))
          : typeof rec.image === "string"
            ? [rec.image]
            : [];
        const locality = str(address?.addressLocality);
        return {
          name: str(rec.name),
          make,
          model: str(rec.model),
          year: num(rec.vehicleModelDate) ?? parseYear(str(rec.vehicleModelDate) ?? str(rec.name)),
          vin: str(rec.vehicleIdentificationNumber),
          mileage: num(mileageRaw),
          price: num(offers?.price),
          currency: str(offers?.priceCurrency) ?? "EUR",
          color: str(rec.color),
          images,
          location: locality ? `${locality}, ${FINLAND}` : undefined,
        };
      }
    } catch {
      /* ignore malformed ld+json */
    }
  }
  return undefined;
}

function parseProductInfo(html: string): Partial<LdCar> {
  const pick = (key: string) =>
    html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "i"))?.[1] ??
    html.match(new RegExp(`"${key}"\\s*:\\s*(\\d+(?:\\.\\d+)?)`, "i"))?.[1];

  const make = pick("vehicleBrand");
  const model = pick("vehicleModel");
  const trim = cleanNettiautoTrim(pick("productName"));
  const vin = pick("VIN");
  if (!make && !vin) return {};

  const city = pick("locationCity");
  const region = pick("locationRegion");
  return {
    make,
    model: enrichNettiautoModel(model, trim) ?? model,
    trim,
    year: parseYear(pick("productionDate")),
    vin,
    mileage: num(pick("mileageFromOdometer")),
    price: num(pick("basePrice")),
    fuelType: pick("fuelType"),
    transmission: pick("vehicleTransmission"),
    bodyType: pick("vehicleVariant"),
    driveType: pick("drivetrain"),
    registrationNumber: pick("registrationNumber"),
    engineDisplacement: parseEngineFromName(trim) ?? parseEngineFromName(pick("productName")),
    location: [city, region, FINLAND].filter(Boolean).join(", "),
  };
}

/** Prefer full-size gallery shots from images.nettiauto.com. */
export function collectNettiautoPhotos(html: string, max = 40): string[] {
  const best = new Map<string, { url: string; score: number }>();
  const normalized = html.replace(/\\u002F/g, "/").replace(/\\\//g, "/");
  for (const match of normalized.matchAll(
    /https?:\/\/images\.nettiauto\.com\/live\/(\d{4}\/\d{2}\/\d{2}\/[a-f0-9]+)(?:-(large|medium|small|thumb))?\.(jpe?g|webp|png)/gi,
  )) {
    const id = (match[1] ?? "").toLowerCase();
    const size = (match[2] ?? "large").toLowerCase();
    const score = size === "large" ? 3000 : size === "medium" ? 2000 : size === "small" ? 1000 : 500;
    const url = `https://images.nettiauto.com/live/${match[1]}-large.jpg`;
    const prev = best.get(id);
    if (!prev || score > prev.score) best.set(id, { url, score });
  }
  if (best.size) {
    return [...best.values()]
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map((r) => r.url);
  }
  const loose: string[] = [];
  const seen = new Set<string>();
  for (const match of normalized.matchAll(
    /https?:\/\/images\.nettiauto\.com\/[^"'\\\s>]+\.(?:jpe?g|webp|png)/gi,
  )) {
    const url = match[0].replace(/-(?:medium|small|thumb)\./i, "-large.");
    if (seen.has(url)) continue;
    seen.add(url);
    loose.push(url);
    if (loose.length >= max) break;
  }
  return loose;
}

function cleanVin(raw?: string | null): string | undefined {
  const vin = normalizeKrVin(raw);
  if (!vin || NETTIAUTO_PLACEHOLDER_VINS.has(vin)) return undefined;
  return vin;
}

function titleCaseWords(raw?: string): string | undefined {
  if (!raw?.trim()) return undefined;
  return raw
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export class NettiautoHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "nettiauto";
  constructor(
    private _baseUrl?: string,
    private _filters: Record<string, unknown> = {},
  ) {}

  async discoverListings(
    page: number,
  ): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const p = Math.max(1, page);
    // Use ?page=N — ?pageId=N triggers SSO refresh loops.
    const url = p <= 1 ? SEARCH : `${SEARCH}?page=${p}`;
    const fetched = await fetchHtml(url, {
      Referer: BASE,
      "Accept-Language": "fi-FI,fi;q=0.9,en;q=0.8",
    });
    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const match of fetched.text.matchAll(/href="(\/[a-z0-9-]+\/[a-z0-9-]+\/(\d{6,}))"/gi)) {
      const path = match[1]!;
      const id = match[2]!;
      if (seen.has(id)) continue;
      if (/^\/(sso|static|assets|info|help)\b/i.test(path)) continue;
      seen.add(id);
      listings.push({ sourceId: id, url: nettiautoDetailUrl(path) });
    }
    return {
      listings,
      pagination: { currentPage: p, hasMore: listings.length >= 25 },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url, {
      Referer: SEARCH,
      "Accept-Language": "fi-FI,fi;q=0.9,en;q=0.8",
    });
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    // Drop UI placeholders so unlabeled VIN scans cannot pick the example Chevy VIN.
    const htmlSafe = html.replace(/placeholder\s*=\s*["'][^"']*["']/gi, "");
    const $ = load(html);
    const sourceId = fetched.url.match(/\/(\d{6,})(?:\?|$)/)?.[1] ?? "unknown";

    const ld = parseLdCar(html) ?? {};
    const info = parseProductInfo(html);

    const title =
      ld.name ||
      $("h1").first().text().replace(/\s+/g, " ").trim() ||
      $('meta[property="og:title"]').attr("content")?.replace(/\s+/g, " ").trim() ||
      $("title").text().replace(/\s*[-|].*$/, "").trim();

    const vin =
      cleanVin(ld.vin) ??
      cleanVin(info.vin) ??
      cleanVin(findVinInListing(htmlSafe, title)) ??
      undefined;

    const mileage = ld.mileage ?? info.mileage ?? undefined;
    const price = ld.price ?? info.price ?? undefined;
    const year = ld.year ?? info.year ?? parseYear(title);
    const pathMake = fetched.url.replace(BASE, "").split("/").filter(Boolean)[0];
    const make = titleCaseWords(ld.make ?? info.make ?? pathMake ?? title.split(/\s+/)[0]);
    const trim = cleanNettiautoTrim(info.trim) ?? cleanNettiautoTrim(
      // Fallback: strip marketing from the H1/og title after make/year/body noise.
      title
        ?.replace(/^mercedes-?benz\s+/i, "")
        ?.replace(/\b(?:sedan|farmari|coupe|cabriolet|maastoauto|tila-auto)\b.*$/i, "")
        ?.replace(/\b20\d{2}\b.*$/i, ""),
    );
    const model = titleCaseWords(
      enrichNettiautoModel(ld.model ?? info.model, trim) ?? ld.model ?? info.model,
    );
    const fuel = info.fuelType ?? ld.fuelType;
    const transmission = info.transmission ?? ld.transmission;
    const bodyType = info.bodyType ?? ld.bodyType;
    const driveType = info.driveType ?? ld.driveType;
    const color = ld.color ?? info.color;
    // Never parse engine from the full title — financing rates look like liters.
    const engineDisplacement = info.engineDisplacement ?? parseEngineFromName(trim);
    const location = info.location || ld.location || FINLAND;

    const photos = asPhotos([...(ld.images ?? []), ...collectNettiautoPhotos(html, 40)], 40);

    return moneyListing({
      sourceId,
      sourceUrl: fetched.url.startsWith("http") ? fetched.url : nettiautoDetailUrl(fetched.url),
      title,
      price,
      currency: ld.currency ?? "EUR",
      mileage,
      mileageUnit: "km",
      location: location || FINLAND,
      country: FINLAND,
      vehicle: vehicleFromParts({
        vin,
        make,
        model,
        trim,
        year,
        fuelType: normalizeEuFuel(fuel),
        transmission: normalizeEuTransmission(transmission),
        bodyType: normalizeEuBodyType(bodyType),
        driveType: normalizeDrive(driveType),
        engineDisplacement,
        color: normalizeEuColor(color),
        country: FINLAND,
      }),
      photos,
    });
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin;
  }

  extractPhotos(listing: NormalizedListing) {
    return listing.photos ?? [];
  }
}
