/**
 * Syarah (syarah.com) — Saudi Arabia used-car marketplace.
 * List/detail embed window.FULL_PAGE_DATA (posts + gallery). Public pages omit VIN;
 * adapter still extracts VIN when present and captures full specs + ordered gallery.
 */
import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  PaginationInfo,
} from "@workspace/providers";
import { SAUDI_ARABIA } from "../geo";
import { findVinInListing, parseYear, vehicleFromParts } from "./kr-common";
import { extraSpecEvent } from "./title-enrichment";
import { moneyListing } from "./us-common";
import { asPhotos, fetchHtml, firstRegEvent, num, str } from "./web-html";

export const SYARAH_PARSER_VERSION = "syarah-v1.0.0";
const BASE = "https://syarah.com";

const SY_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,ar;q=0.5",
  Referer: `${BASE}/en/autos`,
};

export function syarahDetailUrl(idOrUrl: string): string {
  const raw = String(idOrUrl ?? "").trim();
  if (!raw) return `${BASE}/en/autos`;
  if (/^https?:\/\//i.test(raw)) return raw.split("#")[0]!.split("?")[0]!;
  if (raw.startsWith("/")) return `${BASE}${raw.split("#")[0]!.split("?")[0]}`;
  if (/^\d{4,}$/.test(raw)) return `${BASE}/en/cardetail/car-used-${raw}`;
  if (/cardetail\//i.test(raw)) return `${BASE}/en/${raw.replace(/^\//, "")}`;
  return `${BASE}/en/cardetail/${raw}`;
}

function extractFullPageData(html: string): Record<string, unknown> | undefined {
  const m = html.match(/window\.FULL_PAGE_DATA\s*=\s*(\{[\s\S]*?\});\s*(?:window\.|<\/script>)/);
  if (!m?.[1]) return undefined;
  try {
    return JSON.parse(m[1]) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined;
}

function cardName(card: unknown): string | undefined {
  const rec = asRecord(card);
  const name = str(rec?.name);
  return name?.replace(/\s+/g, " ").trim() || undefined;
}

function cardIdNum(card: unknown): number | undefined {
  const rec = asRecord(card);
  const n = num(rec?.id) ?? num(rec?.name);
  return n && n > 0 ? n : undefined;
}

/**
 * Gallery images in site order. Prefer largest available thumb path already on the object.
 * Dedup by filename so 0x99 / 0x300 / 0x683 variants collapse.
 */
export function collectSyarahPhotos(images: unknown, max = 60): string[] {
  if (!Array.isArray(images)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  const sorted = [...images].sort((a, b) => {
    const fa = Number(asRecord(a)?.is_featured ?? 0);
    const fb = Number(asRecord(b)?.is_featured ?? 0);
    if (fb !== fa) return fb - fa;
    return 0;
  });
  for (const row of sorted) {
    const rec = asRecord(row);
    const url = str(rec?.img_url) ?? str(rec?.url) ?? str(rec?.image_url);
    if (!url || !/^https?:\/\//i.test(url)) continue;
    if (!/cdn\.syarah\.com/i.test(url)) continue;
    if (/banner|logo|icon|placeholder/i.test(url)) continue;
    const file = url.split("/").pop()?.split("?")[0]?.toLowerCase() ?? url.toLowerCase();
    if (seen.has(file)) continue;
    seen.add(file);
    // Prefer the largest common public size when a smaller thumb was listed.
    const upgraded = url.replace(/\/0x(?:99|154|300)\//i, "/0x683/");
    out.push(upgraded);
    if (out.length >= max) break;
  }
  return out;
}

function postIdFromUrl(url: string): string | undefined {
  const m = url.match(/cardetail\/[a-z0-9-]+-(\d+)/i) ?? url.match(/-(\d{5,})$/);
  return m?.[1];
}

export class SyarahHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "syarah";
  constructor(
    private _baseUrl?: string,
    private _filters: Record<string, unknown> = {},
  ) {}

  async discoverListings(
    page: number,
  ): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const p = Math.max(1, page);
    const listUrl = p <= 1 ? `${BASE}/en/autos` : `${BASE}/en/autos?page=${p}`;
    const fetched = await fetchHtml(listUrl, SY_HEADERS);
    const fpd = extractFullPageData(fetched.text);
    const listings: ListingReference[] = [];
    const seen = new Set<string>();

    const posts = Array.isArray(fpd?.posts) ? (fpd!.posts as unknown[]) : [];
    for (const post of posts) {
      const rec = asRecord(post);
      const id = str(rec?.id) ?? str(rec?.uniqueId);
      const path = str(rec?.product_url) ?? str(rec?.share_link);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const url = path
        ? path.startsWith("http")
          ? path.split("#")[0]!
          : `${BASE}${path.startsWith("/") ? path : `/${path}`}`.split("#")[0]!
        : syarahDetailUrl(`car-used-${id}`);
      listings.push({ sourceId: id, url });
    }

    if (!listings.length) {
      for (const match of fetched.text.matchAll(
        /href="(\/en\/cardetail\/[a-z0-9-]+-(\d+)[^"]*)"/gi,
      )) {
        const path = match[1]!.split("#")[0]!;
        const id = match[2]!;
        if (seen.has(id)) continue;
        seen.add(id);
        listings.push({ sourceId: id, url: `${BASE}${path}` });
      }
    }

    return {
      listings,
      pagination: { currentPage: p, hasMore: listings.length >= 8 },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const detailUrl = syarahDetailUrl(url);
    const fetched = await fetchHtml(detailUrl, SY_HEADERS);
    return {
      url: fetched.finalUrl,
      html: fetched.text,
      statusCode: fetched.status,
      headers: {},
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const fpd = extractFullPageData(html);
    const postDetails = asRecord(fpd?.postDetails);
    const details = asRecord(postDetails?.details);
    const analytics = asRecord(postDetails?.analytics);
    const g4 = asRecord(postDetails?.g4Data);
    const card = asRecord(details?.details_card);
    const gallery = asRecord(postDetails?.gallery);
    const priceObj = asRecord(postDetails?.price);

    const sourceId =
      str(details?.id) ??
      str(analytics?.id) ??
      str(g4?.post_id) ??
      postIdFromUrl(fetched.url) ??
      "unknown";

    const vin = findVinInListing(
      html,
      JSON.stringify(fpd ?? {}),
      str(details?.title),
      str(analytics?.name),
    );

    const make =
      cardName(card?.make) ?? str(analytics?.brand) ?? str(g4?.post_make);
    const model =
      cardName(card?.model) ?? str(analytics?.model) ?? str(g4?.post_model);
    const trim =
      cardName(card?.extension) ?? str(g4?.post_ext) ?? str(analytics?.options);
    const year =
      cardIdNum(card?.years) ??
      parseYear(cardName(card?.years)) ??
      num(analytics?.year) ??
      num(g4?.post_year) ??
      parseYear(str(details?.h1));

    const mileage =
      cardIdNum(card?.milage) ??
      num(analytics?.mileage) ??
      num(g4?.post_mileage) ??
      num(str(cardName(card?.milage))?.replace(/[^\d]/g, ""));

    const price =
      num(g4?.post_price) ??
      num(analytics?.price) ??
      num(str(asRecord(priceObj?.vat_price)?.text)?.replace(/[^\d]/g, "")) ??
      num(str(asRecord(priceObj?.old_price)?.text)?.replace(/[^\d]/g, ""));

    const fuelType =
      cardName(card?.fuel_types) ?? str(analytics?.fuel) ?? str(g4?.post_fuel);
    const transmission =
      cardName(card?.transmission_type) ??
      str(analytics?.transmission) ??
      str(g4?.post_transmission);
    const driveType =
      cardName(card?.drivetrain_type) ??
      str(analytics?.drivetrain) ??
      str(g4?.post_drivetrain);
    const color =
      cardName(card?.exterior_color) ??
      str(analytics?.color) ??
      str(g4?.post_exterior_color);
    const engine =
      cardName(card?.engine_size) ??
      (analytics?.engine_size != null ? String(analytics.engine_size) : undefined) ??
      (g4?.post_engine_size != null ? String(g4.post_engine_size) : undefined);
    const bodyType = str(analytics?.shape);
    const city = str(g4?.post_city);
    const origin = cardName(card?.car_origin) ?? str(g4?.post_origin);

    const title =
      str(details?.h1) ??
      str(analytics?.name) ??
      str(details?.title) ??
      [year, make, model, trim].filter(Boolean).join(" ");

    const photoUrls = collectSyarahPhotos(gallery?.images);
    const photos = vin ? asPhotos(photoUrls, 40) : [];
    const sold = Boolean(details?.is_sold) || Boolean(details?.is_deleted);

    const events = [
      firstRegEvent(year),
      extraSpecEvent("syarah", "origin", "Origin", origin),
      extraSpecEvent("syarah", "interior_color", "Interior color", cardName(card?.interior_color)),
      extraSpecEvent("syarah", "cylinders", "Cylinders", cardName(card?.cylinders)),
      extraSpecEvent("syarah", "keys", "Keys", cardName(card?.number_of_keys)),
      extraSpecEvent("syarah", "city", "City", city),
    ].filter((e): e is NonNullable<typeof e> => Boolean(e));

    return moneyListing({
      sourceId,
      sourceUrl: fetched.url,
      title,
      price,
      currency: "SAR",
      mileage: mileage && mileage > 0 ? mileage : undefined,
      mileageUnit: "km",
      location: city ? `${city}, ${SAUDI_ARABIA}` : SAUDI_ARABIA,
      country: SAUDI_ARABIA,
      sold,
      vehicle: vehicleFromParts({
        vin,
        year,
        make,
        model,
        trim,
        fuelType,
        transmission,
        driveType,
        bodyType,
        color,
        engineDisplacement: engine,
        country: SAUDI_ARABIA,
      }),
      photos,
      events: events.length ? events : undefined,
    });
  }
}
