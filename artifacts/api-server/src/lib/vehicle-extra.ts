/**
 * Auction / listing specs (keys, condition, airbags, …) — not timeline events.
 * US Copart/IAA/Import Motor lot attributes live here; Korean registry history stays in events.
 */

import { isAccidentEvent } from "./accidents";
import { isSalvageTitleEvent } from "./salvage-title";

export interface VehicleExtraRow {
  key: string;
  label: string;
  value: string;
  source?: string;
  observedAt?: string;
}

type EventLike = {
  eventType?: string | null;
  description?: string | null;
  occurredAt?: Date | string | null;
  metadata?: string | Record<string, unknown> | null;
};

/** Metadata.field values that are lot specs, not history. */
const EXTRA_SPEC_FIELDS = new Set([
  "keys",
  "key_status",
  "keystatus",
  "condition",
  "airbags",
  "airbag",
  "odometer_status",
  "odometerstatus",
  "runs_drives",
  "runs",
  "engine_starts",
  "loss_type",
  "losstype",
  "stock_number",
  "stocknumber",
  "repair_cost",
  "repaircost",
  "actual_cash_value",
  "actualcashvalue",
  "auction_type",
  "auctiontype",
  "auction_house",
  "auctionhouse",
  "engine",
  "cylinders",
  "highlights",
  "steering_type",
  "steeringtype",
  "steering",
  "drive_side",
  "driveside",
  "seizure",
  "mortgage",
  "tax_arrears",
  "taxarrears",
  "sales_method",
  "salesmethod",
]);

const EXTRA_LABELS: Record<string, string> = {
  keys: "Keys",
  key_status: "Key status",
  condition: "Condition",
  airbags: "Airbags",
  odometer_status: "Odometer status",
  runs_drives: "Runs & drives",
  loss_type: "Loss type",
  stock_number: "Stock number",
  repair_cost: "Repair cost",
  actual_cash_value: "Actual cash value",
  auction_type: "Auction type",
  auction_house: "Auction house",
  engine: "Engine",
  cylinders: "Cylinders",
  highlights: "Highlights",
  steering_type: "Steering",
  steering: "Steering",
  drive_side: "Steering",
  seizure: "Seizure",
  mortgage: "Mortgage",
  tax_arrears: "Tax arrears",
  sales_method: "Sales method",
};

