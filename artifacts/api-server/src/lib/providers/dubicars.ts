import type {
  ProviderAdapter,
  FetchedListing,
  ListingReference,
  NormalizedListing,
  PaginationInfo,
} from "@workspace/providers";
import { UNITED_ARAB_EMIRATES } from "../geo";
import { findVinInListing, parseYear, vehicleFromParts } from "./kr-common";
import { applyTitleTrimEnrichment, extraSpecEvent } from "./title-enrichment";
import { moneyListing } from "./us-common";
import { asPhotos, collectHttpImages, fetchHtml, firstRegEvent, num, str } from "./web-html";

export const DUBICARS_PARSER_VERSION = "dubicars-v1.2.1";
const BASE = "https://www.dubicars.com";

const MULTI_WORD_MAKES = [
  "Mercedes-Benz",
  "Mercedes Benz",
  "Land Rover",
  "Alfa Romeo",
  "Aston Martin",
  "Rolls-Royce",
  "Range Rover",
  "Harley-Davidson",
];

/** Gallery shots only — ignore Mailchimp icons and other third-party chrome. */
function collectDubicarsGallery(html: string): string[] {
  const best = new Map<string, { url: string; score: number }>();
  const re =
    /(?:https?:)?\/\/(?:www\.)?dubicars\.com\/images\/[a-f0-9]+\/(?:w_)?(\d+)x(\d+)\/([^"'\\\s>]+\.(?:jpe?g|webp|png))/gi;
  for (const match of html.matchAll(re)) {
    const url = match[0]!.startsWith("http") ? match[0]! : `https:${match[0]!}`;
    const score = Number(match[1]) * Number(match[2]);
    const id = match[3]!.toLowerCase();
    const prev = best.get(id);
    if (!prev || score > prev.score) best.set(id, { url, score });
  }
  if (best.size > 0) {
    return [...best.values()]
      .sort((a, b) => b.score - a.score)
      .map((row) => row.url);
  }
  // Fallback: same-host only (shared filter drops junk CDNs).
  return collectHttpImages(html, "dubicars.com", 40);
}

export function dubicarsDetailUrl(id: string): string {
  if (id.startsWith("http")) return id;
  if (id.startsWith("/")) return `${BASE}${id}`;
  return `${BASE}/${id}.html`;
}

function slugFromLdRef(raw?: unknown): string | undefined {
  if (typeof raw === "string") {
    const m = raw.match(/\/new-cars\/([^#"']+)/i);
    return m?.[1]?.replace(/\/$/, "") || undefined;
  }
  if (raw && typeof raw === "object") {
    const rec = raw as Record<string, unknown>;
    return slugFromLdRef(rec["@id"] ?? rec.name ?? rec.url);
  }
  return undefined;
}

function titleCaseSlug(slug?: string): string | undefined {
  if (!slug) return undefined;
  return slug
    .split(/[/-]+/)
    .filter(Boolean)
    .map((w) => (w.length <= 3 ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()))
    .join(" ");
}

/**
 * Parse make / model / trim from an H1 like
 * "BMW X5 XDRIVE40i EXCLUSIVE M SPORT PACKAGE" → BMW / X5 / XDRIVE40i …
 * Uses only tokens present in the title (no inference).
 */
export function parseDubicarsTitle(title?: string): {
  make?: string;
  model?: string;
  trim?: string;
  year?: number;
} {
  let rest = String(title ?? "").replace(/\s+/g, " ").trim();
  if (!rest) return {};

  let year: number | undefined;
  const leadingYear = rest.match(/^((?:19|20)\d{2})\s+/);
  if (leadingYear) {
    year = Number(leadingYear[1]);
    rest = rest.slice(leadingYear[0].length).trim();
  }

  const multi = MULTI_WORD_MAKES.find(
    (name) => rest.toLowerCase() === name.toLowerCase() || rest.toLowerCase().startsWith(`${name.toLowerCase()} `),
  );
  let make: string | undefined;
  if (multi) {
    make = multi === "Mercedes Benz" ? "Mercedes-Benz" : multi;
    rest = rest.slice(multi.length).trim();
  } else {
    const single = rest.match(/^([A-Za-z][A-Za-z0-9-]*)\b/);
    if (single?.[1]) {
      make = single[1];
      rest = rest.slice(single[0].length).trim();
    }
  }

  // First remaining token is the model badge (X5, GLE, …); rest is trim.
  const modelTok = rest.match(/^([A-Za-z0-9][A-Za-z0-9-]*)\b/);
  const model = modelTok?.[1];
  if (model) rest = rest.slice(modelTok![0].length).trim();

  // Drop a mid-title year from trim (e.g. "Land Cruiser GXR 2018 VX …").
  const midYear = rest.match(/\b((?:19|20)\d{2})\b/);
  if (midYear?.[1] && year == null) year = Number(midYear[1]);

  const trim = rest || undefined;
  return { make, model, trim, year };
}

function parseDubicarsJsonLd(html: string): {
  name?: string;
  make?: string;
  model?: string;
  fuelType?: string;
  transmission?: string;
  engine?: string;
  trim?: string;
  color?: string;
  bodyType?: string;
} {
  for (const block of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(block[1]!);
      const nodes = Array.isArray(parsed)
        ? parsed
        : [parsed, ...((parsed as { "@graph"?: unknown[] })["@graph"] ?? [])];
      for (const node of nodes) {
        if (!node || typeof node !== "object") continue;
        const rec = node as Record<string, unknown>;
        const type = String(rec["@type"] ?? "");
        if (!/vehicle|car|product/i.test(type) && !rec.brand && !rec.model) continue;

        const brandSlug = slugFromLdRef(rec.brand);
        const modelSlug = slugFromLdRef(rec.model);
        // model slug is often "toyota/land-cruiser" — take the path after brand.
        const modelFromSlug = modelSlug?.includes("/")
          ? titleCaseSlug(modelSlug.split("/").slice(1).join("/"))
          : titleCaseSlug(modelSlug);

        const engineRaw = rec.vehicleEngine;
        let engine: string | undefined;
        if (typeof engineRaw === "string") engine = engineRaw;
        else if (engineRaw && typeof engineRaw === "object") {
          const eng = engineRaw as Record<string, unknown>;
          engine = str(eng.name) ?? str(eng.engineDisplacement) ?? str(eng.description);
        }

        return {
          name: str(rec.name),
          make: titleCaseSlug(brandSlug?.split("/")[0]) ?? str(
            typeof rec.brand === "string"
              ? rec.brand
              : rec.brand && typeof rec.brand === "object"
                ? (rec.brand as Record<string, unknown>).name
                : undefined,
          ),
          model: modelFromSlug ?? str(typeof rec.model === "string" ? rec.model : undefined),
          fuelType: str(rec.fuelType),
          transmission: str(rec.vehicleTransmission),
          engine,
          trim: str(rec.vehicleConfiguration) ?? str(rec.trim),
          color: str(rec.color),
          bodyType: str(rec.bodyType),
        };
      }
    } catch {
      // ignore malformed ld+json
    }
  }
  return {};
}

function labeledField(html: string, label: string): string | undefined {
  const re = new RegExp(
    `(?:^|>)\\s*${label}\\s*[:：]?\\s*</[^>]+>\\s*<[^>]+>\\s*([^<]{1,80})`,
    "i",
  );
  const m = html.match(re);
  const val = m?.[1]?.replace(/\s+/g, " ").trim();
  if (!val || /menu|strike|option/i.test(val)) return undefined;
  return val;
}

export class DubicarsHistoricalAdapter implements ProviderAdapter {
  readonly internalName = "dubicars";
  constructor(private _baseUrl?: string, private _filters: Record<string, unknown> = {}) {}

  async discoverListings(page: number): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    const fetched = await fetchHtml(`${BASE}/uae/used-cars?page=${page}`);
    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    for (const match of fetched.text.matchAll(/href="(https:\/\/www\.dubicars\.com\/\d{4}-[^"]+\.html)"/g)) {
      const url = match[1]!;
      const slug = url.replace(BASE + "/", "").replace(/\.html$/, "");
      if (seen.has(slug)) continue;
      seen.add(slug);
      listings.push({ sourceId: slug, url });
    }
    if (!listings.length) {
      for (const match of fetched.text.matchAll(/href="(\/\d{4}-[a-z0-9-]+\.html)"/g)) {
        const path = match[1]!;
        const slug = path.replace(/^\//, "").replace(/\.html$/, "");
        if (seen.has(slug)) continue;
        seen.add(slug);
        listings.push({ sourceId: slug, url: `${BASE}${path}` });
      }
    }
    return { listings, pagination: { currentPage: page, hasMore: listings.length >= 12 } };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await fetchHtml(url);
    return { url: fetched.finalUrl, html: fetched.text, statusCode: fetched.status, headers: {} };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const html = fetched.html ?? "";
    const slug = fetched.url.replace(/\.html.*/, "").split("/").pop() ?? "unknown";
    const descMatch = html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i);
    const jsonLd = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)].map((m) => m[1]!);
    const vin = findVinInListing(html, ...jsonLd, descMatch?.[1]);
    const title = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const ld = parseDubicarsJsonLd(html);
    const fromTitle = parseDubicarsTitle(title ?? ld.name);

    // H1 / title is authoritative for identity — JSON-LD brand/model are often swapped
    // (e.g. make=X5, model=xDrive40i for a BMW X5).
    const make = fromTitle.make ?? ld.make;
    const model = fromTitle.model ?? ld.model;
    const year = parseYear(slug) ?? fromTitle.year ?? parseYear(title);
    const fuelType = ld.fuelType ?? cleanLabeledSpec(labeledField(html, "Fuel"));
    const transmission = ld.transmission ?? cleanLabeledSpec(labeledField(html, "Transmission"));
    const engineRaw = ld.engine ?? cleanEngineLabel(labeledField(html, "Engine"));
    const color = ld.color ?? cleanLabeledSpec(labeledField(html, "Colour") ?? labeledField(html, "Color"));
    const bodyType = ld.bodyType ?? cleanLabeledSpec(labeledField(html, "Body"));
    const regional = cleanLabeledSpec(
      labeledField(html, "Regional specs") ?? labeledField(html, "Regional Specs"),
    );
    const enriched = applyTitleTrimEnrichment(title ?? ld.name, {
      year,
      make,
      model,
      trim: fromTitle.trim ?? ld.trim,
      engineDisplacement: engineRaw,
    });

    const km = html.match(/([\d,]+)\s*(?:km|kilometers)/i);
    const price = html.match(/(?:AED|Dhs)\s*([\d,]+)/i);
    // Gallery only on dubicars.com/images — never related-car / third-party chrome.
    const photos = vin ? asPhotos(collectDubicarsGallery(html)) : [];
    const firstReg = firstRegEvent(html.match(/year[^0-9]{0,12}((?:19|20)\d{2})/i)?.[1] ?? year);
    const events = [
      firstReg,
      extraSpecEvent("dubicars", "regional_specs", "Regional specs", regional),
      extraSpecEvent("dubicars", "doors", "Doors", cleanLabeledSpec(labeledField(html, "Doors"))),
      extraSpecEvent("dubicars", "seats", "Seats", cleanLabeledSpec(labeledField(html, "Seats"))),
      extraSpecEvent("dubicars", "cylinders", "Cylinders", cleanLabeledSpec(labeledField(html, "Cylinders"))),
    ].filter((e): e is NonNullable<typeof e> => Boolean(e));

    return moneyListing({
      sourceId: slug,
      sourceUrl: fetched.url,
      title: title ?? ld.name,
      price: price ? num(price[1]) : undefined,
      currency: "AED",
      mileage: km ? num(km[1]) : undefined,
      mileageUnit: "km",
      location: UNITED_ARAB_EMIRATES,
      country: UNITED_ARAB_EMIRATES,
      vehicle: vehicleFromParts({
        vin,
        year,
        make,
        model: enriched.model,
        trim: enriched.trim,
        fuelType,
        transmission,
        bodyType,
        color,
        engineDisplacement: enriched.engineDisplacement,
        country: UNITED_ARAB_EMIRATES,
      }),
      photos,
      events: events.length ? events : undefined,
    });
  }
}

function cleanLabeledSpec(raw?: string): string | undefined {
  const t = raw?.replace(/\s+/g, " ").trim();
  if (!t || t.length > 48) return undefined;
  if (/menu|strike|option|span|div|href/i.test(t)) return undefined;
  return t;
}

/** Only keep values that look like a displacement / engine name — never marketing blurbs. */
function cleanEngineLabel(raw?: string): string | undefined {
  const t = cleanLabeledSpec(raw);
  if (!t) return undefined;
  if (/^\d+(\.\d+)?\s*(l|litre|liter|cc|cm3)\b/i.test(t)) return t;
  if (/^(petrol|gasoline|diesel|hybrid|electric)\b/i.test(t) && t.length <= 24) return t;
  return undefined;
}
