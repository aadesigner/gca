/**
 * NFS Auto historical adapter — nfsauto.by Korea + China catalogs.
 * Discovery via /types/load-more JSON (offset pages); detail HTML /lot/{source}-{id}.
 */
import type { FetchedListing, NormalizedListing, NormalizedVehicle } from "@workspace/providers";
import { KrHtmlAdapter, type KrDiscoverResult } from "./kr-adapter";
import { krFetch, KrRequestError } from "./kr-http";
import {
  NFSAUTO_PARSER_VERSION,
  NFSAUTO_WEB_BASE,
  extractNfsLotId,
  extractNfsLotRefs,
  nfsautoDetailUrl,
  parseNfsautoDetail,
  type NfsSource,
} from "./nfsauto-parse";

export {
  NFSAUTO_PARSER_VERSION,
  NFSAUTO_WEB_BASE,
  nfsautoDetailUrl,
  extractNfsLotId,
  parseNfsautoDetail,
};

const PAGE_SIZE = 48;
const SOURCES: NfsSource[] = ["korea", "china"];

export class NfsautoHistoricalAdapter extends KrHtmlAdapter {
  readonly internalName = "nfsauto";
  private totals = new Map<NfsSource, number>();

  protected extractSourceId(url: string): string | undefined {
    return extractNfsLotId(url)?.sourceId;
  }

  async discoverListings(page: number): Promise<KrDiscoverResult> {
    // Map global page → source shard + offset page within shard.
    // Estimate ~53000/48 ≈ 1105 korea pages, ~79000/48 ≈ 1652 china — refine from API total.
    const koreaPages = Math.max(1, Math.ceil((this.totals.get("korea") ?? 53_000) / PAGE_SIZE));
    const source: NfsSource = page <= koreaPages ? "korea" : "china";
    const localPage = source === "korea" ? page : page - koreaPages;
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
    const listings = extractNfsLotRefs(payload.html ?? "", source);
    const koreaPagesNow = Math.max(1, Math.ceil((this.totals.get("korea") ?? 53_000) / PAGE_SIZE));
    const chinaPages = Math.max(1, Math.ceil((this.totals.get("china") ?? 80_000) / PAGE_SIZE));
    const totalPages = koreaPagesNow + chinaPages;
    const atEndOfSource = payload.has_more === false && listings.length === 0;
    const hasMore =
      source === "korea"
        ? !atEndOfSource || page < koreaPagesNow + chinaPages
        : Boolean(payload.has_more) || listings.length > 0;

    return {
      listings,
      pagination: {
        currentPage: page,
        hasMore: source === "korea" ? page < totalPages || Boolean(payload.has_more) : hasMore,
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
    return {
      url: fetched.url || detail,
      html: fetched.text,
      statusCode: fetched.status,
      headers: {},
    };
  }

  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    return parseNfsautoDetail(fetched.html ?? "", fetched.url);
  }

  async normalizeVehicle(listing: NormalizedListing): Promise<NormalizedVehicle> {
    return listing.vehicle ?? { vin: undefined };
  }
}
