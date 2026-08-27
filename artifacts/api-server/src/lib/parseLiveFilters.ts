/**
 * Parse extended live vehicle filters from query string (admin sandbox).
 */
import { ListLiveVehiclesQueryParams } from "@workspace/api-zod";
import type { LiveVehicleFilter } from "@workspace/providers";

function num(v: unknown): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function str(v: unknown): string | undefined {
  if (v == null || v === "") return undefined;
  return String(v);
}

export function parseExtendedLiveFilters(query: Record<string, unknown>): LiveVehicleFilter {
  const base = ListLiveVehiclesQueryParams.safeParse(query);
  const raw = base.success ? base.data : {};
  const filters = { ...raw } as LiveVehicleFilter & { provider?: string };
  delete filters.provider;

  return {
    ...filters,
    modelGroup: str(query.modelGroup),
    badgeGroup: str(query.badgeGroup),
    mileageMin: num(query.mileageMin),
    mileageMax: num(query.mileageMax),
    engineMin: num(query.engineMin),
    engineMax: num(query.engineMax),
    drivetrain: str(query.drivetrain),
    bodyType: str(query.bodyType),
    color: str(query.color),
    carType: str(query.carType) as LiveVehicleFilter["carType"],
  };
}
