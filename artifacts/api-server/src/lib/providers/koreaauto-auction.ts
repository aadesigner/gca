/**
 * KAA Auction (koreaauto.auction) — WordPress "vehicle" CPT.
 * Discovery: /wp-json/wp/v2/vehicle (~294 stock). Detail HTML for price/mileage/specs.
 */

import { load } from "cheerio";
import type { FetchedListing, ListingReference, NormalizedListing, NormalizedPhoto } from "@workspace/providers";
import { KrHtmlAdapter, type KrDiscoverResult } from "./kr-adapter";
import { krFetch } from "./kr-http";
import {
  findVinInListing,
  normalizeKrVin,
  parseKm,
  parseMoney,
  parseYear,
  usdListing,
  vehicleFromParts,
} from "./kr-common";

export const KOREAAUTO_AUCTION_PARSER_VERSION = "koreaauto_auction-v1.0.3";
export const KOREAAUTO_AUCTION_WEB_BASE = "https://koreaauto.auction";
const API_BASE = `${KOREAAUTO_AUCTION_WEB_BASE}/wp-json/wp/v2/vehicle`;
const PER_PAGE = 100;

export function koreaautoAuctionDetailUrl(sourceId: string): string {
  return `${KOREAAUTO_AUCTION_WEB_BASE}/?post_type=vehicle&p=${encodeURIComponent(sourceId)}`;
}

type WpVehicle = {
  id: number;
  slug?: string;
  link?: string;
  title?: { rendered?: string };
  content?: { rendered?: string };
  excerpt?: { rendered?: string };
  date?: string;
  modified?: string;
  class_list?: string[];
  _embedded?: {
    "wp:featuredmedia"?: Array<{ source_url?: string }>;
    "wp:term"?: Array<Array<{ taxonomy?: string; name?: string; slug?: string }>>;
  };
};

