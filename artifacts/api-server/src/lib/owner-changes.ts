/**
 * Structured owner-change rows from Encar registry events.
 * Registry records are transfer dates (and sometimes a plate). Do not invent mileage.
 */
export interface OwnerChangeRow {
  date: string;
  sequence: number;
  info?: string;
  plate?: string;
  mileageKm?: number;
  mileageMiles?: number;
  source?: string;
}

type EventLike = {
  eventType?: string | null;
  description?: string | null;
  occurredAt?: Date | string | null;
  metadata?: string | Record<string, unknown> | null;
};

export function buildOwnerChangeTable(
  events: EventLike[],
  _observations: unknown[] = [],
): OwnerChangeRow[] {
  const ownerEvents = events
    .filter((e) => e.eventType === "owner_change")
    .sort((a, b) => eventTime(a) - eventTime(b));

  if (ownerEvents.length === 0) return [];

  const plateByDay = new Map<string, string>();
  for (const event of events) {
    const meta = parseMeta(event.metadata);
    const plate = str(meta.carNo) ?? str(meta.plate);
    if (!plate) continue;
    const day = dayKey(event.occurredAt ?? meta.date);
    if (day) plateByDay.set(day, plate);
  }

  return ownerEvents.map((event, index) => {
    const meta = parseMeta(event.metadata);
    const date =
      str(meta.date) ||
      formatDate(event.occurredAt) ||
      "Unknown date";
    const day = dayKey(event.occurredAt ?? meta.date);
    const plate = str(meta.plate) ?? str(meta.carNo) ?? (day ? plateByDay.get(day) : undefined);
    const sequence =
      typeof meta.sequence === "number" && Number.isFinite(meta.sequence)
        ? meta.sequence
        : index + 1;

    const rawInfo = str(meta.info) ?? event.description ?? undefined;
    const info = rawInfo && !isGenericOwnerInfo(rawInfo, date) ? rawInfo : undefined;

    const mileageKm =
      num(meta.mileageKm) ??
      num(meta.mileage) ??
      num(meta.odometer) ??
      num(meta.km);

    return {
      date,
      sequence,
      info,
      plate,
      mileageKm: mileageKm,
      mileageMiles: num(meta.mileageMiles),
      source: str(meta.source) ?? "encar_record",
    };
  });
}

function isGenericOwnerInfo(text: string, date: string): boolean {
  const t = text.trim().toLowerCase();
  if (!t) return true;
  if (t.startsWith("title transfer")) return true;
  if (t.includes("korean vehicle registry")) return true;
  if (/^owner change\b/.test(t) && (t.includes("recorded") || t.includes(date.toLowerCase()))) {
    return true;
  }
  return false;
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

function toDate(value: Date | string | unknown): Date | undefined {
  if (!value) return undefined;
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d;
}

function eventTime(event: EventLike): number {
  return toDate(event.occurredAt)?.getTime() ?? 0;
}

function dayKey(value: Date | string | unknown): string | undefined {
  const d = toDate(value);
  if (!d) return typeof value === "string" ? value.slice(0, 10) : undefined;
  return d.toISOString().slice(0, 10);
}

function formatDate(value: Date | string | unknown): string | undefined {
  const d = toDate(value);
  return d ? d.toISOString().slice(0, 10) : undefined;
}
