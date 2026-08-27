/**
 * ExampleProviderAdapter — fully-commented scaffold for building a new
 * historical data provider.
 *
 * Copy this directory to `lib/providers/src/<your_provider_name>/` and fill in
 * every method.  Nothing in the collector pipeline needs to change — only the
 * adapter itself.
 *
 * STEP-BY-STEP CHECKLIST
 * ────────────────────────
 * 1. Set `internalName` to match the value you will insert into the `providers`
 *    table (snake_case, e.g. "copart", "iaai", "manheim").
 * 2. Implement `discoverListings`  — paginated index scrape / API call.
 * 3. Implement `fetchListing`      — fetch individual listing HTML/JSON.
 * 4. Implement `parseListing`      — map raw response → NormalizedListing.
 * 5. Implement `normalizeVehicle`  — map parsed listing → NormalizedVehicle.
 * 6. Implement `extractVIN`        — return 17-char VIN or undefined.
 * 7. Implement `extractPhotos`     — return ordered photo list.
 * 8. Implement `getSourceMetadata` — return raw content + hash for audit trail.
 * 9. Register the adapter in `lib/providers/src/registry.ts`.
 * 10. Insert a provider row into the `providers` table.
 */

import type { ProviderAdapter } from "../adapter";
import type {
  ListingReference,
  FetchedListing,
  NormalizedListing,
  NormalizedVehicle,
  NormalizedPhoto,
  PaginationInfo,
  SourceMetadata,
} from "../types";

// ── Adapter class ────────────────────────────────────────────────────────────

export class ExampleProviderAdapter implements ProviderAdapter {
  /**
   * REQUIRED: Must exactly match `providers.internal_name` in the DB.
   * Used by the collector pipeline to look up and dispatch the right adapter.
   */
  readonly internalName = "example_provider";

  // ── 1. discoverListings ──────────────────────────────────────────────────

  /**
   * Paginated index-page scrape / API call.
   *
   * Called by the pipeline repeatedly (page = 1, 2, 3 …) until
   * `pagination.hasMore` is false or max-pages is reached.
   *
   * CONTRACT
   * ────────
   * - Each returned `ListingReference` must have a unique, stable `sourceId`
   *   that matches the provider's own identifier.
   * - `url` is the canonical URL the pipeline passes to `fetchListing`.
   * - Return an empty `listings` array (not an error) when a page is empty.
   * - Throw if the network call fails — the pipeline will log and retry.
   *
   * @param page    1-based page number
   * @param options Arbitrary filter params forwarded from job config
   *   (e.g. { make: "Hyundai", yearFrom: 2020 })
   */
  async discoverListings(
    page: number,
    options?: Record<string, unknown>,
  ): Promise<{ listings: ListingReference[]; pagination: PaginationInfo }> {
    // TODO: Build the index URL for this page using `options`.
    //   const url = `https://example.com/listings?page=${page}&make=${options?.make ?? ""}`;
    //
    // TODO: Make the HTTP request (use safeHttps or node fetch; respect rate
    //   limits set on the provider row).
    //
    // TODO: Parse the response to extract listing IDs/URLs from the page.
    //
    // EXAMPLE return value:
    return {
      listings: [
        // { sourceId: "12345", url: "https://example.com/listing/12345" },
      ],
      pagination: {
        currentPage: page,
        hasMore: false,           // set true while more pages exist
        totalPages: undefined,    // set if the provider exposes a total count
        nextPageUrl: undefined,   // set if the provider uses cursor pagination
      },
    };
  }

  // ── 2. fetchListing ──────────────────────────────────────────────────────