export class KoreaautoAuctionHistoricalAdapter extends KrHtmlAdapter {
  readonly internalName = "koreaauto_auction";

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await super.fetchListing(url);
    return {
      ...fetched,
      html: slimKaaHtml(fetched.html ?? ""),
    };
  }

  async discoverListings(page: number): Promise<KrDiscoverResult> {
    const url =
      `${API_BASE}?per_page=${PER_PAGE}&page=${Math.max(1, page)}` +
      `&status=publish&_embed=1&orderby=date&order=desc`;
    const fetched = await krFetch(url, {
      referer: `${KOREAAUTO_AUCTION_WEB_BASE}/vehicle/`,
      headers: { accept: "application/json" },
    });
    const totalPages = Math.max(1, Number(fetched.headers["x-wp-totalpages"] ?? 1));
    let rows: WpVehicle[] = [];
    try {
      rows = JSON.parse(fetched.text) as WpVehicle[];
    } catch {
      rows = [];
    }
    if (!Array.isArray(rows)) rows = [];

    const listings: ListingReference[] = [];
    for (const row of rows) {
      const id = String(row.id ?? "");
      if (!id) continue;
      const link =
        (row.link || "").trim() ||
        (row.slug
          ? `${KOREAAUTO_AUCTION_WEB_BASE}/vehicle/${row.slug}/`
          : koreaautoAuctionDetailUrl(id));
      listings.push({ sourceId: id, url: link });
    }

    return {
      listings,
      pagination: {
        currentPage: page,
        totalPages,
        hasMore: page < totalPages && listings.length > 0,
      },
    };
  }

  protected extractSourceId(url: string): string | undefined {
    const p = url.match(/[?&]p=(\d+)/i)?.[1];
    if (p) return p;
    const slug = url.match(/\/vehicle\/([^/?#]+)\/?/i)?.[1];
    if (!slug) return undefined;
    // Prefer numeric id when URL is ?p=; slug alone is not the sourceId we store.
    return undefined;
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const $ = load(fetched.html ?? "");
    const sourceId =
      this.extractSourceId(fetched.url) ||
      $("body").attr("class")?.match(/\bpostid-(\d+)\b/)?.[1] ||
      $("article[id^='post-'], [id^='post-']").attr("id")?.replace(/^post-/, "") ||
      $("[class*='post-']")
        .attr("class")
        ?.match(/\bpost-(\d+)\b/)?.[1] ||
      "unknown";

    const title =
      $("h1").first().text().replace(/\s+/g, " ").trim() ||
      $("title").first().text().replace(/\s*[-|].*$/, "").replace(/\s+/g, " ").trim();

    const price = parseMoney(
      $(".price-and-model .price h3, .price-model-and-fav-area .price h3, .price-and-model .price")
        .first()
        .text(),
    );

    const mileageRaw = labeledStat($, "Mileage");
    const mileage =
      mileageRaw && !/\?/.test(mileageRaw) ? parseKm(mileageRaw) : undefined;
    const engineRaw = labeledStat($, "Engine");
    const engine = normalizeEngineDisplacement(engineRaw);
    const fuelType =
      cleanSpec(labeledSpec($, "Fuel type") || labeledStat($, "Fuel Type")) ||
      undefined;
    const transmission = cleanSpec(labeledSpec($, "Transmission type")) || undefined;
    const color =
      cleanSpec(labeledSpec($, "Color") || termFromClass($, "colors-")) || undefined;
    const year =
      parseYear(labeledSpec($, "Model year")) ||
      parseYear(title) ||
      undefined;
    const location =
      $(".price-model-and-fav-area").closest(".row").find("li").filter((_, el) => {
        const t = $(el).text().replace(/\s+/g, " ").trim();
        return /^(Incheon|Busan|Seoul|Changwon|Daegu|Gwangju|Gyeonggi|Suwon|Jeonju|Gangwon|Daejeon)$/i.test(
          t,
        );
      }).first().text().trim() ||
      termFromClass($, "location-") ||
      undefined;

    const vin =
      findVinInListing(
        $('meta[name="description"]').attr("content"),
        $('meta[property="og:description"]').attr("content"),
        $(".wp-block-heading").text(),
        title,
        fetched.url,
      ) ||
      vinFromSlug(fetched.url) ||
      normalizeKrVin(fetched.url.match(/([A-HJ-NPR-Z0-9]{17})/i)?.[1]);

    const titleBits = parseTitleBits(title);
    const make =
      brandFromClass(termFromClass($, "vehicle-brand-")) ||
      titleBits.make ||
      undefined;
    const model =
      titleBits.model ||
      titleCase(termFromClass($, "vehicle-model-")?.replace(/-/g, " ")) ||
      undefined;
    const bodyType = titleCase(termFromClass($, "body-type-")?.replace(/-/g, " ")) || undefined;
    const salvage = /\bsalvage\b/i.test($("body").attr("class") ?? "") ||
      /\bsalvage\b/i.test(($("body").attr("class") ?? "") + " " + ($(".single-vehicle").attr("class") ?? "")) ||
      $("[class*='vehicle-category-salvage']").length > 0 ||
      /\bsalvage\b/i.test($.root().html()?.slice(0, 5000) ?? "");

    const photos = await collectPhotos($, sourceId, vin);

    const listing = usdListing({
      sourceId,
      sourceUrl: canonicalizeDetailUrl(fetched.url, sourceId),
      title,
      price,
      mileage,
      location,
      vehicle: vehicleFromParts({
        vin,
        make,
        model,
        year,
        fuelType,
        transmission,
        bodyType,
        engineDisplacement: engine,
        color: titleCase(color?.replace(/-/g, " ")),
      }),
      photos,
    });

    if (salvage) {
      listing.events = [
        {
          eventType: "other",
          description: "Listed as salvage car",
          occurredAt: new Date(),
          metadata: { source: "koreaauto_auction", field: "vehicle_category", value: "salvage-car" },
        },
      ];
    }

    return listing;
  }

  getSourceMetadata(fetched: FetchedListing) {
    const html = fetched.html ?? "";
    // Detail pages embed huge related-vehicle carousels (~3MB). Keep a head slice for debug.
    const rawHtml = html.length > 250_000 ? `${html.slice(0, 250_000)}\n<!-- truncated -->` : html;
    return {
      collectedAt: new Date(),
      rawHtml,
    };
  }
}

function slimKaaHtml(html: string): string {
  let out = html.replace(/<script\b[\s\S]*?<\/script>/gi, "");
  const cutAt = [
    out.search(/class="[^"]*product-st-card/i),
    out.search(/related products/i),
    out.search(/you may also like/i),
  ].filter((i) => i > 60_000);
  if (cutAt.length) out = out.slice(0, Math.min(...cutAt));
  return out.slice(0, 300_000);
}

function canonicalizeDetailUrl(url: string, sourceId: string): string {
  const slug = url.match(/\/vehicle\/([^/?#]+)\/?/i)?.[1];
  if (slug) return `${KOREAAUTO_AUCTION_WEB_BASE}/vehicle/${slug}/`;
  return koreaautoAuctionDetailUrl(sourceId);
}

function vinFromSlug(url: string): string | undefined {
  const slug = url.match(/\/vehicle\/([^/?#]+)\/?/i)?.[1] ?? "";
  const tail = slug.split("-").pop()?.toUpperCase() ?? "";
  return normalizeKrVin(tail);
}

function labeledStat($: ReturnType<typeof load>, label: string): string {
  let found = "";
  $(".content").each((_, el) => {
    const span = $(el).find("span").first().text().replace(/\s+/g, " ").trim();
    if (span.toLowerCase() !== label.toLowerCase()) return;
    const value = $(el).find("h6").first().text().replace(/\s+/g, " ").trim();
    if (value) {
      found = value;
      return false;
    }
  });
  return found;
}

function labeledSpec($: ReturnType<typeof load>, label: string): string {
  const re = new RegExp(`^${label}\\s*:\\s*(.+)$`, "i");
  let found = "";
  $("li, p, div, span").each((_, el) => {
    const t = $(el).clone().children().remove().end().text().replace(/\s+/g, " ").trim();
    const m = t.match(re);
    if (m?.[1]) {
      found = m[1].trim();
      return false;
    }
    const full = $(el).text().replace(/\s+/g, " ").trim();
    const m2 = full.match(re);
    if (m2?.[1] && m2[1].length < 40) {
      found = m2[1].trim();
      return false;
    }
  });
  return found;
}

function cleanSpec(raw?: string | null): string | undefined {
  if (!raw) return undefined;
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s || /^[?\-–—]$/.test(s) || /^n\/?a$/i.test(s) || /^unknown$/i.test(s)) return undefined;
  return s;
}

/** Keep real displacements only — never store "?" / placeholders. */
function normalizeEngineDisplacement(raw?: string | null): string | undefined {
  const s = cleanSpec(raw);
  if (!s) return undefined;
  const liters = s.match(/^(\d+(?:\.\d+)?)\s*L\b/i);
  if (liters) return `${liters[1]}L`;
  const cm3 = s.match(/^(\d{3,5})\s*(?:cm3|cc)\b/i);
  if (cm3) return `${cm3[1]}cc`;
  const mixed = s.match(/^(\d+(?:\.\d+)?)\s*L\s*\((\d{3,5})\s*cm3\)/i);
  if (mixed) return `${mixed[1]}L`;
  // Reject junk like "0.0L", "0L"
  if (/^0+(\.0+)?\s*L$/i.test(s)) return undefined;
  if (/^\d/.test(s) && s.length <= 24) return s.replace(/\s+/g, "");
  return undefined;
}

function parseTitleBits(title: string): { make?: string; model?: string; year?: number } {
  const m = title.trim().match(/^(\d{4})\s+(.+)$/);
  if (!m) return {};
  const year = Number(m[1]);
  const rest = m[2]!.trim();
  const multi = rest.match(
    /^(Mercedes-Benz|Land Rover|Range Rover|Rolls-Royce|Alfa Romeo)\s+(.+)$/i,
  );
  if (multi) return { year, make: multi[1], model: multi[2]!.trim() };
  const parts = rest.split(/\s+/);
  if (parts.length < 2) return { year, make: rest };
  return { year, make: parts[0], model: parts.slice(1).join(" ") };
}

function brandFromClass(slug?: string): string | undefined {
  if (!slug) return undefined;
  const map: Record<string, string> = {
    bmw: "BMW",
    mercedes: "Mercedes-Benz",
    "mercedes-benz": "Mercedes-Benz",
    kia: "Kia",
    hyundai: "Hyundai",
    lexus: "Lexus",
    toyota: "Toyota",
    audi: "Audi",
    honda: "Honda",
    nissan: "Nissan",
    ssangyong: "SsangYong",
  };
  return map[slug.toLowerCase()] || titleCase(slug.replace(/-/g, " "));
}

function termFromClass($: ReturnType<typeof load>, prefix: string): string | undefined {
  const cls = `${$("body").attr("class") ?? ""} ${$("article").first().attr("class") ?? ""}`;
  const m = cls.match(new RegExp(`\\b${prefix}([a-z0-9-]+)\\b`, "i"));
  return m?.[1];
}

function titleCase(raw?: string): string | undefined {
  if (!raw) return undefined;
  return raw
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

async function collectPhotos(
  $: ReturnType<typeof load>,
  sourceId: string,
  vin?: string,
): Promise<NormalizedPhoto[]> {
  const urls: string[] = [];
  const vinUpper = vin?.toUpperCase();

  const push = (raw?: string | null) => {
    if (!raw) return;
    let url = raw.trim();
    if (url.startsWith("//")) url = `https:${url}`;
    if (!/^https?:\/\//i.test(url)) {
      url = new URL(url, KOREAAUTO_AUCTION_WEB_BASE).toString();
    }
    if (/\.(svg)(\?|$)/i.test(url)) return;
    if (/logo|icon|favicon|placeholder|avatar|sprite|flag_of/i.test(url)) return;
    // Prefer full-size over -400x250 thumbs.
    url = url.replace(/-\d+x\d+(?=\.(jpe?g|png|webp))/i, "");

    if (vinUpper) {
      const vinsInUrl = url.toUpperCase().match(/[A-HJ-NPR-Z0-9]{17}/g) ?? [];
      // Drop related-car gallery shots (other VIN in filename).
      if (vinsInUrl.length > 0 && !vinsInUrl.includes(vinUpper)) return;
      // When this vehicle's VIN appears in gallery filenames, require it.
      // (Skip filter for generic uploads with no VIN in the path.)
    }

    if (urls.includes(url)) return;
    urls.push(url);
  };

  if (/^\d+$/.test(sourceId)) {
    try {
      const media = await krFetch(
        `${KOREAAUTO_AUCTION_WEB_BASE}/wp-json/wp/v2/media?parent=${sourceId}&per_page=40`,
        { referer: KOREAAUTO_AUCTION_WEB_BASE, headers: { accept: "application/json" } },
      );
      const rows = JSON.parse(media.text) as Array<{ source_url?: string }>;
      if (Array.isArray(rows)) {
        for (const row of rows) push(row.source_url);
      }
    } catch {
      // fall through to HTML gallery
    }
  }

  // HTML fallback only when media API empty — and only VIN-matching URLs.
  if (urls.length === 0 && vinUpper) {
    $(".gallery img, .swiper-slide img, img").each((_, el) => {
      const src = $(el).attr("src") || $(el).attr("data-src") || "";
      if (!src.toUpperCase().includes(vinUpper)) return;
      push(src);
    });
  }

  // Prefer .jpg/.png over duplicate .webp of the same stem.
  const preferred: string[] = [];
  const seenStem = new Set<string>();
  const ordered = [
    ...urls.filter((u) => /\.(jpe?g|png)(\?|$)/i.test(u)),
    ...urls.filter((u) => !/\.(jpe?g|png)(\?|$)/i.test(u)),
  ];
  for (const url of ordered) {
    const stem = url.replace(/\.(jpe?g|png|webp)(\?|$)/i, "").toLowerCase();
    if (seenStem.has(stem)) continue;
    seenStem.add(stem);
    preferred.push(url);
  }

  return preferred.slice(0, 40).map((sourceUrl, index) => ({
    sourceUrl,
    isPrimary: index === 0,
    sortOrder: index,
  }));
}
