/**
 * Normalized vehicle data after parsing a provider listing.
 */
export interface NormalizedVehicle {
  vin?: string;
  make?: string;
  model?: string;
  year?: number;
  trim?: string;
  bodyType?: string;
  fuelType?: string;
  transmission?: string;
  driveType?: string;
  engineDisplacement?: string;
  color?: string;
  country?: string;
}

/**
 * A discrete vehicle history event extracted from a provider listing.
 * Stored in vehicle_events for the full lifetime record.
 */
export interface NormalizedEvent {
  eventType: "accident" | "owner_change" | "inspection" | "flood_damage" | "total_loss" | "delivery" | "sale" | "title_status" | "other";
  description?: string;
  occurredAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Normalized listing data from a provider.
 */
export interface NormalizedListing {
  sourceId: string;
  sourceUrl?: string;
  title?: string;
  priceAmount?: number;
  priceCurrency?: string;
  /** Frozen USD (major units) at collect time — set by pipeline FX. */
  priceUsd?: number;
  /** Frozen EUR (major units) at collect time — set by pipeline FX. */
  priceEur?: number;
  mileage?: number;
  mileageUnit?: string;
  location?: string;
  country?: string;
  isActive?: boolean;
  /** active | sold | reserved | inactive */
  listingStatus?: string;
  /** When the listing was sold, if the provider reports it. */
  soldAt?: Date;
  /** Total number of recorded accidents from the provider's history data */
  accidentCount?: number;
  /** Total number of previous owners from the provider's history data */
  ownerChangeCount?: number;
  /** Discrete history events (accidents, owner changes, inspections) to persist in vehicle_events */
  events?: NormalizedEvent[];
  /**
   * When the listing was first published / advertised on the source site
   * (e.g. Encar firstAdvertisedDateTime, Lotte gdRegDe). Not vehicle first registration.
   */
  sourceListedAt?: Date;
  /** Provider-side last modified timestamp (e.g. Encar manage.modifyDateTime). */
  sourceModifiedAt?: Date;
  vehicle?: NormalizedVehicle;
  photos?: NormalizedPhoto[];
  /**
   * Persist under this `providers.internal_name` instead of the job's provider.
   * Used when one crawl (e.g. import-motor) fans out to encar / autowini / iaa / copart.
   */
  targetProvider?: string;
}

/**
 * Normalized photo data.
 */
export interface NormalizedPhoto {
  sourceUrl: string;
  isPrimary?: boolean;
  sortOrder?: number;
  width?: number;
  height?: number;
  /** gallery (default) | exterior_3d | interior_3d */
  group?: "gallery" | "exterior_3d" | "interior_3d";
}

/**
 * Pagination metadata returned by a provider after discovery.
 */
export interface PaginationInfo {
  currentPage: number;
  totalPages?: number;
  nextPageUrl?: string;
  hasMore: boolean;
  /** Provider-reported catalog size (e.g. Import Motor "Showing … of Z results"). */
  resultTotal?: number;
}

/**
 * Source metadata about the raw response from a provider.
 */
export interface SourceMetadata {
  collectedAt: Date;
  contentHash?: string;
  rawHtml?: string;
  rawJson?: string;
}

/**
 * A discovered listing reference (URL + source ID) before full fetching.
 */
export interface ListingReference {
  sourceId: string;
  url: string;
  metadata?: Record<string, unknown>;
}

/**
 * Raw HTTP response from fetching a listing page.
 */
export interface FetchedListing {
  url: string;
  html?: string;
  json?: unknown;
  metadata?: Record<string, unknown>;
  statusCode: number;
  headers: Record<string, string>;
}
