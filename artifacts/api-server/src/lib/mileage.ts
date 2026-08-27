/** Primary odometer unit for this platform (Encar source data is km). */
export const PRIMARY_MILEAGE_UNIT = "km" as const;
const KM_TO_MILES = 0.621371;
const MILES_TO_KM = 1 / KM_TO_MILES;

export interface MileageDual {
  km: number;
  miles: number;
  unit: typeof PRIMARY_MILEAGE_UNIT;
}

export function kmToMiles(km: number): number {
  return Math.round(km * KM_TO_MILES);
}

export function milesToKm(miles: number): number {
  return Math.round(miles * MILES_TO_KM);
}

export function isMilesUnit(unit?: string | null): boolean {
  const u = String(unit ?? "").toLowerCase();
  return u === "mi" || u === "mile" || u === "miles";
}

/** Convert a reading to km for vehicle.currentKnownMileage (always stored as km). */
export function toMileageKm(value: number | null | undefined, unit?: string | null): number | undefined {
  if (value == null || !Number.isFinite(value)) return undefined;
  return isMilesUnit(unit) ? milesToKm(value) : Math.round(value);
}

/** Normalize to km, then expose km + derived miles. */
export function formatMileageDual(
  value: number | null | undefined,
  unit?: string | null,
): MileageDual | null {
  if (value == null || !Number.isFinite(value)) return null;

  const km = toMileageKm(value, unit);
  if (km == null) return null;

  return {
    km,
    miles: kmToMiles(km),
    unit: PRIMARY_MILEAGE_UNIT,
  };
}

export function withListingMileage<T extends { mileage?: number | null; mileageUnit?: string | null }>(
  row: T,
): T & { mileageUnit: string; mileageKm: number | null; mileageMiles: number | null } {
  const dual = formatMileageDual(row.mileage, row.mileageUnit);
  return {
    ...row,
    mileage: dual?.km ?? row.mileage ?? null,
    mileageUnit: PRIMARY_MILEAGE_UNIT,
    mileageKm: dual?.km ?? null,
    mileageMiles: dual?.miles ?? null,
  };
}

/**
 * Vehicle.currentKnownMileage is stored as km. Pass mileageUnit only when reading
 * legacy rows that may still hold a miles figure without conversion.
 */
export function withVehicleMileage<T extends { currentKnownMileage?: number | null }>(
  row: T,
  mileageUnit: string | null | undefined = PRIMARY_MILEAGE_UNIT,
): T & {
  currentKnownMileageUnit: string;
  currentKnownMileageKm: number | null;
  currentKnownMileageMiles: number | null;
} {
  const dual = formatMileageDual(row.currentKnownMileage, mileageUnit ?? PRIMARY_MILEAGE_UNIT);
  return {
    ...row,
    currentKnownMileage: dual?.km ?? row.currentKnownMileage ?? null,
    currentKnownMileageUnit: PRIMARY_MILEAGE_UNIT,
    currentKnownMileageKm: dual?.km ?? null,
    currentKnownMileageMiles: dual?.miles ?? null,
  };
}