  /**
   * Fetch the raw HTML or JSON for a single listing by URL.
   *
   * CONTRACT
   * ────────
   * - Must return the raw response body exactly as received.
   * - Set `statusCode` to the HTTP status; throw on network-level errors.
   * - Include all response headers so downstream parsers can inspect
   *   Content-Type, ETag, etc.
   * - Do NOT parse or transform the body here — that is `parseListing`'s job.
   *
   * @param url The canonical listing URL from `discoverListings`.
   */
  async fetchListing(url: string): Promise<FetchedListing> {
    // TODO: HTTP GET `url`.  Respect provider rate limits.
    //   const response = await safeGet(url);
    //   return {
    //     url,
    //     html: await response.text(),   // for HTML-based providers
    //     // json: await response.json(), // for JSON-API providers
    //     statusCode: response.status,
    //     headers: Object.fromEntries(response.headers),
    //   };
    throw new Error("ExampleProviderAdapter.fetchListing — not implemented");
  }

  // ── 3. parseListing ──────────────────────────────────────────────────────

  /**
   * Parse a raw fetched listing into a structured NormalizedListing.
   *
   * CONTRACT
   * ────────
   * - `sourceId` MUST be set and stable — it is the deduplication key.
   * - `priceAmount` is in the smallest currency unit (cents for USD, won for
   *   KRW, etc.).  Omit if unknown; never set to 0 when price is genuinely
   *   unknown.
   * - `mileage` is in the provider's native unit; set `mileageUnit` to "km"
   *   or "mi" accordingly.
   * - `isActive` indicates whether the listing is currently for sale.
   * - Return `vehicle` with whatever vehicle data the listing page exposes.
   *   Do not call external VIN decoders here — that is `normalizeVehicle`'s job.
   * - Throw on unrecoverable parse failures so the pipeline can log the error.
   *
   * @param fetched The raw response from `fetchListing`.
   */
  async parseListing(fetched: FetchedListing): Promise<NormalizedListing> {
    // TODO: Parse HTML with cheerio / parse JSON from fetched.json.
    //
    // EXAMPLE for a JSON API provider:
    //   const data = fetched.json as Record<string, unknown>;
    //   return {
    //     sourceId: String(data.id),
    //     sourceUrl: fetched.url,
    //     title: String(data.title ?? ""),
    //     priceAmount: typeof data.price === "number" ? data.price * 100 : undefined,
    //     priceCurrency: "KRW",
    //     mileage: typeof data.mileage === "number" ? data.mileage : undefined,
    //     mileageUnit: "km",
    //     location: typeof data.region === "string" ? data.region : undefined,
    //     isActive: data.status === "ACTIVE",
    //     vehicle: {
    //       make: String(data.make ?? ""),
    //       model: String(data.model ?? ""),
    //       year: typeof data.year === "number" ? data.year : undefined,
    //     },
    //   };
    throw new Error("ExampleProviderAdapter.parseListing — not implemented");
  }

  // ── 4. normalizeVehicle ──────────────────────────────────────────────────

  /**
   * Normalize vehicle attributes from a parsed listing into canonical form.
   *
   * CONTRACT
   * ────────
   * - Map provider-specific fuel/transmission/body strings to canonical values:
   *     Fuel:         "Gasoline" | "Diesel" | "Electric" | "Hybrid" | "LPG"
   *     Transmission: "Automatic" | "Manual" | "CVT" | "DCT"
   *     Body:         "Sedan" | "SUV" | "Truck" | "Hatchback" | "Van" | "Coupe"
   * - Leave fields undefined/null when the provider does not supply them; do
   *   not set placeholder strings like "N/A" or "Unknown".
   * - If this provider supplies a VIN on the listing, set `vin` here so it is
   *   also available to `extractVIN`.
   * - You MAY call an external VIN decoder (e.g. NHTSA) to enrich make/model
   *   when the listing only supplies a VIN, but wrap the call in try/catch so
   *   a failed enrichment does not fail the whole pipeline step.
   *
   * @param listing The structured output from `parseListing`.
   */
  async normalizeVehicle(listing: NormalizedListing): Promise<NormalizedVehicle> {
    const raw = listing.vehicle ?? {};
    return {
      make: raw.make,
      model: raw.model,
      year: raw.year,
      trim: raw.trim,
      bodyType: raw.bodyType,   // TODO: map to canonical string
      fuelType: raw.fuelType,   // TODO: map to canonical string
      transmission: raw.transmission, // TODO: map to canonical string
      driveType: raw.driveType,
      engineDisplacement: raw.engineDisplacement,
      color: raw.color,
    };
  }

