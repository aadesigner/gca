/**
 * Live vehicle listing status values.
 * Adapters map provider-specific statuses to these canonical values.
 */
export type LiveVehicleStatus = "AVAILABLE" | "RESERVED" | "SOLD" | "REMOVED" | "UNKNOWN";

/**
 * Normalized live vehicle record returned by a live provider.
 * This is the canonical shape that all live adapters must produce.
 */
export interface LiveVehicle {
  vin?: string;
  listingId: string;
  make?: string;
  model?: string;
  year?: number;
  mileage?: number;
  price?: number;
  currency?: string;
  /** Dealer listed a dummy Encar ask (99만원, 1111, …) — do not treat as a sale price. */
  priceOnRequest?: boolean;
  /** New-car MSRP in KRW when Encar provides originPrice. */
  msrp?: number;
  fuel?: string;
  transmission?: string;
  drivetrain?: string;
  location?: string;
  country?: string;
  photos?: string[];
  listingUrl?: string;
  status: LiveVehicleStatus;
  createdDate?: string;
  updatedDate?: string;
  trim?: string;
  bodyType?: string;
  color?: string;
  engineDisplacement?: string;
  badge?: string;
  modelGroup?: string;
  accidentCount?: number;
  ownerChangeCount?: number;
  features?: string[];
  priceUsd?: number | null;
  priceEur?: number | null;
  /** Set on combined-feed results so listing IDs can be resolved to a source. */
  sourceProvider?: {
    id: number;
    name: string;
    internalName: string;
  };
  fx?: {
    base: "KRW";
    usdPerKrw: number;
    eurPerKrw: number;
    krwPerUsd: number;
    krwPerEur: number;
    fetchedAt: string;
    source: string;
  } | null;
}

/**
 * Filter parameters accepted by live vehicle list endpoints.
 */
export interface LiveVehicleFilter {
  make?: string;
  model?: string;
  modelGroup?: string;
  badgeGroup?: string;
  yearFrom?: number;
  yearTo?: number;
  priceMin?: number;
  priceMax?: number;
  mileageMin?: number;
  mileageMax?: number;
  /** Engine displacement in cc (inclusive). */
  engineMin?: number;
  engineMax?: number;
  fuel?: string;
  transmission?: string;
  drivetrain?: string;
  bodyType?: string;
  color?: string;
  location?: string;
  carType?: "import" | "domestic" | "all";
  search?: string;
  sortBy?: "price" | "year" | "mileage" | "createdDate";
  sortOrder?: "asc" | "desc";
  limit?: number;
  offset?: number;
}

/** Rich detail payload for live feed test / detail views. */
export interface LiveVehicleDetail {
  vehicle: LiveVehicle;
  vin?: string;
  trim?: string;
  bodyType?: string;
  color?: string;
  engineDisplacement?: string;
  features?: string[];
  photos: string[];
  events: Array<{
    eventType: string;
    description: string;
    occurredAt?: string;
    metadata?: Record<string, unknown>;
  }>;
  registry?: {
    available: boolean;
    firstDate?: string;
    ownerChangeCount?: number;
    accidentCount?: number;
    myAccidentCost?: number;
    otherAccidentCost?: number;
    totalLossCount?: number;
    floodDamage?: boolean;
    loan?: number;
    ownerChanges?: Array<{
      date: string;
      sequence?: number;
      info?: string;
      plate?: string;
      mileageKm?: number;
      mileageMiles?: number;
      mileageNote?: string;
      source?: string;
    }>;
    accidents?: Array<{
      date?: string;
      type?: string;
      repairTotal?: number;
      insuranceBenefit?: number;
    }>;
  };
  diagnosis?: Record<string, unknown> | null;
  inspection?: Record<string, unknown> | null;
  listingUrl?: string;
  ownerChanges?: Array<{
    date: string;
    sequence?: number;
    info?: string;
    plate?: string;
    mileageKm?: number;
    mileageMiles?: number;
    mileageNote?: string;
    source?: string;
  }>;
}

/**
 * Describes what filters and sorting a live provider supports.
 */
export interface LiveProviderCapabilities {
  supportsFiltering: boolean;
  supportedFilters: Array<keyof LiveVehicleFilter>;
  supportsSorting: boolean;
  supportedSortFields: string[];
  supportsSearch: boolean;
  maxPageSize: number;
}

/**
 * Decrypted upstream credentials passed to an adapter at call time.
 * Never stored or returned in API responses.
 */
export interface LiveProviderCredentials {
  apiUrl?: string;
  apiToken?: string;
}
