/**
 * Sanitize internal VIN retrieve payloads for the public API.
 * Strips provider identifiers, FX conversions, and timing metadata.
 */
import { countryApiSlug } from "./geo";

const PROVIDER_META_KEYS = new Set([
  "source",
  "provider",
  "providerId",
  "providerName",
  "internalName",
  "bidscan",
]);

export function resolveVinCountrySlug(
  vehicleCountry: string | null | undefined,
  listingCountries: Array<string | null | undefined>,
  providerCountries: Array<string | null | undefined>,
): string | null {
  const slug = countryApiSlug(vehicleCountry);
  if (slug) return slug;
  for (const c of listingCountries) {
    const fromListing = countryApiSlug(c);
    if (fromListing) return fromListing;
  }
  for (const c of providerCountries) {
    const fromProvider = countryApiSlug(c);
    if (fromProvider) return fromProvider;
  }
  return null;
}

function stripProviderMetadata(metadata: unknown): unknown {
  if (metadata == null || typeof metadata !== "object" || Array.isArray(metadata)) {
    return metadata;
  }
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata as Record<string, unknown>)) {
    if (PROVIDER_META_KEYS.has(key)) continue;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

function omitEmptyKrw<T extends Record<string, unknown>>(row: T): T {
  if (row.priceKrw == null) {
    const { priceKrw: _k, ...rest } = row;
    return rest as T;
  }
  return row;
}

export function publicListing<T extends Record<string, unknown>>(row: T) {
  const {
    providerId: _p,
    sourceId: _s,
    sourceUrl: _u,
    fx: _fx,
    ...rest
  } = row;
  return omitEmptyKrw(rest as Record<string, unknown>);
}

export function publicObservation<T extends Record<string, unknown>>(row: T) {
  const {
    providerId: _p,
    fx: _fx,
    ...rest
  } = row;
  return omitEmptyKrw(rest as Record<string, unknown>);
}

export function publicEvent<T extends { metadata?: unknown }>(row: T) {
  return {
    ...row,
    metadata: stripProviderMetadata(row.metadata),
  };
}

export function publicOwnerChange<T extends Record<string, unknown>>(row: T) {
  const { source: _s, ...rest } = row;
  return rest;
}

export function publicAccident<T extends Record<string, unknown>>(row: T) {
  const { source: _s, ...rest } = row;
  return rest;
}

export function publicAuctionSale<T extends Record<string, unknown>>(row: T) {
  const {
    provider: _p,
    source: _s,
    sourceListingId: _id,
    ...rest
  } = row;
  return omitEmptyKrw(rest as Record<string, unknown>);
}

export function publicMileageRow<T extends Record<string, unknown>>(row: T) {
  const { source: _s, sources: _ss, ...rest } = row;
  return rest;
}

export function publicPhoto<T extends Record<string, unknown>>(row: T) {
  const { sourceUrl: _u, ...rest } = row;
  return rest;
}
