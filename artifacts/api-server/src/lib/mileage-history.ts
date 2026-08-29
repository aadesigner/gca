/**
 * Unified mileage history for VIN JSON / admin.
 * Collects dated odometer readings from listings, owners, accidents,
 * inspections, and any other tab payload — de-duplicated, latest tagged.
 */

import { formatMileageDual, kmToMiles, toMileageKm } from "./mileage";
import { extractMileageFromText, isUsableMileage } from "./providers/mileage";

export type MileageHistoryKind =
  | "listing"
  | "owner"
  | "accident"
  | "inspection"
  | "sale"
  | "salvage"
  | "other";

export interface MileageHistoryRow {
  date: string;
  mileageKm: number;
  mileageMiles: number;
  kind: MileageHistoryKind;
  source?: string;
  sources: string[];
  /** True on the most recent dated reading. */
  latest: boolean;
  /** Present on the latest row for clients that key off a tag. */
  tag?: "latest";
}

type EventLike = {
  eventType?: string | null;
  description?: string | null;
  occurredAt?: Date | string | null;
  metadata?: string | Record<string, unknown> | null;
  providerName?: string | null;
};

type ObservationLike = {
  mileage?: number | null;
  mileageKm?: number | null;
  mileageMiles?: number | null;
  mileageUnit?: string | null;
  observedAt?: Date | string | null;
  sourceUpdatedAt?: Date | string | null;
  sourceListedAt?: Date | string | null;
  providerName?: string | null;
  providerId?: number | null;
};

type OwnerLike = {
  date?: string | null;
  mileageKm?: number | null;
  mileageMiles?: number | null;
  source?: string | null;
};

type AccidentLike = {
  date?: string | null;
  mileageKm?: number | null;
  mileageMiles?: number | null;
  source?: string | null;
  type?: string | null;
};

type ListingLike = {
  mileage?: number | null;
  mileageKm?: number | null;
  mileageUnit?: string | null;
  lastSeenAt?: Date | string | null;
  firstSeenAt?: Date | string | null;
  providerName?: string | null;
};

const KIND_RANK: Record<MileageHistoryKind, number> = {
  inspection: 6,
  owner: 5,
  accident: 4,
  sale: 3,
  listing: 2,
  salvage: 1,
  other: 0,
};

export function buildMileageHistory(input: {
  observations?: ObservationLike[];
  events?: EventLike[];
  ownerChanges?: OwnerLike[];
  accidents?: AccidentLike[];
  listings?: ListingLike[];
}): MileageHistoryRow[] {
  const byKey = new Map<string, MileageHistoryRow>();

  const push = (
    date: string | undefined,
    km: number | undefined,
    miles: number | undefined,
    kind: MileageHistoryKind,
    source: string | undefined,
  ) => {
    if (!date || date === "Unknown date") return;
    const dual = dualFrom(km, miles);
    if (!dual) return;
    const key = `${date}|${dual.km}`;
    const sourceLabel = source?.trim() || kindLabel(kind);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, {
        date,
        mileageKm: dual.km,
        mileageMiles: dual.miles,
        kind,
        source: sourceLabel,
        sources: [sourceLabel],
        latest: false,
      });
      return;
    }
    if (!existing.sources.includes(sourceLabel)) existing.sources.push(sourceLabel);
    if (KIND_RANK[kind] > KIND_RANK[existing.kind]) {
      existing.kind = kind;
      existing.source = sourceLabel;
    }
  };

  for (const obs of input.observations ?? []) {
    const date =
      formatDate(obs.observedAt) ||
      formatDate(obs.sourceUpdatedAt) ||
      formatDate(obs.sourceListedAt);
    const dual = dualFrom(
      obs.mileageKm ?? toMileageKm(obs.mileage, obs.mileageUnit),
      obs.mileageMiles ?? undefined,
    );
    push(date, dual?.km, dual?.miles, "listing", obs.providerName ?? "listing");
  }

  for (const owner of input.ownerChanges ?? []) {
    push(
      formatDate(owner.date),
      owner.mileageKm ?? undefined,
      owner.mileageMiles ?? undefined,
      "owner",
      owner.source ?? "owner",
    );
  }

  for (const accident of input.accidents ?? []) {
    push(
      formatDate(accident.date),
      accident.mileageKm ?? undefined,
      accident.mileageMiles ?? undefined,
      "accident",
      accident.source ?? accident.type ?? "accident",
    );
  }

  for (const event of input.events ?? []) {
    const meta = parseMeta(event.metadata);
    const date =
      str(meta.date) ||
      formatDate(event.occurredAt) ||
      str(meta.soldDate) ||
      str(meta.issueDate);
    const reading = mileageFromMeta(meta, event.description);
    if (!reading) continue;
    push(
      date,
      reading.km,
      reading.miles,
      kindFromEvent(event.eventType, meta),
      str(meta.source) ?? event.providerName ?? event.eventType ?? "event",
    );
  }

  for (const listing of input.listings ?? []) {
    const date = formatDate(listing.lastSeenAt) || formatDate(listing.firstSeenAt);
    const km = listing.mileageKm ?? toMileageKm(listing.mileage, listing.mileageUnit);
    push(date, km, undefined, "listing", listing.providerName ?? "listing");
  }

  const rows = [...byKey.values()].sort((a, b) => {
    const dateCmp = a.date.localeCompare(b.date);
    if (dateCmp !== 0) return dateCmp;
    return a.mileageKm - b.mileageKm;
  });

  if (rows.length > 0) {
    const last = rows[rows.length - 1]!;
    last.latest = true;
    last.tag = "latest";
  }

  return rows;
}