  // ── 5. extractVIN ────────────────────────────────────────────────────────

  /**
   * Extract the 17-character VIN from a parsed listing.
   *
   * CONTRACT
   * ────────
   * - Return exactly 17 uppercase alphanumeric characters, or `undefined`.
   * - Validate with a basic regex: /^[A-HJ-NPR-Z0-9]{17}$/i
   * - If the provider exposes multiple VINs (rare), return the primary one.
   * - Never throw — return `undefined` for any extraction failure.
   *   The pipeline logs a vin_extraction_failure system event when undefined.
   *
   * @param listing The structured output from `parseListing`.
   */
  extractVIN(listing: NormalizedListing): string | undefined {
    const vin = listing.vehicle?.vin;
    if (!vin) return undefined;

    const cleaned = vin.replace(/\s/g, "").toUpperCase();
    // Basic VIN format validation: 17 chars, excludes I, O, Q
    if (/^[A-HJ-NPR-Z0-9]{17}$/.test(cleaned)) {
      return cleaned;
    }
    return undefined;
  }

  // ── 6. extractPhotos ─────────────────────────────────────────────────────

  /**
   * Extract and order photo references from a parsed listing.
   *
   * CONTRACT
   * ────────
   * - Return an empty array (not null/undefined) when no photos exist.
   * - Exactly one photo must have `isPrimary: true` (the first one if none
   *   is explicitly marked as primary).
   * - `sortOrder` should be 0-based and contiguous.
   * - `sourceUrl` must be the direct URL to the image, not a redirect.
   *
   * @param listing The structured output from `parseListing`.
   */
  extractPhotos(listing: NormalizedListing): NormalizedPhoto[] {
    const photos = listing.photos ?? [];
    return photos.map((p, idx) => ({
      sourceUrl: p.sourceUrl,
      isPrimary: idx === 0,
      sortOrder: idx,
      width: p.width,
      height: p.height,
    }));
  }

  // ── 7. getPagination ─────────────────────────────────────────────────────

  /**
   * Extract pagination info from a fetched listing index page.
   * Only needed for adapters where pagination is parsed from individual
   * response bodies (rare); most use `discoverListings` directly.
   *
   * @param fetched The raw response from `fetchListing`.
   */
  getPagination(fetched: FetchedListing): PaginationInfo {
    // TODO: extract total-pages or next-URL from fetched.html / fetched.json
    return { currentPage: 1, hasMore: false };
  }

  // ── 8. getSourceMetadata ─────────────────────────────────────────────────

  /**
   * Build source metadata for the audit trail (raw_source_records table).
   *
   * CONTRACT
   * ────────
   * - `contentHash` should be a SHA-256 hex of the raw response body so the
   *   pipeline can detect unchanged listings and skip re-parsing.
   * - Store either `rawHtml` OR `rawJson` (not both) — whichever is non-null
   *   is what the pipeline will persist in `raw_source_records`.
   * - `collectedAt` should be set to `new Date()` at the time of fetch.
   *
   * @param fetched The raw response from `fetchListing`.
   */
  getSourceMetadata(fetched: FetchedListing): SourceMetadata {
    // TODO: compute SHA-256 of the raw body:
    //   import { createHash } from "crypto";
    //   const body = fetched.html ?? JSON.stringify(fetched.json) ?? "";
    //   const contentHash = createHash("sha256").update(body).digest("hex");
    return {
      collectedAt: new Date(),
      rawJson: fetched.json != null ? JSON.stringify(fetched.json) : undefined,
      rawHtml: fetched.html,
      contentHash: undefined, // TODO: set to SHA-256 of body
    };
  }
}

// Export a singleton instance so the registry can import it directly:
export const exampleProviderAdapter = new ExampleProviderAdapter();
