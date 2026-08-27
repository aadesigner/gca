import type { EncarAggregatedPayload } from "./encar-history";

/** Encar internal fields that are not meaningful vehicle data. */
const MANAGE_STRIP_KEYS = new Set([
  "dummy",
  "dummyVehicleId",
  "webReserved",
  "reRegistered",
]);

export function parseEncarDateTime(value: unknown): Date | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export function extractEncarSourceModifiedAt(payload: EncarAggregatedPayload): Date | undefined {
  const detail = payload.detail as Record<string, unknown> | undefined;
  const manage = detail?.manage as Record<string, unknown> | undefined;
  return parseEncarDateTime(manage?.modifyDateTime);
}

/** Prefer first advertised, then system regist time. */
export function extractEncarSourceListedAt(payload: EncarAggregatedPayload): Date | undefined {
  const detail = payload.detail as Record<string, unknown> | undefined;
  const manage = detail?.manage as Record<string, unknown> | undefined;
  return (
    parseEncarDateTime(manage?.firstAdvertisedDateTime) ??
    parseEncarDateTime(manage?.registDateTime)
  );
}

function cleanManageBlock(manage: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(manage)) {
    if (MANAGE_STRIP_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

function cleanDetail(detail: Record<string, unknown>): Record<string, unknown> {
  const out = { ...detail };
  if (out.manage && typeof out.manage === "object") {
    out.manage = cleanManageBlock(out.manage as Record<string, unknown>);
  }
  return out;
}

/**
 * Remove Encar platform noise (dummy listing flags, internal IDs) and add clear metadata.
 */
export function sanitizeEncarAggregatedPayload(
  payload: EncarAggregatedPayload,
  collectedAt = new Date(),
  detailLevel: "full" | "standard" = "full",
): EncarAggregatedPayload & {
  meta: {
    encarListingId: string | null;
    encarVehicleId: string | null;
    sourceModifiedAt: string | null;
    collectedAt: string;
    detailLevel: "full" | "standard";
  };
} {
  const sourceModifiedAt = extractEncarSourceModifiedAt(payload);

  return {
    meta: {
      encarListingId: payload.listingId ?? null,
      encarVehicleId: payload.vehicleId ?? null,
      sourceModifiedAt: sourceModifiedAt?.toISOString() ?? null,
      collectedAt: collectedAt.toISOString(),
      detailLevel,
    },
    listingId: payload.listingId,
    vehicleId: payload.vehicleId,
    detail: payload.detail ? cleanDetail(payload.detail) : undefined,
    view: payload.view ?? null,
    diagnosis: payload.diagnosis ?? null,
    inspection: payload.inspection ?? null,
    record: payload.record ?? null,
  };
}