export function mileageFromMeta(
  meta: Record<string, unknown>,
  description?: string | null,
): { km: number; miles: number } | null {
  const unit = inferUnit(meta);
  const kmDirect = num(meta.mileageKm);
  const milesDirect = num(meta.mileageMiles);
  if (kmDirect != null && isUsableMileage(kmDirect)) {
    return { km: Math.round(kmDirect), miles: milesDirect ?? kmToMiles(kmDirect) };
  }
  if (milesDirect != null && isUsableMileage(milesDirect)) {
    const dual = formatMileageDual(milesDirect, "mi");
    return dual ? { km: dual.km, miles: dual.miles } : null;
  }

  const raw =
    num(meta.mileage) ??
    num(meta.odometer) ??
    num(meta.odometerValue) ??
    num(meta.odometer_value) ??
    num(meta.km);
  if (raw != null && isUsableMileage(raw)) {
    const dual = formatMileageDual(raw, unit);
    return dual ? { km: dual.km, miles: dual.miles } : null;
  }

  const milesRaw = num(meta.miles);
  if (milesRaw != null && isUsableMileage(milesRaw)) {
    const dual = formatMileageDual(milesRaw, "mi");
    return dual ? { km: dual.km, miles: dual.miles } : null;
  }

  const fromText = extractMileageFromText(description);
  if (fromText != null) {
    const dual = formatMileageDual(fromText, unit);
    return dual ? { km: dual.km, miles: dual.miles } : null;
  }
  return null;
}

function dualFrom(km?: number | null, miles?: number | null): { km: number; miles: number } | null {
  if (km != null && isUsableMileage(km)) {
    return { km: Math.round(km), miles: miles != null && Number.isFinite(miles) ? Math.round(miles) : kmToMiles(km) };
  }
  if (miles != null && isUsableMileage(miles)) {
    const dual = formatMileageDual(miles, "mi");
    return dual ? { km: dual.km, miles: dual.miles } : null;
  }
  return null;
}

function kindFromEvent(eventType: string | null | undefined, meta: Record<string, unknown>): MileageHistoryKind {
  const type = (eventType ?? "").toLowerCase();
  const source = str(meta.source) ?? "";
  if (type === "owner_change") return "owner";
  if (type === "accident" || type === "flood_damage") return "accident";
  if (type === "inspection" || /inspection|diagnosis/i.test(source)) return "inspection";
  if (type === "sale") return "sale";
  if (type === "title_status") return "salvage";
  return "other";
}

function inferUnit(meta: Record<string, unknown>): string {
  const explicit = str(meta.mileageUnit) ?? str(meta.unit) ?? str(meta.odometerType) ?? str(meta.odometer_type);
  if (explicit) return explicit;
  const source = str(meta.source) ?? "";
  if (/encar|kbchachacha|kcar|autowini|korea/i.test(source)) return "km";
  if (/iaa|copart|import.?motor|salvagebid|bidscan|bidcars/i.test(source)) return "mi";
  return "km";
}

function kindLabel(kind: MileageHistoryKind): string {
  if (kind === "listing") return "listing";
  if (kind === "owner") return "owner";
  if (kind === "accident") return "accident";
  if (kind === "inspection") return "inspection";
  if (kind === "sale") return "sale";
  if (kind === "salvage") return "title";
  return "record";
}

function parseMeta(raw: EventLike["metadata"]): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t || undefined;
}

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/,/g, "").replace(/[^\d.-]/g, ""));
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function formatDate(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    const t = value.trim();
    if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
    if (/^\d{8}$/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  }
  const d = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}
