import type {
  ListingReference,
  FetchedListing,
  NormalizedListing,
  NormalizedVehicle,
  NormalizedPhoto,
  PaginationInfo,
  SourceMetadata,
} from "./types";

/**
 * ProviderAdapter is the core interface every data provider must implement.
 *
 * Each method is optional to allow partial implementations during development.
 * A concrete adapter wires up the provider-specific HTTP client, HTML parser,
 * and data normalizer behind this interface.
 *
 * Lifecycle of a full collection job:
 *   1. discoverListings()  → [ListingReference]  (paginated)
 *   2. fetchListing()      → FetchedListing        (raw HTTP)
 *   3. parseListing()      → NormalizedListing     (structured fields)
 *   4. normalizeVehicle()  → NormalizedVehicle     (canonical vehicle)
 *   5. extractVIN()        → string | undefined    (17-char VIN)
 *   6. extractPhotos()     → NormalizedPhoto[]     (image list)
 *   7. getSourceMetadata() → SourceMetadata        (audit trail)
 */
export interface ProviderAdapter {
  /**
   * The provider's internal name (must match providers.internal_name in DB).
   */
  readonly internalName: string;

  /**
   * Discover a page of listing references for the given page number.
   * Returns a list of references and pagination info.
   */
  discoverListings?(
    page: number,
    options?: Record<string, unknown>
  ): Promise<{
    listings: ListingReference[];
    pagination: PaginationInfo;
  }>;

  /**
   * Fetch a listing by URL (HTML may be fetched to parse, but is never stored).
   */
  fetchListing?(url: string): Promise<FetchedListing>;

  /**
   * Parse a raw fetched listing into a normalized structure.
   */
  parseListing?(fetched: FetchedListing): Promise<NormalizedListing>;

  /**
   * Normalize vehicle fields from a parsed listing into canonical form.
   * Implementations may enrich from external sources (VIN decoders, etc.).
   */
  normalizeVehicle?(listing: NormalizedListing): Promise<NormalizedVehicle>;

  /**
   * Extract the 17-character VIN from a parsed listing.
   * Returns undefined if no VIN is present.
   */
  extractVIN?(listing: NormalizedListing): string | undefined;

  /**
   * Extract and order photo references from a parsed listing.
   */
  extractPhotos?(listing: NormalizedListing): NormalizedPhoto[];

  /**
   * Build pagination info from a fetched listing response.
   */
  getPagination?(fetched: FetchedListing): PaginationInfo;

  /**
   * Capture raw source metadata for audit trail / raw data storage.
   */
  getSourceMetadata?(fetched: FetchedListing): SourceMetadata;
}
