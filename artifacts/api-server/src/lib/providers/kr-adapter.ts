import type {
  ProviderAdapter,
  ListingReference,
  FetchedListing,
  NormalizedListing,
  NormalizedVehicle,
  NormalizedPhoto,
  PaginationInfo,
  SourceMetadata,
} from "@workspace/providers";
import { krFetch, KrRequestError } from "./kr-http";
import { normalizeKrVin, type KrFilterParams } from "./kr-common";

export type KrDiscoverResult = {
  listings: ListingReference[];
  pagination: PaginationInfo;
};

export abstract class KrHtmlAdapter implements ProviderAdapter {
  abstract readonly internalName: string;
  protected filters: KrFilterParams;

  constructor(_baseUrl?: string, filters: KrFilterParams = {}) {
    this.filters = filters;
  }

  abstract discoverListings(page: number): Promise<KrDiscoverResult>;
  abstract parseListing(fetched: FetchedListing): Promise<NormalizedListing>;

  protected abstract extractSourceId(url: string): string | undefined;

  async fetchListing(url: string): Promise<FetchedListing> {
    const fetched = await krFetch(url, { referer: url });
    return {
      url: fetched.url,
      html: fetched.text,
      statusCode: fetched.status,
      headers: fetched.headers,
    };
  }

  async normalizeVehicle(listing: NormalizedListing): Promise<NormalizedVehicle> {
    return listing.vehicle ?? {};
  }

  extractVIN(listing: NormalizedListing): string | undefined {
    return listing.vehicle?.vin ? normalizeKrVin(listing.vehicle.vin) : undefined;
  }

  extractPhotos(listing: NormalizedListing): NormalizedPhoto[] {
    return listing.photos ?? [];
  }

  getPagination(_fetched: FetchedListing): PaginationInfo {
    return { currentPage: 1, hasMore: false };
  }

  getSourceMetadata(fetched: FetchedListing): SourceMetadata {
    return {
      collectedAt: new Date(),
      rawHtml: fetched.html,
    };
  }
}

export { KrRequestError };
