/**
 * Auction / listing specs (keys, condition, airbags, …) — not timeline events.
 * US Copart/IAA/Import Motor lot attributes live here; Korean registry history stays in events.
 */

import { isAccidentEvent } from "./accidents";
import { isSalvageTitleEvent } from "./salvage-title";
import {
  collapseFirstRegistrationEvents,
  firstRegistrationScore,
} from "./providers/web-html";

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
  "secondary_damage",
  "secondarydamage",
  "primary_damage",
  "primarydamage",
  "regional_specs",
  "regionalspecs",
  "doors",
  "grade",
  "package",
  "vehicle_category",
  "vehiclecategory",
  // Encar Korean performance inspection (unified extras)
  "performance_inspection",
  "inspection_record_no",
  "inspection_mileage",
  "inspection_issued",
  "inspection_valid_from",
  "inspection_valid_to",
  "first_registration",
  "inspection_structure",
  "inspection_condition",
  "simple_repair",
  "inspection_comments",
  "inspection_panels",
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
  secondary_damage: "Secondary damage",
  primary_damage: "Primary damage",
  regional_specs: "Regional specs",
  doors: "Doors",
  grade: "Grade",
  package: "Package",
  vehicle_category: "Category",
  performance_inspection: "Performance inspection",
  inspection_record_no: "Inspection record #",
  inspection_mileage: "Inspection odometer",
  inspection_issued: "Inspection issued",
  inspection_valid_from: "Inspection valid from",
  inspection_valid_to: "Inspection valid until",
  first_registration: "First registration",
  inspection_structure: "Inspection structure/frame",
  inspection_condition: "Inspection vehicle condition",
  simple_repair: "Simple outer-panel repair",
  inspection_comments: "Inspection comments",
  inspection_panels: "Inspection findings",
};

const DESC_EXTRA_PATTERNS: Array<{ re: RegExp; key: string }> = [
  { re: /^keys available:\s*(.+)$/i, key: "keys" },
  { re: /^keys:\s*(.+)$/i, key: "keys" },
  { re: /^key status:\s*(.+)$/i, key: "key_status" },
  { re: /^airbags?:\s*(.+)$/i, key: "airbags" },
  { re: /^odometer status:\s*(.+)$/i, key: "odometer_status" },
  { re: /^runs\s*(?:and|&)\s*drives?:\s*(.+)$/i, key: "runs_drives" },
  { re: /^loss type:\s*(.+)$/i, key: "loss_type" },
  { re: /^primary damage:\s*(.+)$/i, key: "condition" },
  { re: /^secondary damage:\s*(.+)$/i, key: "secondary_damage" },
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
  if (field?.startsWith("inspection_panel_")) return true;

  const desc = str(event.description) ?? "";
  if (/^keys available:/i.test(desc)) return true;
  if (/^key status:/i.test(desc)) return true;
  if (/^airbags?:/i.test(desc) && (event.eventType ?? "").toLowerCase() === "other") return true;
  if (/^odometer status:/i.test(desc)) return true;
  if (/^runs\s*(?:and|&)\s*drives?:/i.test(desc)) return true;
  if (/^condition:/i.test(desc) && (event.eventType ?? "").toLowerCase() === "other") return true;
  if (/^primary damage:/i.test(desc)) return true;
  if (/^secondary damage:/i.test(desc)) return true;
  if (/^loss type:/i.test(desc)) return true;
  if (/^steering:/i.test(desc)) return true;
  if (/\b(left[-\s]?hand|right[-\s]?hand|hand\s+left|hand\s+right)\b/i.test(desc)) return true;
  if (/^(lhd|rhd)\b/i.test(desc) && (event.eventType ?? "").toLowerCase() === "other") return true;

  return false;
}

