/**
 * Salvage / total-loss category for VIN JSON.
 * Built from title/status events (US/CA auctions) and equivalent signals worldwide
 * (Korean total loss / 전손, Autowini salvage flags, Carstat damageClass, etc.).
 */

import { isUsOrCanadaCountry } from "./geo";

export interface SalvageRecord {
  /** true = salvage / total loss (or equivalent branded title); false = clean/clear/normal title */
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

const SALVAGE_FLAG_FIELDS = new Set([
  "totalloss",
  "salvagerecord",
  "salvage",
  "vehiclecategory",
  "damage",
  "damageclass",
]);

/** Match salvage / branded titles / total-loss anywhere near title or status text. */
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
  if (/\btotal[_\s-]*loss\b/i.test(t)) return true;
  // Korean insurance / registry: total loss
  if (/전손|총손실|총손/.test(t)) return true;
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

/** Title-status rows and any event that carries a salvage / total-loss signal. */
export function isSalvageTitleEvent(event: EventLike): boolean {
  const type = (event.eventType ?? "").toLowerCase();
  if (type === "title_status" || type === "total_loss") return true;

  const meta = parseMeta(event.metadata);
  if (typeof meta.salvage === "boolean") return true;

  const field = str(meta.field)?.toLowerCase().replace(/-/g, "_");
  if (field && TITLE_FIELDS.has(field)) return true;
  if (field && SALVAGE_FLAG_FIELDS.has(field.replace(/_/g, ""))) {
    if (field.replace(/_/g, "") === "vehiclecategory") {
      return (
        textIndicatesSalvage(str(meta.value) ?? "") ||
        textIndicatesSalvage(str(event.description) ?? "")
      );
    }
    return true;
  }

  if (textIndicatesSalvage(str(meta.damageClass) ?? "")) return true;
  if (textIndicatesSalvage(str(meta.value) ?? "")) return true;

  const desc = str(event.description) ?? "";
  if (/^(vehicle title|detailed title|title(?:\s*(?:code|type|status|name))?)\s*:/i.test(desc)) {
    return true;
  }
  // Explicit salvage / total-loss wording on damage / listing events (Carstat, Koreaauto, …).
  if (textIndicatesSalvage(desc)) return true;

  // Encar flood that was recorded as total-loss flood.
  if (type === "flood_damage") {
    const floodTotal = meta.floodTotalLossCnt;
    if (typeof floodTotal === "number" && floodTotal > 0) return true;
    if (typeof floodTotal === "string" && Number(floodTotal) > 0) return true;
  }

  return false;
}

/** Collapse title / total-loss events into one VIN-level salvage record (any country). */
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
  let sawUsableSignal = false;

  for (const event of rows) {
    const meta = parseMeta(event.metadata);
    const type = (event.eventType ?? "").toLowerCase();
    const field = str(meta.field)?.toLowerCase();
    const value =
      str(meta.value) ||
      str(meta.title) ||
      str(meta.damageClass) ||
      titleFromDescription(event.description) ||
      undefined;

    const flagged =
      meta.salvage === true ||
      type === "total_loss" ||
      (typeof meta.floodTotalLossCnt === "number" && meta.floodTotalLossCnt > 0) ||
      (value ? textIndicatesSalvage(value) : false) ||
      textIndicatesSalvage(str(event.description) ?? "") ||
      textIndicatesSalvage(str(meta.damageClass) ?? "");

    if (flagged) salvage = true;

    // Prefer real title text; fall back to total-loss label when that is the only signal.
    if (value) {
      if (field === "detailed_title") detailedTitle = detailedTitle ?? value;
      else if (type === "total_loss" || field === "totalloss" || field === "total_loss") {
        title = title ?? humanizeLossLabel(value) ?? value;
      } else if (TITLE_FIELDS.has(field ?? "") || /^title/i.test(field ?? "")) {
        title = title ?? value;
      } else if (!title && flagged) {
        title = humanizeLossLabel(value) ?? value;
      }
    } else if (type === "total_loss" && !title) {
      title = "Total loss";
    } else if (flagged && !title) {
      const desc = str(event.description);
      if (desc) title = humanizeLossLabel(desc) ?? desc;
    }

    if (!state) {
      state = str(meta.state) ?? (field !== "detailed_title" && value ? parseTitleState(value) : undefined);
    }
    if (!state && value) state = parseTitleState(value);
    status = status ?? str(meta.status);
    date = date ?? str(meta.date) ?? formatDate(event.occurredAt);
    source = source ?? str(meta.source);

    if (flagged || value || typeof meta.salvage === "boolean") sawUsableSignal = true;
  }

  if (!title && !detailedTitle && status == null && !salvage) {
    const anySalvageMeta = rows.some((e) => typeof parseMeta(e.metadata).salvage === "boolean");
    if (!anySalvageMeta) return null;
  }
  if (!sawUsableSignal && !salvage && !title && !detailedTitle) return null;

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

function humanizeLossLabel(raw: string): string | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  if (/^damage:\s*/i.test(t)) {
    const rest = t.replace(/^damage:\s*/i, "").trim();
    if (/total[_\s-]*loss|전손|총손/i.test(rest)) return "Total loss";
    return rest || t;
  }
  if (/total[_\s-]*loss|전손|총손/i.test(t) && t.length < 80) {
    if (/^total[_\s-]*loss$/i.test(t) || /^(전손|총손실|총손)$/.test(t)) return "Total loss";
  }
  if (/listed as salvage/i.test(t)) return "Salvage";
  if (/^salvage record$/i.test(t)) return "Salvage record";
  if (/^total-?loss record$/i.test(t)) return "Total loss";
  return undefined;
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
