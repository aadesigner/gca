/**
 * US/Canada title · salvage category for VIN JSON.
 * Built from title/status events (e.g. "Tx - Salvage Vehicle Title", "Clear").
 */

import { isUsOrCanadaCountry } from "./geo";

export interface SalvageRecord {
  /** true = salvage (or equivalent branded title); false = clean/clear/normal title */
  salvage: boolean;
  title?: string;
  detailedTitle?: string;
  state?: string;
  status?: string;
  date?: string;
  source?: string;
}

type EventLike = {
  eventType?: string | null;
  description?: string | null;
  occurredAt?: Date | string | null;
  metadata?: string | Record<string, unknown> | null;
};

const TITLE_FIELDS = new Set([
  "title",
  "vehicle_title",
  "detailed_title",
  "title_code",
  "title_type",
  "title_status",
  "title_name",
  "doc_type",
]);

/** Match salvage / branded titles anywhere near title or status text. */
export function textIndicatesSalvage(raw: string): boolean {
  const t = raw.trim();
  if (!t) return false;
  // Match salvage / salvaged even when glued to punctuation: "Title-Salvaged", "CERT OF TITLE-SALVAGED"
  if (/salvage[ds]?\b/i.test(t)) return true;
  if (/\bslvg\b/i.test(t)) return true;
  if (/\bjunk\b/i.test(t)) return true;
  if (/non[- ]?repairable/i.test(t)) return true;
  if (/certificate of destruction|\bcod\b/i.test(t)) return true;
  if (/\brebuilt\b/i.test(t)) return true;
  if (/parts only/i.test(t)) return true;
  if (/\btotal loss\b/i.test(t)) return true;
  return false;
}

export function parseTitleState(raw: string): string | undefined {
  const m = raw.trim().match(/^([A-Za-z]{2})\s*[-–—]\s+/);
  if (!m?.[1]) return undefined;
  return m[1].toUpperCase();
}

export function isUsOrCanadaContext(input: {
  country?: string | null;
  location?: string | null;
  origin?: string | null;
}): boolean {
  if (isUsOrCanadaCountry(input.country)) return true;
  const origin = String(input.origin ?? "").toLowerCase();
  if (origin === "iaa" || origin === "copart" || origin === "salvagebid") return true;
  const loc = String(input.location ?? "");
  if (/\bUSA\b|\bU\.S\.A\.?\b|United States|\bCanada\b/i.test(loc)) return true;
  return false;
}

export function isSalvageTitleEvent(event: EventLike): boolean {
  const type = (event.eventType ?? "").toLowerCase();
  if (type === "title_status") return true;
  const meta = parseMeta(event.metadata);
  const field = str(meta.field)?.toLowerCase();
  if (field && TITLE_FIELDS.has(field)) return true;
  if (typeof meta.salvage === "boolean") return true;
  const desc = str(event.description) ?? "";
  return /^(vehicle title|detailed title|title(?:\s*(?:code|type|status|name))?)\s*:/i.test(desc);
}

/** Collapse title events into one VIN-level salvage record (US/Canada only). */
export function buildSalvageRecord(events: EventLike[]): SalvageRecord | null {
  const rows = events.filter(isSalvageTitleEvent);
  if (rows.length === 0) return null;

  let salvage = false;
  let title: string | undefined;
  let detailedTitle: string | undefined;
  let state: string | undefined;
  let status: string | undefined;
  let date: string | undefined;
  let source: string | undefined;

  for (const event of rows) {
    const meta = parseMeta(event.metadata);
    const region = str(meta.region)?.toUpperCase();
    if (region && region !== "US" && region !== "CA" && region !== "USA" && region !== "CAN") {
      continue;
    }
    if (meta.usCanada === false) continue;

    const field = str(meta.field)?.toLowerCase();
    const value =
      str(meta.value) ||
      str(meta.title) ||
      titleFromDescription(event.description) ||
      undefined;
    // Prefer text over a stale metadata false (older parsers missed "Salvaged"/"Slvg").
    const flagged =
      meta.salvage === true ||
      (value ? textIndicatesSalvage(value) : false) ||
      textIndicatesSalvage(str(event.description) ?? "");
    if (flagged) salvage = true;

    if (value) {
      if (field === "detailed_title") detailedTitle = detailedTitle ?? value;
      else title = title ?? value;
    }
    if (!state) {
      state = str(meta.state) ?? (field !== "detailed_title" && value ? parseTitleState(value) : undefined);
    }
    if (!state && value) state = parseTitleState(value);
    status = status ?? str(meta.status);
    date = date ?? str(meta.date) ?? formatDate(event.occurredAt);
    source = source ?? str(meta.source);
  }

  if (!title && !detailedTitle && status == null && !salvage) {
    // No usable title text and not flagged — skip empty category.
    const anySalvageMeta = rows.some((e) => typeof parseMeta(e.metadata).salvage === "boolean");
    if (!anySalvageMeta) return null;
  }

  return {
    salvage,
    title,
    detailedTitle,
    state,
    status,
    date,
    source,
  };
}

function titleFromDescription(description: string | null | undefined): string | undefined {
  const m = str(description)?.match(
    /^(?:vehicle title|detailed title|title(?:\s*(?:code|type|status|name))?)\s*:\s*(.+)$/i,
  );
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

function formatDate(value: Date | string | unknown): string | undefined {
  if (!value) return undefined;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString().slice(0, 10);
}
