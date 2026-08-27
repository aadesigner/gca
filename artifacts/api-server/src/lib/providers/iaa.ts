import { load, type CheerioAPI } from "cheerio";
import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  NormalizedVehicle,
  NormalizedPhoto,
  PaginationInfo,
} from "@workspace/providers";
import { normalizeVin, usMiListing } from "./us-common";
import { parseTitleState, textIndicatesSalvage } from "../salvage-title";
import type { NormalizedEvent } from "@workspace/providers";
import { vehicleFromParts } from "./kr-common";
import { expandIaaiSpinPhotos } from "./iaai-spin";

export const IAA_PARSER_VERSION = "iaa-v1.1.0";
const BASE = "https://www.iaai.com";
const VIS_CDN = "https://vis.iaai.com/resizer";
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

export function iaaDetailUrl(salvageId: string): string {
  const tenant = salvageId.includes("~") ? "" : "~US";
  return `${BASE}/VehicleDetail/${salvageId}${tenant}`;
}

function iaaFetch(url: string): Promise<{ text: string; status: number }> {
  return fetch(url, { headers: { "User-Agent": UA }, redirect: "follow" }).then(
    async (r) => ({ text: await r.text(), status: r.status }),
  );
}

function extractField(html: string, key: string): string | undefined {
  const m = html.match(new RegExp(`"${key}"\\s*:\\s*"([^"]*)"`, "i"));
  return m?.[1] || undefined;
}

function parseMiles(raw?: string): number | undefined {
  if (!raw) return undefined;
  const m = raw.match(/([\d,]+)\s*mi/i);
  return m ? Number(m[1].replace(/,/g, "")) : undefined;
}

function parseUsd(raw?: string): number | undefined {
  if (!raw) return undefined;
  const m = raw.match(/\$?([\d,]+)/);
  const n = m ? Number(m[1].replace(/,/g, "")) : undefined;
  return n && n > 0 ? n : undefined;
}

function buildImageUrls(salvageId: string, count = 10): NormalizedPhoto[] {
  const photos: NormalizedPhoto[] = [];
  for (let i = 1; i <= count; i++) {
    photos.push({
      sourceUrl: `${VIS_CDN}?imageKeys=${salvageId}~SID~S0~I${i}&width=845`,
      isPrimary: i === 1,
      sortOrder: i - 1,
    });
  }
  return photos;
}

export class IaaHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "iaa";

  constructor(
    private _baseUrl?: string,
    private filters: Record<string, unknown> = {},
  ) {}

  async discoverListings(
    page: number,
  ): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const url = `${BASE}/Search`;
    const fetched = await iaaFetch(url);
    const seen = new Set<string>();
    const listings: ListingReference[] = [];

    for (const match of fetched.text.matchAll(/\/VehicleDetail\/(\d+)~(\w+)/g)) {
      const salvageId = match[1]!;
      if (seen.has(salvageId)) continue;
      seen.add(salvageId);
      listings.push({
        sourceId: salvageId,
        url: `${BASE}/VehicleDetail/${salvageId}~${match[2]}`,
      });
    }

    // IAA search doesn't paginate via query params for anonymous users,
    // so we only get ~100 newest listings per discovery run.
    return {
      listings,
      pagination: { currentPage: page, hasMore: page === 1 && listings.length >= 50 },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await iaaFetch(url);
    return {
      url,
      html: fetched.text,
      statusCode: fetched.status,
      headers: {},
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const salvageId = fetched.url.match(/\/VehicleDetail\/(\d+)/)?.[1] ?? "unknown";

    const year = extractField(html, "Year");
    const make = extractField(html, "Make");
    const model = extractField(html, "Model");
    const series = extractField(html, "Series");
    const vinMasked = extractField(html, "VIN") || extractField(html, "VINMask");
    const stockNumber = extractField(html, "StockNumber");

    const primaryDamage = extractField(html, "PrimaryDamageDesc");
    const secondaryDamage = extractField(html, "SecondaryDamageDesc");
    const titleCode = extractField(html, "TitleCode");
    const inventoryStatus = extractField(html, "InventoryStatus");
    const bodyStyle = extractField(html, "BodyStyleName");
    const transmission = extractField(html, "Transmission");
    const fuelType = extractField(html, "FuelType");
    const driveType = extractField(html, "DrivelineType");
    const cylinders = extractField(html, "Cylinders");
    const color = extractField(html, "Color");
    const engineType = extractField(html, "EngineType");
    const sellingBranch = extractField(html, "SellingBranch");

    const odoMatch = html.match(/"Odometer"[^}]*"value"\s*:\s*"([^"]+)"/);
    const mileage = parseMiles(odoMatch?.[1]);

    const buyNow = extractField(html, "BuyNowPrice");
    const price = parseUsd(buyNow);

    // IAA masks the last 6 digits for anonymous users (e.g. 1GCNCNEH5GZ******).
    // The first 11 chars (WMI + VDS + check digit) still identify the vehicle model.
    // Store the masked VIN as-is — it's still useful for matching.
    const vin =
      vinMasked && !vinMasked.includes("*")
        ? normalizeVin(vinMasked)
        : undefined;
    const partialVin = !vin && vinMasked ? vinMasked.replace(/\*/g, "").toUpperCase() : undefined;

    const title = [year, make, model, series].filter(Boolean).join(" ");

    const vehicle = vehicleFromParts({
      vin,
      make,
      model,
      year: year ? Number(year) : undefined,
      bodyType: bodyStyle,
      fuelType,
      transmission,
      driveType,
      color,
      engineDisplacement: engineType,
    });

    // Attach salvage-specific metadata
    const vAny = vehicle as Record<string, unknown>;
    if (primaryDamage) vAny.damageType = primaryDamage;
    if (secondaryDamage) vAny.secondaryDamage = secondaryDamage;
    if (titleCode) vAny.titleBrand = titleCode;
    if (cylinders) vAny.cylinders = cylinders;
    if (stockNumber) vAny.stockNumber = stockNumber;
    if (vinMasked) vAny.vinMasked = vinMasked;
    if (partialVin) vAny.partialVin = partialVin;

    const gallery = buildImageUrls(salvageId).map((p) => ({ ...p, group: "gallery" as const }));
    const spin = /^\d+$/.test(salvageId) ? await expandIaaiSpinPhotos(salvageId) : [];
    const photos = [...gallery, ...spin];

    const sold = inventoryStatus === "SD";
    const titleEvents: NormalizedEvent[] = [];
    if (titleCode?.trim()) {
      const text = titleCode.trim();
      titleEvents.push({
        eventType: "title_status",
        description: `Title code: ${text}`,
        occurredAt: new Date(),
        metadata: {
          source: "iaa",
          field: "title_code",
          value: text,
          salvage: textIndicatesSalvage(text),
          state: parseTitleState(text),
          region: "US",
          usCanada: true,
        },
      });
    }

    return usMiListing({
      sourceId: salvageId,
      sourceUrl: fetched.url,
      title,
      price,
      mileage,
      location: sellingBranch,
      sold,
      vehicle,
      photos,
      events: titleEvents.length ? titleEvents : undefined,
    });
  }

  async normalizeVehicle(listing: NormalizedListing): Promise<NormalizedVehicle> {
    return listing.vehicle ?? {};
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin ? normalizeVin(listing.vehicle.vin) : undefined;
  }

  extractPhotos(listing: NormalizedListing): NormalizedPhoto[] {
    return listing.photos ?? [];
  }
}