/** Collapse spec events (+ accident condition metadata) into extra rows. */
export function buildVehicleExtra(events: EventLike[]): VehicleExtraRow[] | null {
  const rows: VehicleExtraRow[] = [];
  const seen = new Set<string>();

  const add = (key: string, value: string, _source?: string, observedAt?: string) => {
    const normKey = normalizeFieldKey(key) ?? key;
    const text = value.trim();
    if (!text) return;
    const dedupe = `${normKey}:${text.toLowerCase()}`;
    if (seen.has(dedupe)) return;
    seen.add(dedupe);
    // Extras are field + value + optional date only — never expose provider source.
    rows.push({
      key: normKey,
      label: EXTRA_LABELS[normKey] ?? titleCase(normKey),
      value: text,
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

    // Encar performance inspection — promote structured metadata into unified extras.
    const meta = parseMeta(event.metadata);
    if (str(meta.source) === "encar_inspection" && !isExtraSpecEvent(event)) {
      const observed =
        formatDate(event.occurredAt) ??
        str(meta.issueDate) ??
        str(meta.validityStartDate) ??
        str(meta.date);
      const board = str(meta.boardState);
      const car = str(meta.carState);
      if (meta.mileage != null) {
        add("inspection_mileage", `${Number(meta.mileage).toLocaleString("en-US")} km`, undefined, observed);
      }
      if (str(meta.recordNo)) add("inspection_record_no", str(meta.recordNo)!, undefined, observed);
      if (str(meta.issueDate)) add("inspection_issued", str(meta.issueDate)!, undefined, observed);
      if (str(meta.validityStartDate)) add("inspection_valid_from", str(meta.validityStartDate)!, undefined, observed);
      if (str(meta.validityEndDate)) add("inspection_valid_to", str(meta.validityEndDate)!, undefined, observed);
      if (str(meta.firstRegistrationDate)) {
        add("first_registration", str(meta.firstRegistrationDate)!, undefined, observed);
      }
      if (board && !/^none$/i.test(board) && !/[가-힣]/.test(board)) {
        add("inspection_structure", board, undefined, observed);
      }
      if (car && !/^none$/i.test(car) && !/[가-힣]/.test(car)) {
        add("inspection_condition", car, undefined, observed);
      }
      if (meta.simpleRepair === true) add("simple_repair", "Yes", undefined, observed);
      if (str(meta.comments)) add("inspection_comments", str(meta.comments)!, undefined, observed);
    }

    if (str(meta.source) === "encar_inspection_panels") {
      const panels = meta.panels;
      if (Array.isArray(panels) && panels.length) {
        const text = panels
          .map((p) => {
            if (typeof p === "string") return p;
            if (p && typeof p === "object") {
              const row = p as Record<string, unknown>;
              const panel = str(row.panel) ?? str(row.title);
              const status = str(row.status);
              return panel && status ? `${panel}: ${status}` : panel ?? status;
            }
            return null;
          })
          .filter(Boolean)
          .join("; ");
        if (text) add("inspection_panels", text, undefined, formatDate(event.occurredAt) ?? str(meta.date));
      }
    }
  }

  if (rows.length === 0) return null;

  // At most one first_registration extra — prefer the most precise value.
  const firstRegs = rows.filter((r) => r.key === "first_registration");
  if (firstRegs.length > 1) {
    const best = firstRegs.reduce((a, b) =>
      firstRegistrationScore({
        eventType: "delivery",
        description: `First registration: ${b.value}`,
        metadata: { field: "firstRegistration", value: b.value },
      }) >
      firstRegistrationScore({
        eventType: "delivery",
        description: `First registration: ${a.value}`,
        metadata: { field: "firstRegistration", value: a.value },
      })
        ? b
        : a,
    );
    rows.splice(0, rows.length, ...rows.filter((r) => r.key !== "first_registration"), best);
  }

  return rows.sort((a, b) => a.label.localeCompare(b.label));
}

/** Timeline events only — excludes specs and rows already in structured categories. */
export function filterTimelineEvents(events: EventLike[]): EventLike[] {
  const filtered = events.filter((event) => {
    if (isExtraSpecEvent(event)) return false;
    if (isAccidentEvent(event)) return false;
    if (isSalvageTitleEvent(event)) return false;
    const type = (event.eventType ?? "").toLowerCase();
    if (type === "owner_change" || type === "sale") return false;
    if (isBuyNowNoise(event)) return false;
    return true;
  });
  // One first-registration delivery per VIN in the public/admin JSON timeline.
  return collapseFirstRegistrationEvents(filtered);
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
  return translateExtraValue(value);
}

/**
 * Translate Korean auction/dealer phrases in extra values (Seobuk sales_method, etc.).
 * Proper nouns (dealer names) are left as-is; labels and yes/no become English.
 */
export function translateExtraValue(raw: string): string {
  let t = raw.replace(/\s+/g, " ").trim();
  if (!t) return t;
  if (!/[가-힣]/.test(t)) return t;

  t = t.replace(/^\?\s*/, "");

  const phraseMap: Array<[RegExp, string]> = [
    [/판매상사\s*[：:]/g, "Selling dealer: "],
    [/판매방식\s*[：:]/g, "Sales method: "],
    [/광고동의여부\s*[：:]/g, "Ad consent: "],
    [/판매자\s*[：:]/g, "Seller: "],
    [/딜러\s*[：:]/g, "Dealer: "],
    [/매매상사\s*[：:]/g, "Dealer: "],
    [/압류\s*[：:]/g, "Seizure: "],
    [/저당\s*[：:]/g, "Mortgage: "],
    [/세금체납\s*[：:]/g, "Tax arrears: "],
    [/미납세금\s*[：:]/g, "Unpaid tax: "],
    [/미동의|비동의|부동의/g, "Not agreed"],
    [/동의/g, "Agreed"],
    [/없음/g, "None"],
    [/있음/g, "Yes"],
    [/\(주\)/g, "Co. "],
    [/주식회사/g, "Co. "],
  ];
  for (const [re, en] of phraseMap) t = t.replace(re, en);

  // Collapse leftover Hangul label crumbs into readable separators.
  t = t
    .replace(/\s{2,}/g, " ")
    .replace(/\s*·\s*/g, " · ")
    .replace(/\s*([|｜])\s*/g, " · ")
    .trim();

  // If Hangul remains only inside parentheses (city names etc.), leave it;
  // otherwise append a light romanization-free cleanup of common city tags.
  t = t
    .replace(/\(수원\)/g, "(Suwon)")
    .replace(/\(안산\)/g, "(Ansan)")
    .replace(/\(인천\)/g, "(Incheon)")
    .replace(/\(서울\)/g, "(Seoul)")
    .replace(/\(부산\)/g, "(Busan)")
    .replace(/\(대구\)/g, "(Daegu)")
    .replace(/\(대전\)/g, "(Daejeon)")
    .replace(/\(광주\)/g, "(Gwangju)")
    .replace(/\(울산\)/g, "(Ulsan)")
    .replace(/\(경기\)/g, "(Gyeonggi)")
    .replace(/\(성남\)/g, "(Seongnam)")
    .replace(/\(용인\)/g, "(Yongin)")
    .replace(/\(고양\)/g, "(Goyang)")
    .replace(/\(부천\)/g, "(Bucheon)")
    .replace(/\(화성\)/g, "(Hwaseong)")
    .replace(/\(평택\)/g, "(Pyeongtaek)")
    .replace(/\(천안\)/g, "(Cheonan)")
    .replace(/\(청주\)/g, "(Cheongju)");

  return t.trim();
}

function formatSteeringValue(raw: string): string {
  const t = raw.trim();
  if (/lhd|\bleft\b|hand\s+left/i.test(t)) return "Left-hand drive";
  if (/rhd|\bright\b|hand\s+right/i.test(t)) return "Right-hand drive";
  return translateExtraValue(t);
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
