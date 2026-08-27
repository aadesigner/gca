import type { FetchedListing, ListingReference, NormalizedListing, NormalizedPhoto } from "@workspace/providers";
import { KrHtmlAdapter, type KrDiscoverResult } from "./kr-adapter";
import { krFetch, KrRequestError } from "./kr-http";
import { iaaVisPhotoUrl } from "./bidscan-parse";
import {
  BIDCARS_PARSER_VERSION,
  BIDCARS_WEB_BASE,
  bidcarsDetailUrl,
  classifyAuctionHouse,
  extractBidcarsLotId,
  extractBidcarsLotRefs,
  iaaLotNumber,
  parseBidcarsDetail,
} from "./bidcars-parse";

export { BIDCARS_PARSER_VERSION, BIDCARS_WEB_BASE, bidcarsDetailUrl };

const FIRST_YEAR = 2027;
const MIN_YEAR = 1980;
const YEAR_PAGES = FIRST_YEAR - MIN_YEAR + 1;
const MAX_LOCAL_PAGES = 400;
const PAGE_DELAY_MS = 350;
const CF_MESSAGE =
  "bid.cars is behind Cloudflare. Set BIDCARS_COOKIE from a browser session (cf_clearance) — do not solve the challenge in code.";

function bidcarsHeaders(): Record<string, string> {
  const cookie = process.env.BIDCARS_COOKIE?.trim();
  return cookie ? { Cookie: cookie } : {};
}

async function bidcarsGet(url: string): Promise<{ url: string; status: number; text: string }> {
  try {
    const fetched = await krFetch(url, {
      referer: `${BIDCARS_WEB_BASE}/en/`,
      headers: bidcarsHeaders(),
    });
    if (/Just a moment|cf-challenge|challenge-platform|Attention Required/i.test(fetched.text)) {
      throw new KrRequestError(403, CF_MESSAGE, url);
    }
    return fetched;
  } catch (err) {
    if (err instanceof KrRequestError && (err.statusCode === 403 || err.statusCode === 503)) {
      throw new KrRequestError(403, CF_MESSAGE, url);
    }
    throw err;
  }
}

export class BidcarsHistoricalAdapter extends KrHtmlAdapter {
  readonly internalName = "bidcars";

  protected extractSourceId(url: string): string | undefined {
    return extractBidcarsLotId(url);
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await bidcarsGet(url);
    return {
      url: fetched.url,
      html: fetched.text,
      statusCode: fetched.status,
      headers: {},
    };
  }

  async discoverListings(page: number): Promise<KrDiscoverResult> {
    if (page <= YEAR_PAGES) {
      const year = FIRST_YEAR - page + 1;
      const listings = await this.loadYear(year);
      return {
        listings,
        pagination: {
          currentPage: page,
          hasMore: true,
        },
      };
    }
    const catalogPage = page - YEAR_PAGES;
    const fetched = await bidcarsGet(`${BIDCARS_WEB_BASE}/en/automobile/page/${catalogPage}`);
    const listings = extractBidcarsLotRefs(fetched.text);
    return {
      listings,
      pagination: {
        currentPage: page,
        hasMore: listings.length >= 8,
      },
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const listing = parseBidcarsDetail(fetched.html ?? "", fetched.url);
    if ((listing.photos?.length ?? 0) === 0 && classifyAuctionHouse(listing.sourceId, fetched.html ?? "") === "iaa") {
      const lot = iaaLotNumber(listing.sourceId);
      if (lot) listing.photos = await probeIaaVisPhotos(lot);
    }
    return listing;
  }

  private async loadYear(year: number): Promise<ListingReference[]> {
    const listings: ListingReference[] = [];
    const seen = new Set<string>();
    let previous = "";
    for (let local = 1; local <= MAX_LOCAL_PAGES; local++) {
      const fetched = await bidcarsGet(archivedSearchUrl(year, local));
      const batch = extractBidcarsLotRefs(fetched.text);
      if (batch.length === 0) break;
      const key = batch.map((row) => row.sourceId).join(",");
      if (key === previous) break;
      previous = key;
      let added = 0;
      for (const row of batch) {
        if (seen.has(row.sourceId)) continue;
        seen.add(row.sourceId);
        listings.push(row);
        added++;
      }
      if (added === 0) break;
      if (local < MAX_LOCAL_PAGES) await sleep(PAGE_DELAY_MS);
    }
    return listings;
  }
}

function archivedSearchUrl(year: number, page: number): string {
  const q = new URLSearchParams({
    "search-type": "filters",
    type: "Automobile",
    "year-from": String(year),
    "year-to": String(year),
    "order-by": "dateDesc",
    page: String(page),
  });
  return `${BIDCARS_WEB_BASE}/en/search/archived/results?${q.toString()}`;
}

const VIS_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36";

async function probeIaaVisPhotos(lot: string): Promise<NormalizedPhoto[]> {
  const photos: NormalizedPhoto[] = [];
  for (let i = 1; i <= 40; i++) {
    const sourceUrl = iaaVisPhotoUrl(lot, i);
    if (!(await visImageExists(sourceUrl))) break;
    photos.push({ sourceUrl, isPrimary: photos.length === 0, sortOrder: photos.length });
  }
  return photos;
}

async function visImageExists(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": VIS_UA, Accept: "image/jpeg,image/webp,image/*,*/*;q=0.8" },
    });
    const type = res.headers.get("content-type") ?? "";
    return res.status === 200 && /image\//i.test(type);
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
