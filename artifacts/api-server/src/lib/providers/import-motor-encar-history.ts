/**
 * Import Motor Encar-origin lots reuse the same numeric car id as Encar.
 * Merge registry / inspection / diagnosis from api.encar.com so IM ingest
 * stores the full Korean report, not just the thin timeline + keys row.
 */

import type { NormalizedListing, NormalizedVehicle } from "@workspace/providers";
import { EncarHistoricalAdapter, DETAIL_WEB_BASE } from "./encar";
import { extractEncarCounts, extractEncarEvents, type EncarAggregatedPayload } from "./encar-history";
import { importMotorEncarLotId, mergeImportMotorEncarEvents } from "./import-motor-encar-merge";

export { importMotorEncarLotId, mergeImportMotorEncarEvents } from "./import-motor-encar-merge";

function generationFromEncar(payload: EncarAggregatedPayload): string | undefined {
  const category = (payload.detail?.category ?? payload.view?.category ?? {}) as Record<string, unknown>;
  const modelName = String(category.modelName ?? category.modelGroupEnglishName ?? "");
  const chassis = modelName.match(/\(([A-Z]\d{2}[A-Z]?)\)/i)?.[1];
  if (!chassis) return undefined;
  return /f16/i.test(chassis) ? `II (${chassis.toUpperCase()})` : `(${chassis.toUpperCase()})`;
}

function enrichVehicleFromEncar(
  vehicle: NormalizedVehicle | undefined,
  payload: EncarAggregatedPayload,
): NormalizedVehicle | undefined {
  if (!vehicle) return vehicle;
  const category = (payload.detail?.category ?? payload.view?.category ?? {}) as Record<string, unknown>;
  const spec = (payload.detail?.spec ?? payload.view?.spec ?? {}) as Record<string, unknown>;
  const grade = String(category.gradeEnglishName ?? category.gradeName ?? "").trim();
  const generation = generationFromEncar(payload);
  const existingTrim = vehicle.trim?.trim() ?? "";
  const trimParts = [grade && !existingTrim.toLowerCase().includes(grade.toLowerCase()) ? grade : existingTrim, generation]
    .filter(Boolean);
  const trim = [...new Set(trimParts.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean))].join(" ");
  const displacement =
    typeof spec.displacement === "number" && spec.displacement > 0
      ? `${spec.displacement} cc`
      : vehicle.engineDisplacement;
  const driveType =
    vehicle.driveType ??
    (/x\s*drive|all4|4wd|awd/i.test(`${grade} ${existingTrim}`) ? "AWD" : undefined);
  return {
    ...vehicle,
    trim: trim || vehicle.trim,
    engineDisplacement: vehicle.engineDisplacement || displacement,
    driveType,
  };
}

export async function attachEncarHistoryToImportMotorListing(
  listing: NormalizedListing,
): Promise<NormalizedListing> {
  if (listing.targetProvider !== "encar") return listing;
  const lot = importMotorEncarLotId(listing);
  if (!lot) return listing;

  try {
    const adapter = new EncarHistoricalAdapter(DETAIL_WEB_BASE, { detailLevel: "full" });
    const fetched = await adapter.fetchListing(`${DETAIL_WEB_BASE}/cars/detail/${lot}`);
    const payload = (fetched.json ?? {}) as EncarAggregatedPayload;
    const encarEvents = extractEncarEvents(payload);
    if (encarEvents.length === 0) return listing;
    const counts = extractEncarCounts(payload);
    return {
      ...listing,
      events: mergeImportMotorEncarEvents(listing.events ?? [], encarEvents),
      accidentCount: counts.accidentCount ?? listing.accidentCount,
      ownerChangeCount: counts.ownerChangeCount ?? listing.ownerChangeCount,
      vehicle: enrichVehicleFromEncar(listing.vehicle, payload),
    };
  } catch {
    return listing;
  }
}
