/**
 * Structured accident / damage rows for VIN JSON.
 * Mirrors ownerChanges / auctionSales — first-class category, not only generic events.
 */

import { mileageFromMeta } from "./mileage-history";

export interface AccidentRow {
  date: string;
  type: "accident" | "flood_damage" | "damage";
  category?: string;
  damage?: string;
  description?: string;
  repairTotal?: number;
  insuranceBenefit?: number;
  currency?: string;
  source?: string;
  mileageKm?: number;
  mileageMiles?: number;
}

type EventLike = {
  eventType?: string | null;
  description?: string | null;
  occurredAt?: Date | string | null;
  metadata?: string | Record<string, unknown> | null;
};

const DAMAGE_FIELDS = new Set(["primary_damage", "secondary_damage"]);

export function buildAccidentTable(events: EventLike[]): AccidentRow[] {
  const rows: AccidentRow[] = [];

  for (const event of events) {
    if (!isAccidentEvent(event)) continue;
    if (isEmptyPlaceholder(event)) continue;

    const meta = parseMeta(event.metadata);
    const field = str(meta.field);
    const date =
      str(meta.date) ||
      formatDate(event.occurredAt) ||
      "Unknown date";

    const damage =
      str(meta.value) ||
      str(meta.damage) ||
      damageFromDescription(event.description);

    const type = resolveType(event.eventType, field, damage, event.description);
    const category =
      field === "primary_damage"
        ? "primary"
        : field === "secondary_damage"
          ? "secondary"
          : type === "flood_damage"
            ? "flood"
            : str(meta.type) || undefined;

    const mileage = mileageFromMeta(meta, event.description);

    rows.push({
      date,
      type,
      category,
      damage,
      description: str(event.description),
      repairTotal: num(meta.repairTotal),
      insuranceBenefit: num(meta.insuranceBenefit),
      currency: str(meta.currency),
      source: str(meta.source),
      mileageKm: mileage?.km,
      mileageMiles: mileage?.miles,
    });
  }

  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

/** True when this event belongs in the accidents category (and should leave Events UI). */
export function isAccidentEvent(event: EventLike): boolean {
  const type = (event.eventType ?? "").toLowerCase();
  if (type === "accident" || type === "flood_damage") return true;

  const meta = parseMeta(event.metadata);
  const field = str(meta.field)?.toLowerCase();
  if (field && DAMAGE_FIELDS.has(field)) return true;

  const desc = str(event.description) ?? "";
  return /^(primary|secondary)\s+damage\s*:/i.test(desc);
}

function resolveType(
  eventType: string | null | undefined,
  field: string | undefined,
  damage: string | undefined,
  description: string | null | undefined,
): AccidentRow["type"] {
  const t = (eventType ?? "").toLowerCase();
  if (t === "flood_damage") return "flood_damage";
  if (t === "accident") return "accident";
  if (/flood|water/i.test(damage ?? "") || /flood|water/i.test(description ?? "")) {
    return "flood_damage";
  }
  if (field && DAMAGE_FIELDS.has(field)) return "damage";
  return "accident";
}

function isEmptyPlaceholder(event: EventLike): boolean {
  const description = event.description ?? "";
  if (/repair ₩0/.test(description) && /payout ₩0/.test(description)) return true;
  const meta = parseMeta(event.metadata);
  const repair = typeof meta.repairTotal === "number" ? meta.repairTotal : 0;
  const payout = typeof meta.insuranceBenefit === "number" ? meta.insuranceBenefit : 0;
  return meta.source === "encar_record" && repair <= 0 && payout <= 0;
}

function damageFromDescription(description: string | null | undefined): string | undefined {
  const m = str(description)?.match(/^(?:Primary|Secondary)\s+damage:\s*(.+)$/i);
  return m?.[1]?.trim() || undefined;
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
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function formatDate(value: Date | string | unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}
