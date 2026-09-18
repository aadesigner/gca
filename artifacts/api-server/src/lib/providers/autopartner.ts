/**
 * Auto Partner historical adapter — cars.autopartner.by
 * Full catalog: open search then archived. Detail /v/{VIN}.
 */
import type { FetchedListing, NormalizedListing, NormalizedVehicle } from "@workspace/providers";
import { KrHtmlAdapter, type KrDiscoverResult } from "./kr-adapter";
import { krFetch } from "./kr-http";
import {
  AUTOPARTNER_PARSER_VERSION,
  AUTOPARTNER_WEB_BASE,
  autopartnerDetailUrl,
  extractAutopartnerSearchRefs,
  extractAutopartnerVin,
  parseAutopartnerDetail,
} from "./autopartner-parse";

export {
  AUTOPARTNER_PARSER_VERSION,
  AUTOPARTNER_WEB_BASE,
  autopartnerDetailUrl,
  extractAutopartnerVin,
  parseAutopartnerDetail,
};

export class AutopartnerHistoricalAdapter extends KrHtmlAdapter {
  readonly internalName = "autopartner";
  private phase: "open" | "archived" = "open";
  private phasePage = 0;
  private emptyStreak = 0;

  protected extractSourceId(url: string): string | undefined {
    const vin = extractAutopartnerVin(url);
    return vin ? `ap-${vin}` : undefined;
  }

  async discoverListings(page: number): Promise<KrDiscoverResult> {
    // Worker page is monotonic; we advance our own phase pages.
    if (page === 1) {
      this.phase = "open";
      this.phasePage = 0;
      this.emptyStreak = 0;
    }
    this.phasePage += 1;
    const path =
      this.phase === "open"
        ? `/search?page=${this.phasePage}`
        : `/search?sale_status=archived&page=${this.phasePage}`;
    const url = `${AUTOPARTNER_WEB_BASE}${path}`;
    const fetched = await krFetch(url, {
      referer: `${AUTOPARTNER_WEB_BASE}/`,
      accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.8",
    });
    const listings = extractAutopartnerSearchRefs(fetched.text);
    if (listings.length === 0) {
      this.emptyStreak += 1;
      if (this.emptyStreak >= 3 && this.phase === "open") {
        this.phase = "archived";
        this.phasePage = 0;
        this.emptyStreak = 0;
        return {
          listings: [],
          pagination: { currentPage: page, hasMore: true },
        };
      }
    } else {
      this.emptyStreak = 0;
    }
    const hasMore =
      listings.length > 0 ||
      this.emptyStreak < 3 ||
      (this.phase === "open" && this.emptyStreak < 3);
    return {
      listings,
      pagination: {
        currentPage: page,
        hasMore: this.phase === "open" ? true : this.emptyStreak < 3,
      },
    };
  }

  async fetchListing(url: string): Promise<FetchedListing> {
    const detail = autopartnerDetailUrl(url);
    const fetched = await krFetch(detail, {
      referer: `${AUTOPARTNER_WEB_BASE}/search`,
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
    return parseAutopartnerDetail(fetched.html ?? "", fetched.url);
  }

  async normalizeVehicle(listing: NormalizedListing): Promise<NormalizedVehicle> {
    return listing.vehicle ?? { vin: undefined };
  }
}
