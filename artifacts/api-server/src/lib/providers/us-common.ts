import type { NormalizedListing, NormalizedPhoto, NormalizedVehicle } from "@workspace/providers";
import { CANADA, UNITED_STATES } from "../geo";
import { normalizeKrVin } from "./kr-common";

export const USA = UNITED_STATES;
export { CANADA };

export function normalizeVin(raw?: string | null): string | undefined {
  return normalizeKrVin(raw);
}

export function usMiListing(base: {
  sourceId: string;
  sourceUrl: string;
  title?: string;
  price?: number;
  mileage?: number;
  location?: string;
  country?: string;
  sold?: boolean;
  reserved?: boolean;
  vehicle: NormalizedVehicle;
  photos: NormalizedPhoto[];
  events?: NormalizedListing["events"];
}): NormalizedListing {
  const sold = base.sold ?? false;
  const reserved = base.reserved ?? false;
  const isActive = !sold && !reserved;
  const listingStatus = sold ? "sold" : reserved ? "reserved" : "active";
  return {
    sourceId: base.sourceId,
    sourceUrl: base.sourceUrl,
    title: base.title,
    priceAmount: base.price,
    priceCurrency: "USD",
    mileage: base.mileage,
    mileageUnit: "mi",
    location: base.location ?? USA,
    country: base.country ?? USA,
    isActive,
    listingStatus: listingStatus as NormalizedListing["listingStatus"],
    soldAt: sold ? new Date() : undefined,
    vehicle: { ...base.vehicle, country: base.vehicle.country ?? base.country ?? USA },
    photos: base.photos,
    events: base.events,
  };
}

export function moneyListing(base: {
  sourceId: string;
  sourceUrl: string;
  title?: string;
  price?: number;
  currency: string;
  mileage?: number;
  mileageUnit: "km" | "mi";
  location?: string;
  country: string;
  sold?: boolean;
  vehicle: NormalizedVehicle;
  photos: NormalizedPhoto[];
  events?: NormalizedListing["events"];
}): NormalizedListing {
  const sold = base.sold ?? false;
  return {
    sourceId: base.sourceId,
    sourceUrl: base.sourceUrl,
    title: base.title,
    priceAmount: base.price,
    priceCurrency: base.currency,
    mileage: base.mileage,
    mileageUnit: base.mileageUnit,
    location: base.location ?? base.country,
    country: base.country,
    isActive: !sold,
    listingStatus: sold ? "sold" : "active",
    soldAt: sold ? new Date() : undefined,
    vehicle: { ...base.vehicle, country: base.vehicle.country ?? base.country },
    photos: base.photos,
    events: base.events,
  };
}