const DESC_EXTRA_PATTERNS: Array<{ re: RegExp; key: string }> = [
  { re: /^keys available:\s*(.+)$/i, key: "keys" },
  { re: /^keys:\s*(.+)$/i, key: "keys" },
  { re: /^key status:\s*(.+)$/i, key: "key_status" },
  { re: /^airbags?:\s*(.+)$/i, key: "airbags" },
  { re: /^odometer status:\s*(.+)$/i, key: "odometer_status" },
  { re: /^runs\s*(?:and|&)\s*drives?:\s*(.+)$/i, key: "runs_drives" },
  { re: /^loss type:\s*(.+)$/i, key: "loss_type" },
  { re: /^stock(?:\s*#| number)?:\s*(.+)$/i, key: "stock_number" },
  { re: /^repair cost:\s*(.+)$/i, key: "repair_cost" },
  { re: /^actual cash value:\s*(.+)$/i, key: "actual_cash_value" },
  { re: /^auction type:\s*(.+)$/i, key: "auction_type" },
  { re: /^auction house:\s*(.+)$/i, key: "auction_house" },
  { re: /^steering:\s*(.+)$/i, key: "steering_type" },
  { re: /^(left[-\s]?hand(?:\s+drive)?|lhd|hand\s+left(?:\s+driving)?)\s*$/i, key: "steering_type" },
  { re: /^(right[-\s]?hand(?:\s+drive)?|rhd|hand\s+right(?:\s+driving)?)\s*$/i, key: "steering_type" },
];

/** True when this event is a static lot spec (belongs in extra, not events). */
export function isExtraSpecEvent(event: EventLike): boolean {
  const meta = parseMeta(event.metadata);
  const field = normalizeFieldKey(str(meta.field));
  if (field && EXTRA_SPEC_FIELDS.has(field)) return true;

  const desc = str(event.description) ?? "";
  if (/^keys available:/i.test(desc)) return true;
  if (/^key status:/i.test(desc)) return true;
  if (/^airbags?:/i.test(desc) && (event.eventType ?? "").toLowerCase() === "other") return true;
  if (/^odometer status:/i.test(desc)) return true;
  if (/^runs\s*(?:and|&)\s*drives?:/i.test(desc)) return true;
  if (/^condition:/i.test(desc) && (event.eventType ?? "").toLowerCase() === "other") return true;
  if (/^steering:/i.test(desc)) return true;
  if (/\b(left[-\s]?hand|right[-\s]?hand|hand\s+left|hand\s+right)\b/i.test(desc)) return true;
  if (/^(lhd|rhd)\b/i.test(desc) && (event.eventType ?? "").toLowerCase() === "other") return true;

  return false;
}

/** Collapse spec events (+ accident condition metadata) into extra rows. */
export function buildVehicleExtra(events: EventLike[]): VehicleExtraRow[] | null {
  const rows: VehicleExtraRow[] = [];
  const seen = new Set<string>();

  const add = (key: string, value: string, source?: string, observedAt?: string) => {
    const normKey = normalizeFieldKey(key) ?? key;
    const text = value.trim();
    if (!text) return;
    const dedupe = `${normKey}:${text.toLowerCase()}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    rows.push({
      key: normKey,
      label: EXTRA_LABELS[normKey] ?? titleCase(normKey),
      value: text,
      source,
      observedAt,
    });
  };

  for (const event of events) {
    if (isExtraSpecEvent(event)) {
      const meta = parseMeta(event.metadata);
      const field = normalizeFieldKey(str(meta.field)) ?? keyFromDescription(event.description);
      const value =
        str(meta.value) ??
        valueFromDescription(event.description, field) ??
        str(event.description);
      if (!field || !value) continue;
      add(
        field,
        formatExtraValue(field, value),
        str(meta.source),
        formatDate(event.occurredAt) ?? str(meta.date),
      );
      continue;
    }

    if (isAccidentEvent(event)) {
      const meta = parseMeta(event.metadata);
      const condition = str(meta.condition);
      if (condition) {
        add("condition", condition, str(meta.source), formatDate(event.occurredAt));
      }
    }
  }

  if (rows.length === 0) return null;
  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/** Timeline events only — excludes specs and rows already in structured categories. */
export function filterTimelineEvents(events: EventLike[]): EventLike[] {
  return events.filter((event) => {
    if (isExtraSpecEvent(event)) return false;
    if (isAccidentEvent(event)) return false;
    if (isSalvageTitleEvent(event)) return false;
    const type = (event.eventType ?? "").toLowerCase();
    if (type === "owner_change" || type === "sale") return false;
    if (isBuyNowNoise(event)) return false;
    return true;
  });
}

function isBuyNowNoise(event: EventLike): boolean {
  const meta = parseMeta(event.metadata);
  if (str(meta.field) === "buy_now") return true;
  return /^buy\s*now\s*:/i.test(str(event.description) ?? "");
}

function keyFromDescription(description: string | null | undefined): string | undefined {
  const desc = str(description);
  if (!desc) return undefined;
  for (const { re, key } of DESC_EXTRA_PATTERNS) {
    if (re.test(desc)) return key;
  }
  return undefined;
}

function valueFromDescription(
  description: string | null | undefined,
  field?: string,
): string | undefined {
  const desc = str(description);
  if (!desc) return undefined;
  for (const { re, key } of DESC_EXTRA_PATTERNS) {
    if (field && key !== field) continue;
    const m = desc.match(re);
    if (m?.[1]) return m[1].trim();
  }
  return undefined;
}

function formatExtraValue(field: string, value: string): string {
  const key = normalizeFieldKey(field) ?? field;
  if (key === "steering_type" || key === "steering" || key === "drive_side") {
    return formatSteeringValue(value);
  }
  return value;
}

function formatSteeringValue(raw: string): string {
  const t = raw.trim();
  if (/lhd|\bleft\b|hand\s+left/i.test(t)) return "Left-hand drive";
  if (/rhd|\bright\b|hand\s+right/i.test(t)) return "Right-hand drive";
  return t;
}

function normalizeFieldKey(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const t = raw.trim();
  if (!t) return undefined;
  const snake = t.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  if (snake === "steeringtype" || snake === "steering_type" || snake === "steering") return "steering_type";
  if (snake === "driveside" || snake === "drive_side") return "steering_type";
  if (EXTRA_SPEC_FIELDS.has(snake)) return snake;
  if (EXTRA_SPEC_FIELDS.has(t.toLowerCase())) return t.toLowerCase();
  return snake;
}

function titleCase(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
