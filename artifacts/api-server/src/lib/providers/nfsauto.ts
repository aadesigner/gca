/**
 * NFS Auto historical adapter — nfsauto.by Korea + China catalogs.
 * Discovery: /types/load-more JSON (interleaved korea/china shards).
 * Detail: extract JSON islands + gallery JSON API; never persist HTML.
 */
import type { FetchedListing, NormalizedListing, NormalizedVehicle } from "@workspace/providers";
import { KrHtmlAdapter, type KrDiscoverResult } from "./kr-adapter";
import { krFetch, KrRequestError } from "./kr-http";
import {
  NFSAUTO_PARSER_VERSION,
  NFSAUTO_WEB_BASE,
  extractNfsLotId,
  extractNfsLotJson,
  extractNfsLotRefs,
  mergeNfsGalleryUrls,
  nfsautoDetailUrl,
  parseNfsautoLotJson,
  type NfsLotJson,
  type NfsSource,
} from "./nfsauto-parse";

export {
  NFSAUTO_PARSER_VERSION,
  NFSAUTO_WEB_BASE,
  nfsautoDetailUrl,
  extractNfsLotId,
  parseNfsautoLotJson,
  extractNfsLotJson,
};

const PAGE_SIZE = 48;

export class NfsautoHistoricalAdapter extends KrHtmlAdapter {
  readonly internalName = "nfsauto";
  private totals = new Map<NfsSource, number>();

  protected extractSourceId(url: string): string | undefined {
    return extractNfsLotId(url)?.sourceId;
  }

  /**
   * Interleave Korea / China every other page so China is not stuck behind ~1k Korea pages.
   * Odd pages (1,3,5…) → korea; even (2,4,6…) → china.
   */
  private shardForPage(page: number): { source: NfsSource; localPage: number } {
    const source: NfsSource = page % 2 === 1 ? "korea" : "china";
    const localPage = Math.ceil(page / 2);
    return { source, localPage };
  }

  async discoverListings(page: number): Promise<KrDiscoverResult> {
    const { source, localPage } = this.shardForPage(page);
    const offset = (localPage - 1) * PAGE_SIZE;

    const url =
      `${NFSAUTO_WEB_BASE}/types/load-more?offset=${offset}&per_page=${PAGE_SIZE}` +
      `&source=${source}&skip_count=${this.totals.has(source) ? "1" : "0"}` +
      (this.totals.has(source) ? `&known_total=${this.totals.get(source)}` : "");

    const fetched = await krFetch(url, {
      referer: `${NFSAUTO_WEB_BASE}/${source}/`,
      accept: "application/json",
    });
    let payload: {
      html?: string;
      has_more?: boolean;
      total?: number;
      count?: number;
      success?: boolean;
    };
    try {
      payload = JSON.parse(fetched.text);
    } catch {
      throw new KrRequestError(502, `nfsauto load-more non-JSON for ${url}`, url);
    }
    if (typeof payload.total === "number" && payload.total > 0) {
      this.totals.set(source, payload.total);
    }
    // Lot paths only from the JSON payload blob (html field is a string in the API JSON).
    const listings = extractNfsLotRefs(payload.html ?? "", source);
    const koreaPages = Math.max(1, Math.ceil((this.totals.get("korea") ?? 53_000) / PAGE_SIZE));
    const chinaPages = Math.max(1, Math.ceil((this.totals.get("china") ?? 80_000) / PAGE_SIZE));
    const totalPages = koreaPages + chinaPages;
    const sourceDone = payload.has_more === false && listings.length === 0;
    const other: NfsSource = source === "korea" ? "china" : "korea";
    const otherPages = Math.max(1, Math.ceil((this.totals.get(other) ?? 50_000) / PAGE_SIZE));
    const hasMore = !sourceDone || localPage < otherPages || page < totalPages;

    return {
      listings,
      pagination: {
        currentPage: page,
        hasMore,
        totalPages,
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const detail = nfsautoDetailUrl(url);
    const fetched = await krFetch(detail, {
      referer: `${NFSAUTO_WEB_BASE}/`,
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    });

    let lot = extractNfsLotJson(fetched.text, fetched.url || detail);
    if (lot.lotIdInternal) {
      try {
        const gal = await krFetch(`${NFSAUTO_WEB_BASE}/types/api/lot/${lot.lotIdInternal}/gallery`, {
          referer: detail,
          accept: "application/json",
        });
        const body = JSON.parse(gal.text) as { urls?: string[]; success?: boolean };
        if (Array.isArray(body.urls) && body.urls.length) {
          lot = mergeNfsGalleryUrls(lot, body.urls);
        }
      } catch {
        /* gallery optional — lot page JSON often already has urls */
      }
    }

    // Persist JSON only — strip HTML before pipeline raw store.
    return {
      url: fetched.url || detail,
      html: undefined,
      json: lot satisfies NfsLotJson,
      statusCode: fetched.status,
      headers: {},
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    const json = fetched.json as NfsLotJson | null | undefined;
    if (json && typeof json === "object" && json.sourceId && json.slug) {
      return parseNfsautoLotJson(json);
    }
    // Fallback if a caller still passes HTML (tests / legacy).
    if (fetched.html) {
      return parseNfsautoLotJson(extractNfsLotJson(fetched.html, fetched.url));
    }
    throw new Error(`nfsauto parse requires lot JSON for ${fetched.url}`);
  }

  async normalizeVehicle(listing: NormalizedListing): Promise<NormalizedVehicle> {
    return listing.vehicle ?? { vin: undefined };
  }
}
