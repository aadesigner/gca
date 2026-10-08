import type { FetchedListing, ListingReference, NormalizedListing } from "@workspace/providers";
import { KrHtmlAdapter, type KrDiscoverResult } from "./kr-adapter";
import { krFetch, KrRequestError } from "./kr-http";
import {
  BIDSCAN_PARSER_VERSION,
  BIDSCAN_WEB_BASE,
  extractBidscanVinUrl,
  parseBidscanDetail,
} from "./bidscan-parse";

export { BIDSCAN_PARSER_VERSION, BIDSCAN_WEB_BASE };

export function bidscanDetailUrl(vin: string): string {
  return `${BIDSCAN_WEB_BASE}/cars/${vin}`;
}

async function bidscanGet(url: string): Promise<{ url: string; status: number; text: string }> {
  const fetched = await krFetch(url, { referer: BIDSCAN_WEB_BASE });
  if (/Just a moment|Attention Required|cf-challenge|challenge-platform/i.test(fetched.text)) {
    throw new KrRequestError(403, "bidscan.vin returned a Cloudflare challenge", url);
  }
  return fetched;
}

export class BidscanHistoricalAdapter extends KrHtmlAdapter {
  readonly internalName = "copart";
  private catalogs: Array<{ auction: "copart" | "iaai"; lastPage: number }> | null = null;

  protected extractSourceId(url: string): string | undefined {
    return url.match(/\/cars\/([A-HJ-NPR-Z0-9]{17})/i)?.[1]?.toUpperCase();
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await bidscanGet(url);
    return {
      url: fetched.url,
      html: fetched.text,
      statusCode: fetched.status,
      headers: {},
    };
  }

  async discoverListings(page: number): Promise<KrDiscoverResult> {
    if (!this.catalogs) this.catalogs = await this.loadCatalogs();
    const totalPages = this.catalogs.reduce((n, c) => n + c.lastPage, 0);
    const mapped = mapCatalogPage(this.catalogs, page);
    if (!mapped) {
      return { listings: [], pagination: { currentPage: page, totalPages, hasMore: false } };
    }
    const fetched = await bidscanGet(searchUrl(mapped.auction, mapped.localPage));
    const listings = this.extractVinCards(fetched.text);
    return {
      listings,
      pagination: {
        currentPage: page,
        totalPages,
        // Empty page mid-catalog must not end the crawl (parse glitch / transient HTML).
        hasMore: page < totalPages,
      },
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    // Never invent vis.iaai.com frames from the printed lot number. Bidscan
    // pages often have no photos, and that lot's IAA gallery is a different car
    // than the VIN (Volvo text, Chevrolet/Honda pictures).
    return parseBidscanDetail(fetched.html ?? "", fetched.url);
  }

  private async loadCatalogs(): Promise<Array<{ auction: "copart" | "iaai"; lastPage: number }>> {
    const catalogs: Array<{ auction: "copart" | "iaai"; lastPage: number }> = [];
    for (const auction of ["iaai", "copart"] as const) {
      const fetched = await bidscanGet(searchUrl(auction, 1));
      catalogs.push({ auction, lastPage: Math.max(1, resolveSearchLastPage(fetched.text)) });
    }
    return catalogs;
  }

  private extractVinCards(html: string): ListingReference[] {
    const seen = new Set<string>();
    const listings: ListingReference[] = [];
    for (const m of html.matchAll(/href="([^"]*\/cars\/[A-HJ-NPR-Z0-9]{17}[^"]*)"/gi)) {
      const url = extractBidscanVinUrl(m[1]!);
      if (!url) continue;
      const sourceId = this.extractSourceId(url);
      if (!sourceId || seen.has(sourceId)) continue;
      seen.add(sourceId);
      listings.push({ sourceId, url });
    }
    return listings;
  }
}

function searchUrl(auction: "copart" | "iaai", page: number): string {
  const q = new URLSearchParams({
    make: "",
    model: "",
    year_from: "",
    year_to: "",
    damage_type: "",
    auction_type: auction,
    page: String(page),
  });
  return `${BIDSCAN_WEB_BASE}/search-cars?${q.toString()}`;
}

function mapCatalogPage(
  catalogs: Array<{ auction: "copart" | "iaai"; lastPage: number }>,
  page: number,
): { auction: "copart" | "iaai"; localPage: number } | null {
  let remaining = page;
  for (const cat of catalogs) {
    if (remaining <= cat.lastPage) return { auction: cat.auction, localPage: remaining };
    remaining -= cat.lastPage;
  }
  return null;
}

function lastSearchPage(html: string): number {
  let max = 1;
  for (const m of html.matchAll(/search-cars\?[^"']*page=(\d+)/gi)) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return max;
}

/** Prefer pager last page; fall back to "N vehicles" / page-size when pager is truncated. */
function resolveSearchLastPage(html: string): number {
  const fromPager = lastSearchPage(html);
  const countMatch = html.match(/([\d,]+)\s+vehicles?/i);
  const count = countMatch ? Number(countMatch[1]!.replace(/,/g, "")) : 0;
  const cards = [...html.matchAll(/href="[^"]*\/cars\/[A-HJ-NPR-Z0-9]{17}[^"]*"/gi)].length;
  const pageSize = Math.max(1, cards || 24);
  const fromCount = count > 0 ? Math.max(1, Math.ceil(count / pageSize)) : 1;
  return Math.max(fromPager, fromCount);
}

