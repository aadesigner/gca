export type { ProviderAdapter } from "./adapter";
export type {
  NormalizedVehicle,
  NormalizedListing,
  NormalizedPhoto,
  NormalizedEvent,
  PaginationInfo,
  SourceMetadata,
  ListingReference,
  FetchedListing,
} from "./types";
export { ProviderRegistry, providerRegistry } from "./registry";

// Live provider types & interface
export type {
  LiveVehicle,
  LiveVehicleFilter,
  LiveVehicleStatus,
  LiveProviderCapabilities,
  LiveProviderCredentials,
  LiveVehicleDetail,
} from "./live-types";
export type { LiveProviderAdapter } from "./live-adapter";
