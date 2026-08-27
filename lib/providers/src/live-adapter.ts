import type {
  LiveVehicle,
  LiveVehicleFilter,
  LiveProviderCapabilities,
  LiveProviderCredentials,
  LiveVehicleDetail,
} from "./live-types";

/**
 * LiveProviderAdapter is the interface every live-inventory provider must implement.
 *
 * It is architecturally separate from the historical ProviderAdapter:
 * - Historical adapters collect, parse, and store data in our DB.
 * - Live adapters proxy real-time queries to an upstream API and normalize results.
 *
 * Credentials are never stored in the adapter itself; they are passed in at
 * call time after being decrypted from the DB.
 *
 * Lifecycle of a live query:
 *   1. Check PostgreSQL cache keyed by (providerId + query fingerprint).
 *   2. On cache hit: return cached data, increment hit count.
 *   3. On cache miss: call fetchVehicles() / fetchVehicle() on the adapter.
 *   4. Store normalized response in cache with configured TTL.
 *   5. Return normalized data to the client.
 */
export interface LiveProviderAdapter {
  /**
   * The adapter's internal name (must match live_providers.internal_name in DB).
   */
  readonly internalName: string;

  /**
   * Declare what filters and sort options this adapter supports.
   * Used by the API layer to document and validate query parameters.
   */
  getCapabilities(): LiveProviderCapabilities;

  /**
   * Fetch a paginated list of live vehicles from the upstream provider.
   * The adapter is responsible for applying filters where supported.
   */
  fetchVehicles(
    filters: LiveVehicleFilter,
    credentials: LiveProviderCredentials
  ): Promise<{ vehicles: LiveVehicle[]; total: number }>;

  /**
   * Fetch a single live vehicle by the provider's listing ID.
   * Returns null if the listing is not found.
   */
  fetchVehicle(
    id: string,
    credentials: LiveProviderCredentials
  ): Promise<LiveVehicle | null>;

  /**
   * Optional: fetch full detail including registry, accidents, diagnosis, etc.
   * Used by the admin live-feed test sandbox.
   */
  fetchVehicleDetail?(
    id: string,
    credentials: LiveProviderCredentials
  ): Promise<LiveVehicleDetail | null>;

  /**
   * Normalize a raw upstream response object into a canonical LiveVehicle.
   * Used internally by fetchVehicles / fetchVehicle implementations.
   */
  normalizeVehicle(raw: unknown): LiveVehicle;

  /**
   * Test that the upstream API is reachable with the given credentials.
   * Called from the admin "Test Connectivity" button.
   */
  testConnectivity(
    credentials: LiveProviderCredentials
  ): Promise<{ ok: boolean; error?: string }>;
}
